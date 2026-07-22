import fs from 'node:fs';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from '../src/firebase.js';

const SCHEMA_VERSION = 3;
const PROGRESS_SHARD_COUNT = 16;
const CLEANUP_COLLECTIONS = ['days', 'items', 'questions', 'cards'];

function loadLocalEnv() {
  if (!fs.existsSync('.env')) return;
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match || process.env[match[1]]) return;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  });
}

async function commitOperations(operations, chunkSize = 400) {
  for (let start = 0; start < operations.length; start += chunkSize) {
    const batch = writeBatch(db);
    operations.slice(start, start + chunkSize).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

function groupAttemptsByDate(attempts = []) {
  return attempts.reduce((groups, attempt) => {
    const date = attempt.time?.slice(0, 10);
    if (!date) return groups;
    if (!groups[date]) groups[date] = [];
    groups[date].push(attempt);
    return groups;
  }, {});
}

function progressShardId(questionId) {
  const hash = [...questionId].reduce((sum, character) => sum + character.codePointAt(0), 0);
  return String(hash % PROGRESS_SHARD_COUNT).padStart(2, '0');
}

function buildProgressShards(stats, progress) {
  const shards = {};
  new Set([...Object.keys(stats), ...Object.keys(progress)]).forEach((questionId) => {
    const shardId = progressShardId(questionId);
    if (!shards[shardId]) shards[shardId] = {};
    shards[shardId][questionId] = {
      stats: stats[questionId] || null,
      progress: progress[questionId] || null,
    };
  });
  return shards;
}

async function deleteCollection(uid, name) {
  const snap = await getDocs(collection(db, 'users', uid, name));
  await commitOperations(snap.docs.map((documentSnap) => (batch) => batch.delete(documentSnap.ref)));
  return snap.size;
}

async function cleanupLegacyData(uid) {
  for (const name of CLEANUP_COLLECTIONS) {
    const deleted = await deleteCollection(uid, name);
    console.log(`Deleted ${deleted} documents from ${name}.`);
  }
  await Promise.all([
    deleteDoc(doc(db, 'users', uid, 'appState', 'reviewState')),
    deleteDoc(doc(db, 'users', uid, 'meta', 'replaceCurrentAppData')),
    deleteDoc(doc(db, 'users', uid, 'meta', 'contentSchemaV2')),
  ]);
  console.log('Legacy Firestore data removed.');
}

async function verifyV3(uid, expected) {
  const [settingsSnap, progressSnap, reviewDaysSnap] = await Promise.all([
    getDoc(doc(db, 'users', uid, 'settings', 'review')),
    getDocs(collection(db, 'users', uid, 'progressShards')),
    getDocs(collection(db, 'users', uid, 'reviewDays')),
  ]);
  const settings = settingsSnap.data() || {};
  const progressEntries = Object.assign({}, ...progressSnap.docs.map((entry) => entry.data().entries || {}));
  const progressIds = new Set(Object.keys(progressEntries));
  const actualAttempts = reviewDaysSnap.docs.flatMap((entry) => entry.data().attempts || []);
  const missingQuestionIds = [...expected.questionIds].filter((id) => !progressIds.has(id));
  if (settings.schemaVersion !== SCHEMA_VERSION) throw new Error('v3 settings marker is missing');
  if (missingQuestionIds.length) throw new Error(`${missingQuestionIds.length} question progress documents are missing`);
  expected.questionIds.forEach((questionId) => {
    const expectedEntry = { stats: expected.stats[questionId] || null, progress: expected.progress[questionId] || null };
    if (!isDeepStrictEqual(progressEntries[questionId], expectedEntry)) {
      throw new Error(`question progress mismatch: ${questionId}`);
    }
  });
  const byId = (attempts) => [...attempts].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!isDeepStrictEqual(byId(actualAttempts), byId(expected.attempts))) throw new Error('attempt data mismatch');
  if (!isDeepStrictEqual(settings.completedReviewDates || [], expected.completedReviewDates)) throw new Error('completed review dates mismatch');
  if (!isDeepStrictEqual(settings.starred || [], expected.starred)) throw new Error('starred items mismatch');
  return { progressCount: progressIds.size, shardCount: progressSnap.size, reviewDayCount: reviewDaysSnap.size, attemptCount: actualAttempts.length };
}

async function main() {
  loadLocalEnv();
  const email = process.env.TERMINAL_PRACTICE_EMAIL;
  const password = process.env.TERMINAL_PRACTICE_PASSWORD;
  if (!email || !password) throw new Error('TERMINAL_PRACTICE_EMAIL and TERMINAL_PRACTICE_PASSWORD are required');

  const credential = await signInWithEmailAndPassword(auth, email, password);
  const uid = credential.user.uid;
  const legacySnap = await getDoc(doc(db, 'users', uid, 'appState', 'reviewState'));
  const currentSettingsSnap = await getDoc(doc(db, 'users', uid, 'settings', 'review'));
  if (currentSettingsSnap.data()?.schemaVersion === SCHEMA_VERSION && !process.argv.includes('--force')) {
    if (process.argv.includes('--cleanup')) await cleanupLegacyData(uid);
    else console.log('Firestore is already using schema v3; migration skipped. Use --force only for intentional replacement.');
    return;
  }
  if (!legacySnap.exists()) {
    if (currentSettingsSnap.data()?.schemaVersion !== SCHEMA_VERSION) throw new Error('Neither legacy state nor a verified v3 state exists');
    console.log('Firestore is already using schema v3; no legacy app state remains.');
    return;
  }
  const legacy = legacySnap.exists() ? legacySnap.data() : {};
  const stats = legacy.stats || {};
  const progress = legacy.progress || {};
  const attempts = legacy.attempts || [];
  const questionIds = new Set([...Object.keys(stats), ...Object.keys(progress)]);

  const operations = [];
  Object.entries(buildProgressShards(stats, progress)).forEach(([shardId, entries]) => {
    operations.push((batch) => batch.set(doc(db, 'users', uid, 'progressShards', shardId), {
      entries,
      updatedAt: serverTimestamp(),
    }));
  });
  Object.entries(groupAttemptsByDate(attempts)).forEach(([date, dayAttempts]) => {
    operations.push((batch) => batch.set(doc(db, 'users', uid, 'reviewDays', date), {
      date,
      attempts: dayAttempts,
      updatedAt: serverTimestamp(),
    }));
  });
  await commitOperations(operations);

  const settingsBatch = writeBatch(db);
  settingsBatch.set(doc(db, 'users', uid, 'settings', 'review'), {
    schemaVersion: SCHEMA_VERSION,
    completedReviewDates: legacy.completedReviewDates || [],
    starred: legacy.starred || [],
    migratedLegacyUpdatedAt: legacy.updatedAt || null,
    updatedAt: serverTimestamp(),
  });
  await settingsBatch.commit();

  const verified = await verifyV3(uid, {
    questionIds,
    stats,
    progress,
    attempts,
    completedReviewDates: legacy.completedReviewDates || [],
    starred: legacy.starred || [],
  });
  console.log(`Verified v3: ${verified.progressCount} progress in ${verified.shardCount} shards, ${verified.reviewDayCount} days, ${verified.attemptCount} attempts.`);

  if (!process.argv.includes('--cleanup')) {
    console.log('Legacy data retained. Run again with --cleanup after the application has been checked.');
    return;
  }

  await cleanupLegacyData(uid);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
