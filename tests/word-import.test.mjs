import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildJsonImportDraft,
  createRecordsFromImportEntries,
  findImportConflict,
  formatSingleWordJson,
  parseSingleWordEditJson,
  resolveImportConflictDraft,
} from '../src/features/word-import/model.js';

test('word import domain loads without React, Vite, or Firebase', () => {
  const draft = buildJsonImportDraft(JSON.stringify({
    schemaVersion: 2,
    data: [{ ko: '하나도', meanings: [{ zh: '一點都不', examples: [] }] }],
  }), '2026-09-16');
  assert.equal(draft.entries.length, 1);
  assert.equal(draft.entries[0].item.ko, '하나도');
});

test('word import preserves JSON order and resolves replacement conflicts', () => {
  const existing = {
    id: 'existing', date: '2026-09-01', order: 1, ko: '하나도',
    meanings: [{ id: 'old-meaning', zh: '舊資料', examples: [] }], related: [], notes: [],
  };
  let draft = buildJsonImportDraft(JSON.stringify({
    schemaVersion: 2,
    data: [
      { ko: '하나도', meanings: [{ zh: '一點都不', examples: [] }] },
      { ko: '직접', meanings: [{ zh: '親自', examples: [] }] },
    ],
  }), '2026-09-16');
  draft = { ...draft, conflict: findImportConflict(draft.entries, [existing]) };
  draft = resolveImportConflictDraft(draft, 'incoming', [existing]);
  const records = createRecordsFromImportEntries(draft.entries, draft.targetDate, [existing]);
  assert.deepEqual(
    [...records.updateRecords, ...records.addRecords].sort((left, right) => left.order - right.order).map((record) => record.item.ko),
    ['하나도', '직접'],
  );
});

test('single-word JSON editing preserves stable nested ids', () => {
  const original = {
    id: 'word', date: '2026-09-14', ko: '나름', meanings: [
      { id: 'meaning', zh: '自己的方式', examples: [{ id: 'example', ko: '나름대로 했어요.', zh: '照自己的方式做了。' }] },
    ], notes: [], related: [],
  };
  const document = JSON.parse(formatSingleWordJson(original));
  document.data[0].notes = ['補充'];
  const edited = parseSingleWordEditJson(JSON.stringify(document), original, [original]);
  assert.equal(edited.meanings[0].id, 'meaning');
  assert.equal(edited.meanings[0].examples[0].id, 'example');
  assert.deepEqual(edited.notes, ['補充']);
});

test('optional word variants round-trip through JSON and normalize duplicates', () => {
  const original = {
    id: 'word', date: '2026-09-14', ko: '숨기다', variants: ['숨길', ' 숨겨요 ', '숨길', '숨기다'],
    meanings: [{ id: 'meaning', zh: '藏起來', examples: [] }], notes: [], related: [],
  };
  const document = JSON.parse(formatSingleWordJson(original));
  assert.deepEqual(document.data[0].variants, original.variants);
  const edited = parseSingleWordEditJson(JSON.stringify(document), original, [original]);
  assert.deepEqual(edited.variants, ['숨길', '숨겨요']);
});
