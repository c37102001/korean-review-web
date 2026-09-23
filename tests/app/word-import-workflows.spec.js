import { expect, test } from '@playwright/test';
import { denyFirestoreWrites, listDocuments, prepareAppPage, readDocument, register, resetTestData, seedWord, setEmulatorRules } from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

const payload = (items) => JSON.stringify({ schemaVersion: 2, data: items });
const word = (ko, zh, pos = '名詞') => ({ ko, pos, meanings: [{ zh, examples: [] }], notes: [] });

async function openJsonImport(page) {
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.notebook-actions .add-date-button').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'JSON', exact: true }).click();
  return dialog;
}

async function submitImport(dialog, items) {
  await dialog.getByLabel('JSON 內容').fill(payload(items));
  await dialog.getByRole('button', { name: '新增到單字庫' }).click();
}

test('E05 E07: invalid part of speech is repaired per word before any batch write', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-import-pos@example.test');
  const dialog = await openJsonImport(page);
  await submitImport(dialog, [word('책', '書'), { ...word('가다', '去'), pos: '舊詞性' }, { ...word('크다', '大'), pos: '' }]);
  await expect(dialog.getByText('不符合規定的資料')).toBeVisible();
  expect(await listDocuments(page, request, 'records')).toHaveLength(0);
  await expect(dialog.getByRole('button', { name: '繼續檢查重複單字' })).toBeDisabled();
  await dialog.locator('.import-fix-card').first().locator('select').selectOption('動詞');
  await dialog.locator('.import-fix-card').first().getByRole('button', { name: '套用修正' }).click();
  await dialog.locator('.import-fix-card').first().locator('select').selectOption('形容詞');
  await dialog.locator('.import-fix-card').first().getByRole('button', { name: '套用修正' }).click();
  await dialog.getByRole('button', { name: '全部匯入' }).click();
  await expect(dialog.getByText('匯入已完成')).toBeVisible();
  await dialog.getByRole('button', { name: '完成' }).click();
  await expect.poll(async () => (await listDocuments(page, request, 'records')).length).toBe(3);
  await page.reload();
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(3);
  assertNoProductionRequests();
});

test('E07: abandoning an invalid batch leaves the database untouched', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-import-abort@example.test');
  const dialog = await openJsonImport(page);
  await submitImport(dialog, [word('책', '書'), { ...word('가다', '去'), pos: '' }]);
  await dialog.getByRole('button', { name: '放棄匯入' }).click();
  await expect(dialog.locator('.form-success')).toHaveText('已放棄這次匯入，沒有寫入任何資料');
  expect(await listDocuments(page, request, 'records')).toHaveLength(0);
  assertNoProductionRequests();
});

for (const [choice, expectedZh] of [
  ['保留既有單字', '原義'],
  ['使用匯入資料取代', '新義'],
  ['直接合併', '原義'],
]) {
  test(`E06: existing-word conflict ${choice} persists the selected outcome`, async ({ page, request }) => {
    const assertNoProductionRequests = await prepareAppPage(page);
    await register(page, `word-import-${choice === '保留既有單字' ? 'keep' : choice === '直接合併' ? 'merge' : 'replace'}@example.test`);
    await seedWord(page, request, 'original', '사과', '原義');
    const dialog = await openJsonImport(page);
    await submitImport(dialog, [word('사과', '新義')]);
    await expect(dialog.getByText('重複韓文單字：사과')).toBeVisible();
    await dialog.getByRole('button', { name: choice }).click();
    await dialog.getByRole('button', { name: '全部匯入' }).click();
    await expect(dialog.getByText('匯入已完成')).toBeVisible();
    const item = (await readDocument(page, request, 'records', 'original')).fields.item.mapValue.fields;
    expect(item.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe(expectedZh);
    if (choice === '直接合併') expect(item.meanings.arrayValue.values.map((entry) => entry.mapValue.fields.zh.stringValue)).toContain('新義');
    assertNoProductionRequests();
  });
}

for (const [choice, expectedZh] of [['保留 A', '甲義'], ['保留 B', '乙義']]) {
  test(`E06: duplicate words within one JSON batch ${choice} keep the selected record`, async ({ page, request }) => {
    const assertNoProductionRequests = await prepareAppPage(page);
    await register(page, `word-import-internal-${choice === '保留 A' ? 'a' : 'b'}@example.test`);
    const dialog = await openJsonImport(page);
    await submitImport(dialog, [word('같다', '甲義'), word('같다', '乙義')]);
    await expect(dialog.getByText('重複韓文單字：같다')).toBeVisible();
    await dialog.getByRole('button', { name: choice }).click();
    await dialog.getByRole('button', { name: '全部匯入' }).click();
    await expect(dialog.getByText('匯入已完成')).toBeVisible();
    const docs = await listDocuments(page, request, 'records');
    expect(docs).toHaveLength(1);
    expect(docs[0].fields.item.mapValue.fields.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe(expectedZh);
    assertNoProductionRequests();
  });
}

test('E06: missing related references must be removed explicitly before import', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-import-related@example.test');
  const dialog = await openJsonImport(page);
  await submitImport(dialog, [{ ...word('친구', '朋友'), related: ['missing-card'] }]);
  await expect(dialog.getByText('找不到 1 個關聯詞')).toBeVisible();
  expect(await listDocuments(page, request, 'records')).toHaveLength(0);
  await dialog.getByRole('button', { name: '清空這些關聯詞並繼續' }).click();
  await dialog.getByRole('button', { name: '全部匯入' }).click();
  await expect(dialog.getByText('匯入已完成')).toBeVisible();
  const docs = await listDocuments(page, request, 'records');
  expect(docs).toHaveLength(1);
  expect(docs[0].fields.item.mapValue.fields.related?.arrayValue?.values || []).toHaveLength(0);
  assertNoProductionRequests();
});

test('E06: edited conflict result is the only version written', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-import-edit-conflict@example.test');
  await seedWord(page, request, 'original', '사과', '原義');
  const dialog = await openJsonImport(page);
  await submitImport(dialog, [word('사과', '新義')]);
  const finalEditor = dialog.getByLabel('編輯最終結果');
  const edited = JSON.parse(await finalEditor.inputValue());
  edited.meanings[0].zh = '自訂義';
  await finalEditor.fill(JSON.stringify(edited));
  await dialog.getByRole('button', { name: '使用編輯後結果' }).click();
  await dialog.getByRole('button', { name: '全部匯入' }).click();
  await expect(dialog.getByText('匯入已完成')).toBeVisible();
  const stored = (await readDocument(page, request, 'records', 'original')).fields.item.mapValue.fields;
  expect(stored.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('自訂義');
  assertNoProductionRequests();
});

test('E07: rejected batch write stays in review and succeeds on retry', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-import-retry@example.test');
  await seedWord(page, request, 'original', '사과', '蘋果');
  const dialog = await openJsonImport(page);
  await submitImport(dialog, [word('사과', '新蘋果'), word('배', '梨')]);
  await dialog.getByRole('button', { name: '使用匯入資料取代' }).click();
  try {
    await setEmulatorRules(request, denyFirestoreWrites);
    await dialog.getByRole('button', { name: '全部匯入' }).click();
    await expect(dialog.locator('.form-error')).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByRole('button', { name: '全部匯入' })).toBeEnabled();
    expect((await readDocument(page, request, 'records', 'original')).fields.item.mapValue.fields.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('蘋果');
  } finally {
    await setEmulatorRules(request);
  }
  await dialog.getByRole('button', { name: '全部匯入' }).click();
  await expect(dialog.getByText('匯入已完成')).toBeVisible();
  await expect.poll(async () => (await listDocuments(page, request, 'records')).length).toBe(2);
  expect((await readDocument(page, request, 'records', 'original')).fields.item.mapValue.fields.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('新蘋果');
  assertNoProductionRequests();
});

test('E08: multiword JSON import defaults noReview to false and preserves an explicit true', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-import-no-review@example.test');
  const dialog = await openJsonImport(page);
  await submitImport(dialog, [word('기본', '預設'), { ...word('제외', '排除'), noReview: true }]);
  await expect(dialog.getByText('匯入已完成')).toBeVisible();
  const docs = await listDocuments(page, request, 'records');
  expect(docs).toHaveLength(2);
  const byKo = Object.fromEntries(docs.map((doc) => [doc.fields.item.mapValue.fields.ko.stringValue, doc.fields.item.mapValue.fields]));
  expect(byKo['기본'].noReview?.booleanValue ?? false).toBe(false);
  expect(byKo['제외'].noReview.booleanValue).toBe(true);
  assertNoProductionRequests();
});
