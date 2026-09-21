import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildJsonImportDraft,
  createRecordsFromImportEntries,
  createRecordsForDate,
  findImportConflict,
  formatSingleWordJson,
  parseEditedImportItem,
  parseSingleWordEditJson,
  resolveImportConflictDraft,
} from '../src/features/word-import/model.js';

test('word import domain loads without React, Vite, or Firebase', () => {
  const draft = buildJsonImportDraft(JSON.stringify({
    schemaVersion: 2,
    data: [{ ko: '하나도', pos: '副詞', meanings: [{ zh: '一點都不', examples: [] }] }],
  }), '2026-09-16');
  assert.equal(draft.entries.length, 1);
  assert.equal(draft.entries[0].item.ko, '하나도');
});

test('JSON import sends missing and unsupported word types to per-item review', () => {
  const draft = buildJsonImportDraft(JSON.stringify({ data: [
    { ko: '가다', meanings: [{ zh: '去' }] },
    { ko: '오다', pos: '動詞片語', meanings: [{ zh: '來' }] },
    { ko: '보다', pos: '動詞', meanings: [{ zh: '看' }] },
  ] }), '2026-09-16');
  assert.deepEqual(draft.invalid.map((issue) => issue.index), [0, 1]);
  assert.equal(draft.entries[2].item.pos, '動詞');
  assert.equal(parseEditedImportItem(JSON.stringify({ ...JSON.parse(draft.invalid[0].text), pos: '動詞' })).pos, '動詞');
});

test('record creation cannot bypass the canonical word type check', () => {
  const item = { ko: '가다', meanings: [{ zh: '去' }] };
  assert.throws(() => createRecordsForDate('2026-09-16', [item]), /pos/);
  assert.throws(() => createRecordsFromImportEntries([
    { action: 'add', index: 0, item: { ...item, pos: '動詞片語' } },
  ], '2026-09-16'), /pos/);
});

test('word import preserves JSON order and resolves replacement conflicts', () => {
  const existing = {
    id: 'existing', date: '2026-09-01', order: 1, ko: '하나도',
    meanings: [{ id: 'old-meaning', zh: '舊資料', examples: [] }], related: [], notes: [],
  };
  let draft = buildJsonImportDraft(JSON.stringify({
    schemaVersion: 2,
    data: [
      { ko: '하나도', pos: '副詞', meanings: [{ zh: '一點都不', examples: [] }] },
      { ko: '직접', pos: '副詞', meanings: [{ zh: '親自', examples: [] }] },
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
    id: 'word', date: '2026-09-14', ko: '나름', pos: '名詞', meanings: [
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
    id: 'word', date: '2026-09-14', ko: '숨기다', pos: '動詞', variants: ['숨길', ' 숨겨요 ', '숨길', '숨기다'],
    meanings: [{ id: 'meaning', zh: '藏起來', examples: [] }], notes: [], related: [],
  };
  const document = JSON.parse(formatSingleWordJson(original));
  assert.deepEqual(document.data[0].variants, original.variants);
  const edited = parseSingleWordEditJson(JSON.stringify(document), original, [original]);
  assert.deepEqual(edited.variants, ['숨길', '숨겨요']);
});
