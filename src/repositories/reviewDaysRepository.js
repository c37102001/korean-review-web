import {
  arrayUnion,
  collection,
  doc,
  serverTimestamp,
} from 'firebase/firestore';

export const REVIEW_ATTEMPT_SEGMENT_COUNT = 16;
export const REVIEW_DAY_STORAGE_VERSION = 2;

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function reviewAttemptSegmentId(attemptId) {
  return String(stableHash(attemptId) % REVIEW_ATTEMPT_SEGMENT_COUNT).padStart(2, '0');
}

export function reviewDayRef(db, uid, date) {
  return doc(db, 'users', uid, 'reviewDays', date);
}

export function reviewAttemptSegmentsRef(db, uid, date) {
  return collection(reviewDayRef(db, uid, date), 'attemptSegments');
}

export function attemptsFromSegmentsSnapshot(snapshot) {
  return snapshot.docs.flatMap((documentSnapshot) => documentSnapshot.data().attempts || []);
}

export function mergeReviewAttempts(...attemptLists) {
  const byId = new Map();
  attemptLists.flat().forEach((attempt) => {
    if (attempt?.id) byId.set(attempt.id, attempt);
  });
  return [...byId.values()]
    .sort((left, right) => (right.time || '').localeCompare(left.time || ''))
    .slice(0, 5000);
}

export function createReviewAttemptWriteOperations(db, uid, previousAttempts, addedAttempts) {
  const operations = [];
  const previousDates = new Set((previousAttempts || []).map((attempt) => attempt?.date || attempt?.time?.slice(0, 10)).filter(Boolean));
  const byDateAndSegment = new Map();
  (addedAttempts || []).forEach((attempt) => {
    const date = attempt?.date || attempt?.time?.slice(0, 10);
    if (!date || !attempt?.id) return;
    const segmentId = reviewAttemptSegmentId(attempt.id);
    const key = `${date}/${segmentId}`;
    if (!byDateAndSegment.has(key)) byDateAndSegment.set(key, { date, segmentId, attempts: [] });
    byDateAndSegment.get(key).attempts.push(attempt);
  });
  const initializedDates = new Set();
  byDateAndSegment.forEach(({ date, segmentId, attempts }) => {
    if (!previousDates.has(date) && !initializedDates.has(date)) {
      initializedDates.add(date);
      operations.push((batch) => batch.set(reviewDayRef(db, uid, date), {
        date,
        attemptStorageVersion: REVIEW_DAY_STORAGE_VERSION,
        createdAt: serverTimestamp(),
      }, { merge: true }));
    }
    const segmentRef = doc(reviewAttemptSegmentsRef(db, uid, date), segmentId);
    operations.push((batch) => batch.set(segmentRef, {
      date,
      segmentId,
      attempts: arrayUnion(...attempts),
      updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  return operations;
}
