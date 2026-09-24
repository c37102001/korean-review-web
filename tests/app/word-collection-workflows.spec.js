import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { prepareAppPage, readDocument, register, resetTestData, seedDocument, seedWord } from './helpers.js';
import { progressShardId } from '../../src/review-engine/store.js';

test.beforeEach(async ({ request }) => resetTestData(request));

async function openNotebook(page) {
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.getByRole('heading', { name: '單字本' })).toBeVisible();
}

const cards = (page) => page.locator('.word-grid .word-card');

test('W01 W05 W06 W07 W08: search, reveal, details, pronunciation and star work from a real list', async ({ page, request }) => {
  await page.addInitScript(() => {
    window.__spoken = [];
    window.speechSynthesis.speak = (utterance) => window.__spoken.push({ text: utterance.text, lang: utterance.lang });
    window.speechSynthesis.cancel = () => {};
  });
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-controls@example.test');
  await seedWord(page, request, 'alpha', '사과', '蘋果', {
    notes: ['**記住**這個意思'], examples: [{ ko: '사과를 먹어요.', zh: '吃蘋果。' }], related: ['바나나'],
  });
  await seedWord(page, request, 'beta', '바나나', '香蕉');
  await openNotebook(page);
  await expect(cards(page)).toHaveCount(2);
  const alpha = cards(page).filter({ hasText: '사과' });
  await expect(alpha.getByText('蘋果')).toHaveCount(0);
  await alpha.getByRole('button', { name: '顯示中文' }).click();
  await expect(alpha.getByText('蘋果')).toBeVisible();
  await page.locator('.notebook-actions').getByRole('button', { name: '顯示中文' }).click();
  await expect(cards(page).filter({ hasText: '바나나' }).getByText('香蕉')).toBeVisible();
  await expect(alpha.getByText('蘋果')).toBeVisible();
  await alpha.getByRole('button', { name: '隱藏中文' }).click();
  await expect(alpha.getByText('蘋果')).toHaveCount(0);
  await alpha.getByRole('button', { name: '打星號' }).click();
  await expect(alpha.getByRole('button', { name: '取消星號' })).toBeVisible();
  await alpha.getByRole('button', { name: '播放韓文發音' }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.at(-1))).toEqual({ text: '사과', lang: 'ko-KR' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await alpha.click();
  const detail = page.getByRole('dialog');
  await expect(detail).toContainText('蘋果');
  await expect(detail).toContainText('사과를 먹어요.');
  await expect(detail).toContainText('吃蘋果。');
  await detail.locator('.example-row').getByRole('button', { name: '播放韓文發音' }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.at(-1))).toEqual({ text: '사과를 먹어요.', lang: 'ko-KR' });
  await expect(detail.locator('strong')).toContainText(['蘋果', '記住']);
  await detail.getByRole('button', { name: '取消星號' }).click();
  await detail.getByRole('button', { name: /바나나/ }).click();
  await expect(detail).toContainText('香蕉');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(alpha.getByRole('button', { name: '打星號' })).toBeVisible();

  const search = page.getByPlaceholder('搜尋韓文單字或中文意思');
  await search.fill('蘋果');
  await expect(cards(page)).toHaveCount(1);
  await search.fill('記住');
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByPlaceholder('搜尋單字、例句、筆記或相關詞').fill('記住');
  await expect(cards(page)).toHaveCount(1);
  await page.getByPlaceholder('搜尋單字、例句、筆記或相關詞').fill('');
  await expect(cards(page)).toHaveCount(2);
  await page.reload();
  await openNotebook(page);
  await expect(cards(page).filter({ hasText: '사과' }).getByRole('button', { name: '打星號' })).toBeVisible();
  assertNoProductionRequests();
});

test('W02 W03 W04 W09 W14: filters compose, sort and pagination retain correct selection', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-filters@example.test');
  await seedWord(page, request, 'alpha', '가다', '去', { date: '2026-09-20' });
  await seedWord(page, request, 'beta', '나다', '出現');
  await seedWord(page, request, 'gamma', '다니다', '往返');
  for (const [id, wrong] of [['alpha', 1], ['beta', 2]]) {
    await seedDocument(page, request, 'progressShards', progressShardId(id), {
      entries: { [id]: { stats: { correct: 0, wrong, total: wrong } } },
    });
  }
  await seedDocument(page, request, 'folders', 'folder-a', {
    id: 'folder-a', name: '第一組', tag: '讀書', wordIds: ['alpha', 'beta'],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await seedDocument(page, request, 'folders', 'system-learned', {
    id: 'system-learned', name: '已學習', systemKey: 'learned', tag: '', wordIds: ['beta'],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await openNotebook(page);
  await expect(cards(page)).toHaveCount(2);
  await page.locator('.notebook-actions .action-menu summary').click();
  await page.locator('.learned-visibility-button').click();
  await expect(cards(page)).toHaveCount(3);
  expect((await readDocument(page, request, 'records', 'beta'))?.fields.item.mapValue.fields.ko.stringValue).toBe('나다');
  await page.locator('.notebook-actions .action-menu summary').click();
  await page.locator('.learned-visibility-button').click();
  await expect(cards(page)).toHaveCount(2);
  await page.locator('.notebook-actions .action-menu summary').click();
  await page.locator('.learned-visibility-button').click();
  await expect(cards(page)).toHaveCount(3);
  await page.locator('.notebook-filters select').last().selectOption('alphabetical');
  await expect(cards(page).locator('h3 span').first()).toHaveText('가다');
  await page.locator('.notebook-filters select').last().selectOption('latest');
  await expect(cards(page).locator('h3 span').first()).toHaveText('나다');
  await page.locator('.notebook-filters select').last().selectOption('score');
  await expect(cards(page).locator('h3 span').first()).toHaveText('나다');
  await page.getByRole('button', { name: '資料夾 全部' }).click();
  const folderFilter = page.getByRole('group', { name: '資料夾篩選' });
  await folderFilter.getByRole('checkbox', { name: /無資料夾/ }).check();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('다니다');
  await folderFilter.getByRole('button', { name: '展開資料夾' }).first().click();
  await folderFilter.getByRole('checkbox', { name: /第一組/ }).check();
  await expect(cards(page)).toHaveCount(3);
  await folderFilter.getByRole('checkbox', { name: /讀書/ }).uncheck();
  await expect(cards(page)).toHaveCount(1);
  await folderFilter.getByRole('checkbox', { name: /讀書/ }).check();
  await expect(cards(page)).toHaveCount(3);
  await folderFilter.getByRole('button', { name: '清除' }).click();
  await expect(cards(page)).toHaveCount(3);
  await page.getByRole('button', { name: '熟悉度 全部' }).click();
  const levelFilter = page.getByRole('group', { name: '熟悉度篩選' });
  await levelFilter.getByRole('checkbox', { name: '熟悉度 -1' }).check();
  await expect(cards(page)).toHaveCount(1);
  await levelFilter.getByRole('checkbox', { name: '熟悉度 -2' }).check();
  await expect(cards(page)).toHaveCount(2);
  await levelFilter.getByRole('button', { name: '清除' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: '選取 가다' }).check();
  await expect(page.locator('.bulk-selection-summary')).toContainText('已選 1 個');
  await page.locator('.bulk-selection-summary').getByRole('button', { name: '選取本頁' }).click();
  await expect(page.locator('.bulk-selection-summary')).toContainText('已選 3 個');
  await page.locator('.bulk-selection-summary').getByRole('button', { name: '取消本頁' }).click();
  await expect(page.locator('.bulk-selection-summary')).toContainText('批次選取');
  await page.getByRole('checkbox', { name: '選取 가다' }).check();
  await page.getByPlaceholder('搜尋韓文單字或中文意思').fill('다니다');
  await expect(page.locator('.bulk-selection-summary')).toContainText('批次選取');
  assertNoProductionRequests();
});

test('W04 W09: page controls and select-current-page operate only on visible words', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-pages@example.test');
  for (let index = 0; index < 31; index += 1) {
    await seedWord(page, request, `word-${String(index).padStart(2, '0')}`, `단어${index}`, `意思${index}`);
  }
  await openNotebook(page);
  await expect(cards(page)).toHaveCount(30);
  await expect(page.locator('.pagination')).toContainText('1 / 2');
  await expect(page.locator('.pagination').getByRole('button', { name: '上一頁' })).toBeDisabled();
  await page.locator('.bulk-selection-summary').getByRole('button', { name: '選取本頁' }).click();
  await expect(page.locator('.bulk-selection-summary')).toContainText('已選 30 個');
  await page.locator('.pagination').getByRole('button', { name: '下一頁' }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('.pagination')).toContainText('2 / 2');
  await expect(page.locator('.pagination').getByRole('button', { name: '下一頁' })).toBeDisabled();
  await page.locator('.bulk-selection-summary').getByRole('button', { name: '選取本頁' }).click();
  await expect(page.locator('.bulk-selection-summary')).toContainText('已選 31 個');
  await page.locator('.bulk-selection-summary').getByRole('button', { name: '取消本頁' }).click();
  await expect(page.locator('.bulk-selection-summary')).toContainText('已選 30 個');
  await page.locator('.pagination').getByRole('button', { name: '上一頁' }).click();
  await expect(cards(page)).toHaveCount(30);
  await page.locator('.bulk-selection-summary').getByRole('button', { name: '清除' }).click();
  await expect(page.locator('.bulk-selection-summary')).toContainText('批次選取');
  await page.locator('.pagination').getByRole('button', { name: '下一頁' }).click();
  await page.getByPlaceholder('搜尋韓文單字或中文意思').fill('意思30');
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('.pagination')).toContainText('1 / 1');
  assertNoProductionRequests();
});

test('W08: starred words stay selected in study and practice after reload', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'starred-session@example.test');
  await seedWord(page, request, 'first', '가다', '去');
  await seedWord(page, request, 'second', '나다', '出現');
  await openNotebook(page);
  await cards(page).filter({ hasText: '가다' }).getByRole('button', { name: '打星號' }).click();
  await expect(cards(page).filter({ hasText: '가다' }).getByRole('button', { name: '取消星號' })).toBeVisible();
  await expect.poll(async () => (await readDocument(page, request, 'settings', 'review'))?.fields.starred?.arrayValue?.values?.map((entry) => entry.stringValue)).toEqual(['first']);
  await page.reload();
  await openNotebook(page);
  await expect(cards(page).filter({ hasText: '가다' }).getByRole('button', { name: '取消星號' })).toBeVisible();
  await page.locator('.notebook-actions').getByRole('button', { name: '學習' }).click();
  await expect(page.locator('.flashcard-star').getByRole('button', { name: '取消星號' })).toBeVisible();
  await page.locator('.study-back-button').click();
  await page.locator('.notebook-actions').getByRole('button', { name: '測驗' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '有星號' }).click();
  await expect(page.locator('.practice-start')).toContainText('1 題可測驗');
  assertNoProductionRequests();
});

test('W15: export copy and download contain parseable source data', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'export-word@example.test');
  await seedWord(page, request, 'exported', '책', '書');
  await openNotebook(page);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText('책');
  await page.locator('.notebook-actions .action-menu summary').click();
  await page.getByRole('button', { name: '匯出 JSON' }).click();
  const dialog = page.getByRole('dialog');
  const json = JSON.parse(await dialog.locator('pre').innerText());
  expect(json.data).toHaveLength(1);
  expect(json.data[0].ko).toBe('책');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await dialog.getByRole('button', { name: '複製' }).click();
  await expect(dialog.getByRole('button', { name: '已複製' })).toBeVisible();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(json);
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '下載' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  expect(JSON.parse(await readFile(await download.path(), 'utf8'))).toEqual(json);
  await dialog.getByRole('button', { name: '關閉' }).click();
  expect((await readDocument(page, request, 'records', 'exported'))?.fields.id.stringValue).toBe('exported');
  assertNoProductionRequests();
});
