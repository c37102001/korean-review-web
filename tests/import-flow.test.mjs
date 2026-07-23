import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { createServer } from 'vite';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let server;
let helpers;

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  helpers = await server.ssrLoadModule('/src/main.jsx');
});

after(async () => {
  await server?.close();
});

function item(ko, zh, extra = {}) {
  return {
    ko,
    meanings: [{ zh, examples: [] }],
    related: [],
    ...extra,
  };
}

test('replacing an existing duplicate becomes one update with no second conflict', () => {
  const existing = { id: 'existing-id', date: '2026-07-20', createdAt: '2026-07-20T00:00:00.000Z', ...item('질문', '問題') };
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [item('질문', '提問')] }), '2026-07-22');
  draft.conflict = helpers.findImportConflict(draft.entries, [existing]);

  assert.equal(draft.conflict.type, 'existing');
  const resolved = helpers.resolveImportConflictDraft(draft, 'incoming', [existing]);
  assert.equal(resolved.conflict, null);
  assert.equal(resolved.entries.length, 1);
  assert.equal(resolved.entries[0].action, 'update');

  const records = helpers.createRecordsFromImportEntries(resolved.entries, '2026-07-22', [existing], true);
  assert.equal(records.addRecords.length, 0);
  assert.equal(records.updateRecords.length, 1);
  assert.equal(records.updateRecords[0].id, existing.id);
  assert.equal(records.updateRecords[0].date, existing.date);
  assert.equal(records.updateRecords[0].item.meanings[0].zh, '提問');
  assert.ok(records.updateRecords[0].order > 0);
});

test('replaced existing cards follow their position in the current JSON batch', () => {
  const existing = { id: 'existing-id', date: '2026-07-22', order: 1, ...item('하나도', '舊資料') };
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [
    item('하나도', '一點都不'),
    item('직접', '親自'),
  ] }), '2026-07-22');
  draft.conflict = helpers.findImportConflict(draft.entries, [existing]);
  const resolved = helpers.resolveImportConflictDraft(draft, 'incoming', [existing]);
  const { addRecords, updateRecords } = helpers.createRecordsFromImportEntries(resolved.entries, draft.targetDate, [existing], true);

  const ordered = [...addRecords, ...updateRecords].sort((a, b) => a.order - b.order);
  assert.deepEqual(ordered.map((record) => record.item.ko), ['하나도', '직접']);
});

test('duplicate input ids are reported even when Korean words differ', () => {
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [
    item('질문', '問題', { id: 'same-id' }),
    item('대답', '回答', { id: 'same-id' }),
  ] }), '2026-07-22');
  const conflict = helpers.findImportConflict(draft.entries, []);
  assert.equal(conflict.type, 'input');
  assert.equal(conflict.reason, 'id');
});

test('Korean duplicate matching normalizes Unicode composition', () => {
  const composed = '가';
  const decomposed = composed.normalize('NFD');
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [item(composed, '一'), item(decomposed, '二')] }), '2026-07-22');
  const conflict = helpers.findImportConflict(draft.entries, []);
  assert.equal(conflict.reason, 'ko');
  assert.equal(helpers.normalizeKoreanKey(composed), helpers.normalizeKoreanKey(decomposed));
});

test('generated ids remain stable across retries and locked imports force the selected date', () => {
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [item('새롭다', '新', { date: '2026-01-01' })] }), '2026-07-22');
  const first = helpers.createRecordsFromImportEntries(draft.entries, draft.targetDate, [], true).addRecords[0];
  const retry = helpers.createRecordsFromImportEntries(draft.entries, draft.targetDate, [], true).addRecords[0];
  assert.equal(first.id, retry.id);
  assert.equal(first.date, '2026-07-22');
});

test('JSON array order is persisted as ascending record order', () => {
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [
    item('첫째', '第一'),
    item('둘째', '第二'),
    item('셋째', '第三'),
  ] }), '2026-07-22');
  const records = helpers.createRecordsFromImportEntries(draft.entries, draft.targetDate, [], true).addRecords;

  assert.deepEqual(records.map((record) => record.item.ko), ['첫째', '둘째', '셋째']);
  assert.ok(records[0].order < records[1].order);
  assert.ok(records[1].order < records[2].order);
});

test('explicit exported order is preserved when importing', () => {
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [
    item('순서', '順序', { order: 123456 }),
  ] }), '2026-07-22');
  const record = helpers.createRecordsFromImportEntries(draft.entries, draft.targetDate, [], true).addRecords[0];
  assert.equal(record.order, 123456);
});

test('Firebase date records use ascending order and a stable id fallback', () => {
  const values = [
    { id: 'third', date: '2026-07-22', order: 10 },
    { id: 'second', date: '2026-07-22', order: 20 },
    { id: 'first', date: '2026-07-22', order: 20 },
  ];
  const records = helpers.recordsFromSnapshot({
    docs: values.map((value) => ({ data: () => value })),
  });
  assert.deepEqual(records.map((record) => record.id), ['third', 'first', 'second']);
});

test('empty JSON imports are rejected before opening review', () => {
  assert.throws(() => helpers.buildJsonImportDraft('{"data":[]}', '2026-07-22'), /至少需要包含 1 筆/);
});

test('editing a replacement into another existing Korean word is rejected', () => {
  const first = { id: 'first', date: '2026-07-20', ...item('질문', '問題') };
  const second = { id: 'second', date: '2026-07-20', ...item('대답', '回答') };
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [item('질문', '提問')] }), '2026-07-22');
  draft.conflict = helpers.findImportConflict(draft.entries, [first, second]);
  draft.conflict.editText = JSON.stringify(item('대답', '新的回答'));
  assert.throws(() => helpers.resolveImportConflictDraft(draft, 'edit', [first, second]), /會和既有單字重複/);
});

test('daily recognition never adds more questions after the daily limit was answered', () => {
  const questions = Array.from({ length: 100 }, (_, index) => ({
    id: `term-${index}`,
    itemId: `term-${index}`,
    date: '2026-07-01',
    kind: 'term',
    source: { index },
  }));
  const attempts = Array.from({ length: 50 }, (_, index) => ({
    id: `attempt-${index}`,
    questionId: `term-${index}`,
    correct: true,
    date: '2026-07-22',
    time: `2026-07-22T01:${String(index).padStart(2, '0')}:00.000Z`,
    mode: 'daily-recognition',
  }));
  const store = {
    attempts,
    recognition: {
      correctIds: [],
      pendingWrongIds: [],
      roundCompletedOn: '',
      dailyDate: '2026-07-22',
      assignmentIds: Array.from({ length: 50 }, (_, index) => `term-${index + 50}`),
      answeredIds: [],
    },
  };

  const schedule = helpers.dailyRecognitionSchedule(store, questions, '2026-07-22', 50);
  assert.equal(schedule.questions.length, 0);
  assert.deepEqual(new Set(schedule.state.assignmentIds), new Set(attempts.map((attempt) => attempt.questionId)));
  const repeated = helpers.dailyRecognitionSchedule({ ...store, recognition: schedule.state }, questions, '2026-07-22', 50);
  assert.deepEqual(repeated, schedule);
});

test('explicit local attempt date takes priority over the UTC timestamp date', () => {
  assert.equal(helpers.attemptDate({ date: '2026-07-23', time: '2026-07-22T23:30:00.000Z' }), '2026-07-23');
});

test('completed review dates remain append-only in local state', () => {
  const completed = helpers.markReviewDateComplete({ completedReviewDates: ['2026-07-21'] }, '2026-07-22');
  assert.deepEqual(completed.completedReviewDates, ['2026-07-21', '2026-07-22']);
});
