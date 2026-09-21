import assert from 'node:assert/strict';
import test from 'node:test';

import { eligibleQuestions, eligibleWordItems, reviewExcludedWordIds } from '../src/words/reviewEligibility.js';
import { normalizeItemToV2 } from '../src/words/records.js';
import { createRecordsFromImportEntries, formatSingleWordJson, parseSingleWordEditJson, validateImportItem } from '../src/features/word-import/model.js';

const base = {
  ko: '가다', pos: '動詞', meanings: [{ zh: '去', examples: [{ ko: '집에 가요.', zh: '回家。' }] }],
};

test('noReview is optional, boolean, and survives normalization and JSON editing', () => {
  assert.doesNotThrow(() => validateImportItem(base, 0));
  assert.doesNotThrow(() => validateImportItem({ ...base, noReview: true }, 0));
  assert.throws(() => validateImportItem({ ...base, noReview: 'true' }, 0), /noReview/);
  assert.equal(normalizeItemToV2(base, 'word').noReview, undefined);
  assert.equal(normalizeItemToV2({ ...base, noReview: true }, 'word').noReview, true);
  const original = { id: 'word', date: '2026-09-21', ...normalizeItemToV2(base, 'word') };
  const document = JSON.parse(formatSingleWordJson(original));
  assert.equal(document.data[0].noReview, undefined);
  document.data[0].noReview = true;
  assert.equal(parseSingleWordEditJson(JSON.stringify(document), original, [original]).noReview, true);
  delete document.data[0].noReview;
  assert.equal(parseSingleWordEditJson(JSON.stringify(document), original, [original]).noReview, undefined);
});

test('learned membership and noReview independently exclude term and example questions', () => {
  const items = [{ id: 'normal' }, { id: 'paused', noReview: true }, { id: 'learned' }];
  const excluded = reviewExcludedWordIds(items, new Set(['learned']));
  assert.deepEqual([...excluded].sort(), ['learned', 'paused']);
  assert.deepEqual(eligibleWordItems(items, excluded).map(({ id }) => id), ['normal']);
  const questions = [
    { id: 'normal-term', itemId: 'normal' },
    { id: 'paused-term', itemId: 'paused' },
    { id: 'paused-example', itemId: 'paused' },
    { id: 'learned-term', itemId: 'learned' },
    { id: 'grammar', itemId: 'grammar-note' },
    { id: 'grammar-shared-id', itemId: 'paused', kind: 'grammar-example' },
  ];
  assert.deepEqual(eligibleQuestions(questions, excluded).map(({ id }) => id), ['normal-term', 'grammar', 'grammar-shared-id']);
});

test('replacing an existing word with older JSON preserves noReview unless explicitly changed', () => {
  const existing = { id: 'word', date: '2026-09-21', noReview: true, ...base };
  const entry = { index: 0, action: 'update', existing, item: base };
  const first = createRecordsFromImportEntries([entry], existing.date, [existing]);
  assert.equal(first.updateRecords[0].item.noReview, true);
  const second = createRecordsFromImportEntries([{ ...entry, item: { ...base, noReview: false } }], existing.date, [existing]);
  assert.equal(second.updateRecords[0].item.noReview, undefined);
});
