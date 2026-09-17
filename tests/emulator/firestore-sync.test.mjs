import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';

import {
  createReviewAttemptWriteOperations,
  reviewAttemptSegmentId,
} from '../../src/repositories/reviewDaysRepository.js';
import { createReviewStoreWriteOperations } from '../../src/repositories/reviewStoreRepository.js';
import { emptyStore, progressShardId } from '../../src/review-engine/store.js';

const PROJECT_ID = 'demo-korean-review-web';
let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});

beforeEach(async () => environment.clearFirestore());
after(async () => environment?.cleanup());

test('rules isolate users and enforce the progress shard contract', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  const stranger = environment.authenticatedContext('stranger').firestore();
  await assertSucceeds(setDoc(doc(owner, 'users/owner/progressShards/15'), { entries: {} }));
  await assertFails(setDoc(doc(owner, 'users/owner/progressShards/16'), { entries: {} }));
  await assertSucceeds(setDoc(doc(owner, 'users/owner/reviewDays/2026-09-14/attemptSegments/00'), { attempts: [] }));
  await assertFails(getDocs(collection(stranger, 'users/owner/progressShards')));
});

test('updatedAt delta queries deliver a tombstone to another client', async () => {
  const first = environment.authenticatedContext('owner').firestore();
  const second = environment.authenticatedContext('owner').firestore();
  const checkpoint = Timestamp.fromMillis(1_000);
  const record = doc(first, 'users/owner/records/word');
  await setDoc(record, { id: 'word', item: { ko: '가다' }, updatedAt: Timestamp.fromMillis(2_000) });
  let snapshot = await getDocs(query(collection(second, 'users/owner/records'), where('updatedAt', '>', checkpoint)));
  assert.equal(snapshot.size, 1);
  await setDoc(record, { id: 'word', deletedAt: Timestamp.fromMillis(3_000), updatedAt: Timestamp.fromMillis(3_000) });
  snapshot = await getDocs(query(collection(second, 'users/owner/records'), where('updatedAt', '>', Timestamp.fromMillis(2_000))));
  assert.equal(snapshot.docs[0].data().deletedAt.toMillis(), 3_000);
});

test('all incrementally cached content collections expose deletion tombstones', async () => {
  const first = environment.authenticatedContext('owner').firestore();
  const second = environment.authenticatedContext('owner').firestore();
  const collections = ['folders', 'grammarNotes', 'ytSubtitles', 'readingTests'];
  for (const collectionName of collections) {
    const reference = doc(first, `users/owner/${collectionName}/entry`);
    await setDoc(reference, { id: 'entry', deletedAt: Timestamp.fromMillis(3_000), updatedAt: Timestamp.fromMillis(3_000) });
    const snapshot = await getDocs(query(
      collection(second, `users/owner/${collectionName}`),
      where('updatedAt', '>', Timestamp.fromMillis(2_000)),
    ));
    assert.equal(snapshot.size, 1);
    assert.equal(snapshot.docs[0].data().deletedAt.toMillis(), 3_000);
  }
});

test('two clients can append attempts without losing either result', async () => {
  const first = environment.authenticatedContext('owner').firestore();
  const second = environment.authenticatedContext('owner').firestore();
  const date = '2026-09-14';
  const segmentId = reviewAttemptSegmentId('shared-segment');
  const referenceA = doc(first, `users/owner/reviewDays/${date}/attemptSegments/${segmentId}`);
  const referenceB = doc(second, `users/owner/reviewDays/${date}/attemptSegments/${segmentId}`);
  await Promise.all([
    setDoc(referenceA, { attempts: arrayUnion({ id: 'a', time: `${date}T01:00:00Z` }) }, { merge: true }),
    setDoc(referenceB, { attempts: arrayUnion({ id: 'b', time: `${date}T01:00:01Z` }) }, { merge: true }),
  ]);
  const snapshot = await getDocs(collection(first, `users/owner/reviewDays/${date}/attemptSegments`));
  assert.deepEqual(new Set(snapshot.docs.flatMap((entry) => entry.data().attempts.map((attempt) => attempt.id))), new Set(['a', 'b']));
});

test('repository batches create a summary and segmented attempt log', async () => {
  const firestore = environment.authenticatedContext('owner').firestore();
  const attempt = { id: 'attempt', date: '2026-09-14', time: '2026-09-14T01:00:00Z', correct: true };
  const batch = writeBatch(firestore);
  createReviewAttemptWriteOperations(firestore, 'owner', [], [attempt]).forEach((operation) => operation(batch));
  await assertSucceeds(batch.commit());
  const segments = await getDocs(collection(firestore, 'users/owner/reviewDays/2026-09-14/attemptSegments'));
  assert.equal(segments.size, 1);
  assert.equal(segments.docs[0].data().attempts[0].id, 'attempt');
});

test('review store writes first-time answers and updates existing progress without losing neighboring entries', async () => {
  const firestore = environment.authenticatedContext('owner').firestore();
  const uid = 'owner';
  const date = '2026-09-14';
  const questionId = 'word.1/ko';
  const attempt = { id: 'wrong-1', date, time: `${date}T01:00:00Z`, correct: false };
  const first = {
    ...emptyStore(),
    stats: { [questionId]: { correct: 0, wrong: 1 } },
    progress: { [questionId]: { dueDate: '2026-09-15' } },
    attempts: [attempt],
    starred: ['word.1'],
    recognition: { 'word.1': true },
  };
  const write = async (previous, next) => {
    const batch = writeBatch(firestore);
    createReviewStoreWriteOperations(firestore, uid, previous, next, 3)
      .forEach((operation) => operation(batch));
    await assertSucceeds(batch.commit());
  };

  await write(emptyStore(), first);
  const shardRef = doc(firestore, `users/${uid}/progressShards/${progressShardId(questionId)}`);
  assert.deepEqual((await getDoc(shardRef)).data().entries[questionId], {
    stats: { correct: 0, wrong: 1 },
    progress: { dueDate: '2026-09-15' },
  });
  const attempts = await getDocs(collection(firestore, `users/${uid}/reviewDays/${date}/attemptSegments`));
  assert.equal(attempts.docs.flatMap((entry) => entry.data().attempts).length, 1);
  assert.deepEqual((await getDoc(doc(firestore, `users/${uid}/settings/review`))).data().starred, ['word.1']);

  const neighborId = 'neighbor';
  await setDoc(shardRef, { entries: { [neighborId]: { stats: { correct: 2 } } } }, { merge: true });
  const second = { ...first, stats: { [questionId]: { correct: 1, wrong: 1 } }, completedReviewDates: [date] };
  await write(first, second);
  const updated = (await getDoc(shardRef)).data().entries;
  assert.equal(updated[questionId].stats.correct, 1);
  assert.equal(updated[neighborId].stats.correct, 2);
  assert.deepEqual((await getDoc(doc(firestore, `users/${uid}/settings/review`))).data().completedReviewDates, [date]);

  await write(second, { ...second, stats: {}, progress: {} });
  const cleared = (await getDoc(shardRef)).data().entries;
  assert.equal(cleared[questionId], undefined);
  assert.equal(cleared[neighborId].stats.correct, 2);
});

test('steady-state incremental sync reads only documents newer than its checkpoint', async () => {
  const writer = environment.authenticatedContext('owner').firestore();
  const reader = environment.authenticatedContext('owner').firestore();
  const batch = writeBatch(writer);
  for (let index = 0; index < 100; index += 1) {
    batch.set(doc(writer, `users/owner/records/old-${index}`), {
      id: `old-${index}`,
      updatedAt: Timestamp.fromMillis(1_000),
    });
  }
  for (let index = 0; index < 3; index += 1) {
    batch.set(doc(writer, `users/owner/records/new-${index}`), {
      id: `new-${index}`,
      updatedAt: Timestamp.fromMillis(3_000 + index),
    });
  }
  await batch.commit();

  const snapshot = await getDocs(query(
    collection(reader, 'users/owner/records'),
    where('updatedAt', '>', Timestamp.fromMillis(2_000)),
  ));

  assert.equal(snapshot.size, 3, 'incremental startup must not reload the 100 unchanged records');
});

test('offline-style field merges from two clients preserve independent changes', async () => {
  const first = environment.authenticatedContext('owner').firestore();
  const second = environment.authenticatedContext('owner').firestore();
  const referenceA = doc(first, 'users/owner/settings/review');
  const referenceB = doc(second, 'users/owner/settings/review');

  await setDoc(referenceA, { starred: { wordA: true } }, { merge: true });
  await setDoc(referenceB, { completedDates: { '2026-09-16': true } }, { merge: true });

  const review = (await getDoc(referenceA)).data();
  assert.deepEqual(review.starred, { wordA: true });
  assert.deepEqual(review.completedDates, { '2026-09-16': true });
});

test('completed review dates are append-only even when other settings are merged', async () => {
  const firestore = environment.authenticatedContext('owner').firestore();
  const reference = doc(firestore, 'users/owner/settings/review');

  await assertSucceeds(setDoc(reference, {
    completedReviewDates: ['2026-09-15'],
    starred: {},
  }));
  await assertSucceeds(setDoc(reference, {
    completedReviewDates: arrayUnion('2026-09-16'),
    starred: { wordA: true },
  }, { merge: true }));
  await assertFails(setDoc(reference, {
    completedReviewDates: ['2026-09-16'],
  }, { merge: true }));
});
