import fs from 'node:fs';
import process from 'node:process';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../src/firebase.js';

const SHARD_COUNT = 16;
const RECOGNITION_LIMIT = 50;
const LEGACY_COLLECTIONS = ['days', 'items', 'questions', 'cards'];

function loadLocalEnv() {
  if (!fs.existsSync('.env')) return;
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match || process.env[match[1]]) return;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  });
}

function todayInTaipei() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function seedFromString(text) {
  return [...text].reduce((seed, char) => ((seed * 31) + char.charCodeAt(0)) % 233280, 17);
}

function shuffleItems(items, seed) {
  const result = [...items];
  let value = seed || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    value = (value * 9301 + 49297) % 233280;
    const swapIndex = Math.floor((value / 233280) * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function progressShardId(questionId) {
  const hash = [...questionId].reduce((sum, character) => sum + character.codePointAt(0), 0);
  return String(hash % SHARD_COUNT).padStart(2, '0');
}

async function commitOperations(operations, chunkSize = 400) {
  for (let start = 0; start < operations.length; start += chunkSize) {
    const batch = writeBatch(db);
    operations.slice(start, start + chunkSize).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

function buildRecognitionState(attempts, termIds, date) {
  const previous = attempts
    .filter((attempt) => attempt.mode === 'daily-recognition' && attempt.time?.slice(0, 10) < date && termIds.has(attempt.questionId))
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const correctIds = new Set();
  const pendingWrongIds = new Set();
  let roundCompletedOn = '';
  previous.forEach((attempt) => {
    if (attempt.correct) {
      correctIds.add(attempt.questionId);
      pendingWrongIds.delete(attempt.questionId);
    } else {
      correctIds.delete(attempt.questionId);
      pendingWrongIds.add(attempt.questionId);
    }
    if (correctIds.size === termIds.size) {
      roundCompletedOn = attempt.time.slice(0, 10);
      correctIds.clear();
      pendingWrongIds.clear();
    }
  });
  const wrong = shuffleItems([...pendingWrongIds], seedFromString(`${date}-wrong`)).slice(0, RECOGNITION_LIMIT);
  const wrongIds = new Set(wrong);
  const unseen = [...termIds].filter((id) => !correctIds.has(id) && !wrongIds.has(id));
  const assignmentIds = shuffleItems([
    ...wrong,
    ...shuffleItems(unseen, seedFromString(`${date}-unseen`)).slice(0, Math.max(0, RECOGNITION_LIMIT - wrong.length)),
  ], seedFromString(`${date}-assignment`));
  const answeredIds = new Set();
  attempts
    .filter((attempt) => attempt.mode === 'daily-recognition' && attempt.time?.slice(0, 10) === date && termIds.has(attempt.questionId))
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    .forEach((attempt) => {
      answeredIds.add(attempt.questionId);
      if (attempt.correct) {
        correctIds.add(attempt.questionId);
        pendingWrongIds.delete(attempt.questionId);
      } else {
        correctIds.delete(attempt.questionId);
        pendingWrongIds.add(attempt.questionId);
      }
    });
  if (correctIds.size === termIds.size) roundCompletedOn = date;
  return {
    correctIds: [...correctIds].sort(),
    pendingWrongIds: [...pendingWrongIds].sort(),
    roundCompletedOn,
    dailyDate: date,
    assignmentIds,
    answeredIds: [...answeredIds],
  };
}

async function main() {
  loadLocalEnv();
  const email = process.env.TERMINAL_PRACTICE_EMAIL;
  const password = process.env.TERMINAL_PRACTICE_PASSWORD;
  if (!email || !password) throw new Error('Terminal Firebase credentials are required');
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const uid = credential.user.uid;
  const [recordsSnap, shardsSnap, daysSnap] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'records')),
    getDocs(collection(db, 'users', uid, 'progressShards')),
    getDocs(collection(db, 'users', uid, 'reviewDays')),
  ]);
  const termIds = new Set();
  const validQuestionIds = new Set();
  recordsSnap.docs.forEach((recordSnap) => {
    const record = recordSnap.data();
    const recordId = record.id || recordSnap.id;
    termIds.add(recordId);
    validQuestionIds.add(recordId);
    (record.item?.meanings || []).forEach((meaning) => {
      (meaning.examples || []).forEach((example) => {
        if (example.id) validQuestionIds.add(example.id);
      });
    });
  });
  const entries = {};
  let originalProgressCount = 0;
  shardsSnap.docs.forEach((shard) => {
    Object.entries(shard.data().entries || {}).forEach(([questionId, entry]) => {
      originalProgressCount += 1;
      if (validQuestionIds.has(questionId)) entries[questionId] = entry;
    });
  });
  const attempts = daysSnap.docs.flatMap((day) => day.data().attempts || []);
  const recognition = buildRecognitionState(attempts, termIds, todayInTaipei());
  const shards = Object.fromEntries(Array.from({ length: SHARD_COUNT }, (_, index) => [String(index).padStart(2, '0'), {}]));
  Object.entries(entries).forEach(([questionId, entry]) => {
    shards[progressShardId(questionId)][questionId] = entry;
  });
  await commitOperations(Object.entries(shards).map(([shardId, shardEntries]) => (batch) => batch.set(
    doc(db, 'users', uid, 'progressShards', shardId),
    { entries: shardEntries, updatedAt: serverTimestamp() },
  )));
  await setDoc(doc(db, 'users', uid, 'settings', 'review'), { recognition, updatedAt: serverTimestamp() }, { merge: true });

  let legacyDeleted = 0;
  for (const name of LEGACY_COLLECTIONS) {
    const snap = await getDocs(collection(db, 'users', uid, name));
    legacyDeleted += snap.size;
    await commitOperations(snap.docs.map((entry) => (batch) => batch.delete(entry.ref)));
  }
  await Promise.all([
    deleteDoc(doc(db, 'users', uid, 'appState', 'reviewState')),
    deleteDoc(doc(db, 'users', uid, 'meta', 'replaceCurrentAppData')),
    deleteDoc(doc(db, 'users', uid, 'meta', 'contentSchemaV2')),
  ]);
  const verifyShards = await getDocs(collection(db, 'users', uid, 'progressShards'));
  const verifiedEntries = Object.assign({}, ...verifyShards.docs.map((entry) => entry.data().entries || {}));
  const remainingLegacy = await Promise.all(LEGACY_COLLECTIONS.map((name) => getDocs(collection(db, 'users', uid, name))));
  if (Object.keys(verifiedEntries).some((id) => !validQuestionIds.has(id))) throw new Error('Orphan progress remains after optimization');
  if (remainingLegacy.some((snap) => !snap.empty)) throw new Error('Legacy collections remain after optimization');
  console.log(`Optimized v3: ${recordsSnap.size} cards, ${Object.keys(verifiedEntries).length} progress entries, ${attempts.length} attempts.`);
  console.log(`Recognition: ${recognition.correctIds.length} correct, ${recognition.pendingWrongIds.length} pending wrong, ${recognition.assignmentIds.length} assigned today.`);
  console.log(`Removed ${legacyDeleted} legacy documents and ${originalProgressCount - Object.keys(verifiedEntries).length} invalid progress entries.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
