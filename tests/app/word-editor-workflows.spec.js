import { expect, test } from '@playwright/test';
import { denyFirestoreWrites, listDocuments, prepareAppPage, readDocument, register, resetTestData, seedDocument, seedFolder, seedWord, setEmulatorRules } from './helpers.js';
import { progressShardId } from '../../src/review-engine/store.js';

test.beforeEach(async ({ request }) => resetTestData(request));

test('H03 E01 E02 W12: home manual editor saves forms, meanings and variants and rejects incomplete input', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-editor-manual@example.test');
  await seedWord(page, request, 'related-seed', '행복', '幸福');
  await page.getByRole('button', { name: '新增單字', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '新增單字' })).toBeVisible();
  await dialog.getByRole('button', { name: '新增到單字庫' }).click();
  await expect(listDocuments(page, request, 'records')).resolves.toHaveLength(1);
  await dialog.getByLabel('韓文 *').fill('기쁘다');
  await dialog.getByLabel('詞性 / 類型 *').selectOption('形容詞');
  await expect(dialog.getByLabel('詞性 / 類型 *').locator('option')).toHaveCount(8);
  await dialog.getByLabel('活用形式（選填）').fill('기뻐요');
  await dialog.locator('.variants-editor').getByRole('button', { name: '加入' }).click();
  await dialog.locator('.meaning-editor-card').first().getByLabel('中文 *').fill('高興');
  await dialog.locator('.meaning-editor-card').first().getByLabel('常見句型 / 搭配').fill('기쁜 소식');
  await dialog.locator('.meaning-editor-card').first().getByLabel('例句').fill('정말 기뻐요.\n真的很高興。');
  await dialog.getByRole('button', { name: '新增意思' }).click();
  await dialog.locator('.meaning-editor-card').nth(1).getByLabel('中文 *').fill('開心');
  await dialog.getByLabel('補充說明').fill('**語氣**很自然');
  await dialog.getByPlaceholder('搜尋已有單字').fill('행복');
  await dialog.locator('.related-results button').filter({ hasText: '행복' }).click();
  await dialog.getByRole('button', { name: '新增到單字庫' }).click();
  await expect(dialog).toHaveCount(0);
  const docs = await listDocuments(page, request, 'records');
  expect(docs).toHaveLength(2);
  const item = docs.find((doc) => doc.fields.item.mapValue.fields.ko.stringValue === '기쁘다').fields.item.mapValue.fields;
  expect(item.ko.stringValue).toBe('기쁘다');
  expect(item.pos.stringValue).toBe('形容詞');
  expect(item.variants.arrayValue.values.map((value) => value.stringValue)).toEqual(['기뻐요']);
  expect(item.meanings.arrayValue.values.map((value) => value.mapValue.fields.zh.stringValue)).toEqual(['高興', '開心']);
  expect(item.meanings.arrayValue.values[0].mapValue.fields.examples.arrayValue.values[0].mapValue.fields.ko.stringValue).toBe('정말 기뻐요.');
  expect(item.meanings.arrayValue.values[0].mapValue.fields.pattern.stringValue).toBe('기쁜 소식');
  expect(item.notes.arrayValue.values[0].stringValue).toBe('**語氣**很自然');
  expect(item.related.arrayValue.values.map((value) => value.stringValue)).toEqual(['related-seed']);
  await page.reload();
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-grid .word-card').filter({ hasText: '기쁘다' })).toBeVisible();
  assertNoProductionRequests();
});

test('E03 E04: editing JSON changes only the selected word and folders, preserving review progress', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-editor-json@example.test');
  await seedWord(page, request, 'target', '가다', '去', { variants: ['가요'] });
  await seedWord(page, request, 'other', '오다', '來');
  await seedDocument(page, request, 'progressShards', progressShardId('target'), {
    entries: { target: { stats: { correct: 3, wrong: 1, total: 4 } } },
  });
  await seedFolder(page, request, '動作');
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(2);
  await page.locator('.word-grid .word-card').filter({ hasText: '가다' }).getByRole('button', { name: '編輯' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'JSON', exact: true }).click();
  const json = dialog.getByLabel('JSON 內容');
  const parsed = JSON.parse(await json.inputValue());
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await dialog.getByRole('button', { name: '複製' }).click();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(parsed);
  parsed.data[0].meanings[0].zh = '前往';
  parsed.data[0].variants = ['가요', '갑니다'];
  await dialog.getByRole('button', { name: '清除' }).click();
  await expect(json).toHaveValue('');
  await json.fill('{ broken');
  await dialog.getByRole('button', { name: '儲存修改' }).click();
  await expect(dialog.locator('.form-error')).toBeVisible();
  expect((await readDocument(page, request, 'records', 'target')).fields.item.mapValue.fields.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('去');
  await json.fill(JSON.stringify(parsed));
  await dialog.getByRole('button', { name: '儲存修改' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await readDocument(page, request, 'records', 'target'))?.fields.item.mapValue.fields.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('前往');
  expect((await readDocument(page, request, 'records', 'other')).fields.item.mapValue.fields.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('來');
  expect((await readDocument(page, request, 'progressShards', progressShardId('target'))).fields.entries.mapValue.fields.target.mapValue.fields.stats.mapValue.fields.correct.integerValue).toBe('3');
  await page.reload();
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-grid .word-card').filter({ hasText: '가다' })).toBeVisible();
  assertNoProductionRequests();
});

test('E02 E03: manual edit changes folder membership and related words without deleting the card', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-editor-folders@example.test');
  await seedWord(page, request, 'target', '가다', '去');
  await seedWord(page, request, 'related', '오다', '來');
  await seedFolder(page, request, '舊資料夾');
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.word-grid .word-card').filter({ hasText: '가다' }).getByRole('button', { name: '編輯' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.folder-picker-dropdown summary').click();
  await dialog.locator('.folder-picker-dropdown').getByRole('checkbox', { name: /舊資料夾/ }).check();
  await dialog.getByPlaceholder('搜尋已有單字').fill('오다');
  await dialog.locator('.related-results button').filter({ hasText: '오다' }).click();
  await dialog.locator('.meaning-editor-card').first().getByLabel('中文 *').fill('前往');
  await dialog.getByRole('button', { name: '儲存修改' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await readDocument(page, request, 'folders', 'seed-folder'))?.fields.wordIds?.arrayValue?.values?.map((entry) => entry.stringValue)).toContain('target');
  expect((await readDocument(page, request, 'records', 'target')).fields.item.mapValue.fields.related.arrayValue.values.map((entry) => entry.stringValue)).toContain('related');
  await page.locator('.word-grid .word-card').filter({ hasText: '가다' }).getByRole('button', { name: '編輯' }).click();
  await dialog.locator('.folder-picker-dropdown summary').click();
  await dialog.locator('.folder-picker-dropdown').getByRole('checkbox', { name: /舊資料夾/ }).uncheck();
  await dialog.locator('.selected-related button').filter({ hasText: '오다' }).click();
  await dialog.getByRole('button', { name: '儲存修改' }).click();
  await expect.poll(async () => (await readDocument(page, request, 'folders', 'seed-folder'))?.fields.wordIds?.arrayValue?.values?.length || 0).toBe(0);
  expect((await readDocument(page, request, 'records', 'target')).fields.deletedAt).toBeUndefined();
  expect((await readDocument(page, request, 'records', 'target')).fields.item.mapValue.fields.related?.arrayValue?.values || []).toHaveLength(0);
  assertNoProductionRequests();
});

test('E02: removing a variant and an extra meaning preserves the final meaning', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-editor-remove@example.test');
  await seedWord(page, request, 'target', '크다', '大', {
    pos: '形容詞', variants: ['커요', '큰'],
    meanings: [{ zh: '大', examples: [] }, { zh: '巨大', examples: [] }],
  });
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.word-grid .word-card').getByRole('button', { name: '編輯' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.meaning-editor-card')).toHaveCount(2);
  await dialog.locator('.variant-tags').getByRole('button', { name: '큰' }).click();
  await dialog.locator('.meaning-editor-card').nth(1).getByRole('button', { name: '刪除' }).click();
  await expect(dialog.locator('.meaning-editor-card')).toHaveCount(1);
  await expect(dialog.locator('.meaning-editor-card').getByRole('button', { name: '刪除' })).toBeDisabled();
  await dialog.getByRole('button', { name: '儲存修改' }).click();
  await expect(dialog).toHaveCount(0);
  const stored = (await readDocument(page, request, 'records', 'target')).fields.item.mapValue.fields;
  expect(stored.variants.arrayValue.values.map((value) => value.stringValue)).toEqual(['커요']);
  expect(stored.meanings.arrayValue.values.map((value) => value.mapValue.fields.zh.stringValue)).toEqual(['大']);
  assertNoProductionRequests();
});

test('E04: closing a modified single-word JSON editor does not write changes', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-editor-cancel@example.test');
  await seedWord(page, request, 'target', '가다', '去');
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.word-grid .word-card').getByRole('button', { name: '編輯' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'JSON', exact: true }).click();
  const editor = dialog.getByLabel('JSON 內容');
  const changed = JSON.parse(await editor.inputValue());
  changed.data[0].meanings[0].zh = '未保存';
  await editor.fill(JSON.stringify(changed));
  await dialog.getByRole('button', { name: '關閉' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await readDocument(page, request, 'records', 'target')).fields.item.mapValue.fields.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('去');
  assertNoProductionRequests();
});

test('E07: duplicate manual word opens the existing editor instead of creating another card', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-editor-duplicate@example.test');
  await seedWord(page, request, 'existing', '사과', '蘋果');
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.notebook-actions .add-date-button').click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('韓文 *').fill('사과');
  await dialog.getByLabel('詞性 / 類型 *').selectOption('名詞');
  await dialog.locator('.meaning-editor-card').getByLabel('中文 *').fill('新解釋');
  await dialog.getByRole('button', { name: '新增到單字庫' }).click();
  await expect(dialog.locator('.duplicate-list')).toContainText('사과');
  expect(await listDocuments(page, request, 'records')).toHaveLength(1);
  await dialog.locator('.duplicate-list button').click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '編輯單字' })).toBeVisible();
  await expect(dialog.getByLabel('韓文 *')).toHaveValue('사과');
  assertNoProductionRequests();
});

test('W12: adding from a folder detail page assigns the new word to that folder', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-editor-folder-entry@example.test');
  await seedFolder(page, request, '旅行');
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await page.locator('.folder-card').filter({ hasText: '旅行' }).click();
  await page.locator('.notebook-actions').getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('韓文 *').fill('여행');
  await dialog.getByLabel('詞性 / 類型 *').selectOption('名詞');
  await dialog.locator('.meaning-editor-card').getByLabel('中文 *').fill('旅行');
  await dialog.getByRole('button', { name: '新增到單字庫' }).click();
  await expect(dialog).toHaveCount(0);
  const docs = await listDocuments(page, request, 'records');
  expect(docs).toHaveLength(1);
  expect(docs[0].fields.item.mapValue.fields.ko.stringValue).toBe('여행');
  await expect.poll(async () => (await readDocument(page, request, 'folders', 'seed-folder'))?.fields.wordIds?.arrayValue?.values?.map((value) => value.stringValue)).toContain(docs[0].name.split('/').pop());
  await page.reload();
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await page.locator('.folder-card').filter({ hasText: '旅行' }).click();
  await expect(page.locator('.word-grid .word-card')).toContainText('여행');
  assertNoProductionRequests();
});

test('E07: a rejected write keeps the edited word and allows retry', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-editor-retry@example.test');
  await seedWord(page, request, 'target', '가다', '去');
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.word-grid .word-card').getByRole('button', { name: '編輯' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.meaning-editor-card').getByLabel('中文 *').fill('前往');
  try {
    await setEmulatorRules(request, denyFirestoreWrites);
    await dialog.getByRole('button', { name: '儲存修改' }).click();
    await expect(dialog.locator('.form-error')).toBeVisible({ timeout: 10000 });
    await expect(dialog.locator('.meaning-editor-card').getByLabel('中文 *')).toHaveValue('前往');
  } finally {
    await setEmulatorRules(request);
  }
  await dialog.getByRole('button', { name: '儲存修改' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await readDocument(page, request, 'records', 'target'))?.fields.item.mapValue.fields.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('前往');
  assertNoProductionRequests();
});
