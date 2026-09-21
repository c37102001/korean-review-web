import { expect, test } from '@playwright/test';
import { prepareAppPage, register, resetTestData, seedDocument } from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

test('W17: notebook filters by one part of speech and combines it with folder selection', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'word-pos-filter@example.test');
  const words = [
    ['apple', '사과', '名詞'],
    ['go', '가다', '動詞'],
    ['school', '학교', '名詞'],
  ];
  for (const [id, ko, pos] of words) {
    await seedDocument(page, request, 'records', id, {
      id, date: '2026-09-21',
      createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
      item: { ko, pos, meanings: [{ zh: `${ko} 中文`, examples: [] }] },
    });
  }
  await seedDocument(page, request, 'folders', 'test-folder', {
    id: 'test-folder', name: '已分類', tag: '', wordIds: ['apple', 'go'],
    createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  const cards = page.locator('.word-grid .word-card');
  await expect(cards).toHaveCount(3);
  const posFilter = page.getByRole('combobox', { name: '詞性' });
  await expect(posFilter.locator('option')).toHaveCount(8);
  await expect(posFilter).toBeInViewport();
  await posFilter.selectOption('名詞');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('.pagination')).toContainText('共 2 筆');
  await expect(cards.getByText('사과', { exact: true })).toBeVisible();
  await expect(cards.getByText('학교', { exact: true })).toBeVisible();

  await posFilter.selectOption('動詞');
  await expect(cards).toHaveCount(1);
  await expect(cards.getByText('가다', { exact: true })).toBeVisible();
  await expect(cards.getByText('사과', { exact: true })).toHaveCount(0);

  await posFilter.selectOption('名詞');
  await page.getByRole('button', { name: '資料夾 全部' }).click();
  await page.getByRole('group', { name: '資料夾篩選' }).getByRole('checkbox', { name: /無資料夾/ }).check();
  await expect(cards).toHaveCount(1);
  await expect(cards.getByText('학교', { exact: true })).toBeVisible();
  await posFilter.selectOption('');
  await expect(cards).toHaveCount(1);
  await expect(cards.getByText('학교', { exact: true })).toBeVisible();
  assertNoProductionRequests();
});
