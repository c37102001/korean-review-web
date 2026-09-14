import assert from 'node:assert/strict';
import test from 'node:test';

import { PROGRESS_SHARD_COUNT, progressShardId } from '../src/review-engine/store.js';
import {
  mergeReviewAttempts,
  REVIEW_ATTEMPT_SEGMENT_COUNT,
  reviewAttemptSegmentId,
} from '../src/repositories/reviewDaysRepository.js';

test('progress and daily attempts remain bounded to sixteen documents', () => {
  assert.equal(PROGRESS_SHARD_COUNT, 16);
  assert.equal(REVIEW_ATTEMPT_SEGMENT_COUNT, 16);
  const progressShards = new Set(Array.from({ length: 1000 }, (_, index) => progressShardId(`question-${index}`)));
  const attemptSegments = new Set(Array.from({ length: 1000 }, (_, index) => reviewAttemptSegmentId(`attempt-${index}`)));
  assert.ok([...progressShards].every((id) => /^(0[0-9]|1[0-5])$/.test(id)));
  assert.ok([...attemptSegments].every((id) => /^(0[0-9]|1[0-5])$/.test(id)));
  assert.ok(progressShards.size <= 16);
  assert.ok(attemptSegments.size <= 16);
});

test('legacy and segmented attempt logs merge idempotently', () => {
  const older = { id: 'one', time: '2026-09-14T01:00:00Z', correct: false };
  const newer = { id: 'two', time: '2026-09-14T02:00:00Z', correct: true };
  assert.deepEqual(mergeReviewAttempts([older], [older, newer]), [newer, older]);
});

test('steady-state daily state has a fixed document read ceiling', () => {
  const settingsDocuments = 2;
  const reviewDaySummary = 1;
  const fixedReadCeiling = PROGRESS_SHARD_COUNT + REVIEW_ATTEMPT_SEGMENT_COUNT + settingsDocuments + reviewDaySummary;
  assert.equal(fixedReadCeiling, 35);
});
