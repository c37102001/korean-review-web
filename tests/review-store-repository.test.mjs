import assert from 'node:assert/strict';
import test from 'node:test';
import { writeBatch } from 'firebase/firestore';

import { db } from '../src/firebase.js';
import { emptyStore } from '../src/review-engine/store.js';
import { createReviewStoreWriteOperations, persistFirestoreStoreChanges } from '../src/repositories/reviewStoreRepository.js';

test('shared review persistence is defined and creates valid Firestore writes for an answer', () => {
  assert.equal(typeof persistFirestoreStoreChanges, 'function');
  const previous = emptyStore();
  const next = {
    ...previous,
    stats: { 'word.1/ko': { wrong: 1 } },
    progress: { 'word.1/ko': { dueDate: '2026-09-18' } },
    attempts: [{ id: 'attempt-1', date: '2026-09-17', time: '2026-09-17T12:00:00Z', correct: false }],
    starred: ['word.1'],
  };
  const operations = createReviewStoreWriteOperations(db, 'test-user', previous, next, 3);
  assert.equal(operations.length, 4);
  const batch = writeBatch(db);
  assert.doesNotThrow(() => operations.forEach((operation) => operation(batch)));
  assert.deepEqual(createReviewStoreWriteOperations(db, 'test-user', next, next, 3), []);

  const removed = { ...next, stats: {}, progress: {} };
  const removal = createReviewStoreWriteOperations(db, 'test-user', next, removed, 3);
  assert.equal(removal.length, 1);
  assert.doesNotThrow(() => removal.forEach((operation) => operation(writeBatch(db))));
});
