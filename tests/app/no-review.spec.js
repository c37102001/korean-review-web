import { expect, test } from '@playwright/test';
import { currentUserId, prepareAppPage, register, resetTestData, seedDocument } from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

async function storedWord(page, request, id) {
  const uid = await currentUserId(page);
  const response = await request.get(`http://127.0.0.1:8080/v1/projects/demo-korean-review-web/databases/(default)/documents/users/${uid}/records/${id}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).fields.item.mapValue.fields;
}

test('noReview can be batch-set, edited, and never enters study or practice', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'no-review@example.test');
  for (const [id, ko] of [['first', '가다'], ['second', '나다'], ['third', '다니다']]) {
    await seedDocument(page, request, 'records', id, {
      id, date: '2026-09-19', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
      item: { ko, pos: '動詞', meanings: [{ zh: `${ko} 中文`, examples: [] }] },
    });
  }
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(3);
  await page.getByRole('checkbox', { name: '選取 가다' }).check();
  await page.getByRole('checkbox', { name: '選取 나다' }).check();
  await page.locator('.bulk-action-buttons').getByRole('button', { name: '不複習' }).click();
  await expect(page.locator('.word-grid .word-card').filter({ hasText: '가다' })).toContainText('不複習');
  await expect.poll(async () => (await storedWord(page, request, 'first')).noReview?.booleanValue).toBe(true);
  await expect.poll(async () => (await storedWord(page, request, 'second')).noReview?.booleanValue).toBe(true);
  expect((await storedWord(page, request, 'first')).meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('가다 中文');

  await page.locator('.word-grid .word-card').filter({ hasText: '가다' }).getByRole('button', { name: '編輯' }).click();
  await expect(page.getByRole('checkbox', { name: '不複習' })).toBeChecked();
  await page.getByRole('checkbox', { name: '不複習' }).uncheck();
  await page.getByRole('button', { name: '儲存修改' }).click();
  await expect.poll(async () => (await storedWord(page, request, 'first')).noReview?.booleanValue).not.toBe(true);

  await page.getByRole('checkbox', { name: '選取 나다' }).check();
  await page.locator('.bulk-action-buttons').getByRole('button', { name: '恢復複習' }).click();
  await expect.poll(async () => (await storedWord(page, request, 'second')).noReview?.booleanValue).toBe(false);
  await page.getByRole('checkbox', { name: '選取 나다' }).check();
  await page.locator('.bulk-action-buttons').getByRole('button', { name: '不複習' }).click();
  await expect.poll(async () => (await storedWord(page, request, 'second')).noReview?.booleanValue).toBe(true);

  await page.locator('.notebook-actions').getByRole('button', { name: '學習' }).click();
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('1 / 2');
  await page.getByRole('button', { name: '回到上一層' }).click();
  await page.locator('.notebook-actions').getByRole('button', { name: '測驗' }).click();
  await expect(page.locator('.practice-start')).toContainText('2 題可測驗');
  await page.getByRole('button', { name: '韓文筆記' }).click();
  await expect(page.getByText('2 題單字待複習', { exact: false })).toBeVisible();
  assertNoProductionRequests();
});

test('adding a word to the learned folder sets noReview without erasing its meanings', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'learned-no-review@example.test');
  await seedDocument(page, request, 'records', 'learned-target', {
    id: 'learned-target', date: '2026-09-19', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
    item: { ko: '배우다', pos: '動詞', meanings: [{ zh: '學習', examples: [] }] },
  });
  await seedDocument(page, request, 'records', 'batch-target', {
    id: 'batch-target', date: '2026-09-19', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
    item: { ko: '읽다', pos: '動詞', meanings: [{ zh: '閱讀', examples: [] }] },
  });
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(2);
  await page.locator('.word-grid .word-card').filter({ hasText: '배우다' }).getByRole('button', { name: '編輯' }).click();
  await page.locator('.folder-picker-dropdown summary').click();
  await page.locator('.folder-picker-dropdown-menu label').filter({ hasText: '已學習' }).getByRole('checkbox').check();
  await expect(page.getByRole('checkbox', { name: '不複習' })).toBeChecked();
  await page.getByRole('button', { name: '儲存修改' }).click();
  await expect.poll(async () => (await storedWord(page, request, 'learned-target')).noReview?.booleanValue).toBe(true);
  expect((await storedWord(page, request, 'learned-target')).meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('學習');
  await page.getByRole('checkbox', { name: '選取 읽다' }).check();
  await page.locator('.bulk-action-buttons').getByRole('button', { name: '加入資料夾' }).click();
  await page.locator('.folder-assignment-modal .folder-picker-dropdown summary').click();
  await page.locator('.folder-assignment-modal .folder-picker-dropdown-menu label').filter({ hasText: '已學習' }).getByRole('checkbox').check();
  await page.locator('.folder-assignment-modal').getByRole('button', { name: '加入所選' }).click();
  await expect.poll(async () => (await storedWord(page, request, 'batch-target')).noReview?.booleanValue).toBe(true);
  expect((await storedWord(page, request, 'batch-target')).meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('閱讀');
  await page.locator('.notebook-actions .action-menu summary').click();
  await page.locator('.learned-visibility-button').click();
  await page.getByRole('checkbox', { name: '選取 읽다' }).check();
  await page.locator('.bulk-action-buttons').getByRole('button', { name: '恢復複習' }).click();
  await expect(page.locator('.bulk-action-error')).toContainText('請先將單字移出「已學習」資料夾');
  await expect.poll(async () => (await storedWord(page, request, 'batch-target')).noReview?.booleanValue).toBe(true);
  await page.locator('.bulk-selection-summary').getByRole('button', { name: '清除' }).click();
  await page.locator('.word-grid .word-card').filter({ hasText: '읽다' }).getByRole('button', { name: '編輯' }).click();
  await page.locator('.folder-picker-dropdown summary').click();
  await page.locator('.folder-picker-dropdown-menu label').filter({ hasText: '已學習' }).getByRole('checkbox').uncheck();
  await expect(page.getByRole('checkbox', { name: '不複習' })).toBeChecked();
  await page.getByRole('button', { name: '儲存修改' }).click();
  await expect.poll(async () => (await storedWord(page, request, 'batch-target')).noReview?.booleanValue).toBe(true);
  assertNoProductionRequests();
});

test('an older learned word keeps noReview when removed from the learned folder', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'legacy-learned@example.test');
  await seedDocument(page, request, 'records', 'old-learned', {
    id: 'old-learned', date: '2026-09-19', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
    item: { ko: '기억하다', pos: '動詞', meanings: [{ zh: '記得', examples: [] }] },
  });
  await seedDocument(page, request, 'folders', 'system-learned', {
    id: 'system-learned', name: '已學習', systemKey: 'learned', tag: '', wordIds: ['old-learned'],
    createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.notebook-actions .action-menu summary').click();
  await page.locator('.learned-visibility-button').click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(1);
  await page.locator('.word-grid .word-card').getByRole('button', { name: '編輯' }).click();
  await page.locator('.folder-picker-dropdown summary').click();
  await page.locator('.folder-picker-dropdown-menu label').filter({ hasText: '已學習' }).getByRole('checkbox').uncheck();
  await expect(page.getByRole('checkbox', { name: '不複習' })).toBeChecked();
  await page.getByRole('button', { name: '儲存修改' }).click();
  await expect.poll(async () => (await storedWord(page, request, 'old-learned')).noReview?.booleanValue).toBe(true);
  assertNoProductionRequests();
});
