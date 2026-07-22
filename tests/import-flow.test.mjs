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
