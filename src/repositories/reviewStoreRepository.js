import { arrayUnion, deleteField, doc, FieldPath, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { progressShardId } from '../review-engine/store.js';
import { commitFirestoreOperations } from './firestoreWriteRepository.js';
import { createReviewAttemptWriteOperations } from './reviewDaysRepository.js';

export function createReviewStoreWriteOperations(firestore, uid, previous, next, schemaVersion) {
  const operations = [];
  const changedEntriesByShard = new Map();
  const questionIds = new Set([
    ...Object.keys(previous.stats || {}),
    ...Object.keys(previous.progress || {}),
    ...Object.keys(next.stats || {}),
    ...Object.keys(next.progress || {}),
  ]);
  questionIds.forEach((questionId) => {
    const before = { stats: previous.stats?.[questionId] || null, progress: previous.progress?.[questionId] || null };
    const after = { stats: next.stats?.[questionId] || null, progress: next.progress?.[questionId] || null };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const shardId = progressShardId(questionId);
    if (!changedEntriesByShard.has(shardId)) changedEntriesByShard.set(shardId, new Map());
    changedEntriesByShard.get(shardId).set(questionId, after.stats || after.progress ? after : deleteField());
  });
  changedEntriesByShard.forEach((entries, shardId) => {
    const reference = doc(firestore, 'users', uid, 'progressShards', shardId);
    const fields = [...entries.keys()].map((questionId) => new FieldPath('entries', questionId));
    operations.push((batch) => batch.set(reference, {
      entries: Object.fromEntries(entries),
      updatedAt: serverTimestamp(),
    }, { mergeFields: [...fields, 'updatedAt'] }));
  });

  const previousAttemptIds = new Set((previous.attempts || []).map((attempt) => attempt.id));
  const addedAttempts = (next.attempts || []).filter((attempt) => !previousAttemptIds.has(attempt.id));
  operations.push(...createReviewAttemptWriteOperations(firestore, uid, previous.attempts, addedAttempts));

  const previousCompletedDates = new Set(previous.completedReviewDates || []);
  const addedCompletedDates = (next.completedReviewDates || []).filter((date) => !previousCompletedDates.has(date));
  const starredChanged = JSON.stringify(previous.starred || []) !== JSON.stringify(next.starred || []);
  const recognitionChanged = JSON.stringify(previous.recognition || null) !== JSON.stringify(next.recognition || null);
  if (addedCompletedDates.length || starredChanged || recognitionChanged) {
    const settings = { schemaVersion, updatedAt: serverTimestamp() };
    if (addedCompletedDates.length) settings.completedReviewDates = arrayUnion(...addedCompletedDates);
    if (starredChanged) settings.starred = next.starred || [];
    if (recognitionChanged) settings.recognition = next.recognition || null;
    operations.push((batch) => batch.set(doc(firestore, 'users', uid, 'settings', 'review'), settings, { merge: true }));
  }
  return operations;
}

export async function persistFirestoreStoreChanges(uid, previous, next, schemaVersion) {
  await commitFirestoreOperations(createReviewStoreWriteOperations(db, uid, previous, next, schemaVersion));
}
