import { expect, test } from '@playwright/test';
import { prepareAppPage, register, resetTestData, seedDocument } from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

function currentMonthDay(page, day) {
  return page.locator('.calendar-grid button.day:not(.muted)').nth(day - 1);
}

test('C01: previous/next month and Today update the month and selected date', async ({ page }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'calendar-month@example.test');
  await page.getByRole('button', { name: '日曆' }).click();
  const controls = page.locator('.month-controls');
  await expect(controls.locator('strong')).toContainText('2026年9月');
  await controls.locator('button.icon').first().click();
  await expect(controls.locator('strong')).toContainText('2026年8月');
  await controls.locator('button.icon').last().click();
  await controls.locator('button.icon').last().click();
  await expect(controls.locator('strong')).toContainText('2026年10月');
  await controls.getByRole('button', { name: '今天' }).click();
  await expect(controls.locator('strong')).toContainText('2026年9月');
  await expect(page.locator('.panel-title h2')).toHaveText('2026-09-21');
  await expect(currentMonthDay(page, 21)).toHaveClass(/selected/);
  assertNoProductionRequests();
});

test('C02: date selection, View Date and double-click navigate and return to the same date', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'calendar-date@example.test');
  await seedDocument(page, request, 'records', 'calendar-word', {
    id: 'calendar-word', date: '2026-09-15',
    createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
    item: { ko: '날짜단어', pos: '其他', meanings: [{ zh: '日期單字', examples: [] }] },
  });
  await page.getByRole('button', { name: '日曆' }).click();
  await currentMonthDay(page, 15).click();
  await expect(page.locator('.panel-title h2')).toHaveText('2026-09-15');
  await expect(page.locator('.panel-title')).toContainText('1 筆內容');
  await expect(page.getByText('날짜단어', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看日期' }).click();
  await expect(page.getByRole('heading', { name: '日期筆記' })).toBeVisible();
  await expect(page.getByText('날짜단어', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '回到上一層' }).click();
  await expect(page.locator('.panel-title h2')).toHaveText('2026-09-15');
  await currentMonthDay(page, 17).dblclick();
  await expect(page.getByRole('heading', { name: '日期筆記' })).toBeVisible();
  await expect(page.locator('.eyebrow')).toContainText('9月17日');
  await page.getByRole('button', { name: '回到上一層' }).click();
  await expect(page.locator('.panel-title h2')).toHaveText('2026-09-17');
  assertNoProductionRequests();
});
