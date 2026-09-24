import { expect, test } from '@playwright/test';
import { prepareAppPage, register, resetTestData, seedWord } from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

async function armWordCollectionRenderFailure(page) {
  await page.evaluate(() => {
    const originalNormalize = String.prototype.normalize;
    window.__restoreStringNormalize = () => { String.prototype.normalize = originalNormalize; };
    String.prototype.normalize = function patchedNormalize(form) {
      if (String(this).includes('경계')) {
        throw new Error('受控的單字頁顯示失敗');
      }
      return originalNormalize.call(this, form);
    };
    const input = document.querySelector('input[placeholder="搜尋韓文單字或中文意思"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '邊界');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('G07: a real page render failure exposes details and supports back and reload recovery', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'render-recovery@example.test');
  await seedWord(page, request, 'boundary-word', '경계', '邊界');
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-card')).toContainText('경계');

  await armWordCollectionRenderFailure(page);
  const fallback = page.getByRole('alert');
  await expect(fallback.getByRole('heading', { name: '頁面暫時無法顯示' })).toBeVisible();
  await fallback.getByText('錯誤資訊').click();
  await expect(fallback).toContainText('受控的單字頁顯示失敗');
  await page.evaluate(() => window.__restoreStringNormalize());
  await page.getByRole('button', { name: '回到上一層' }).click();
  await expect(page.getByRole('heading', { name: '今天練韓文' })).toBeVisible();

  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-card')).toContainText('경계');
  await armWordCollectionRenderFailure(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '重新載入' }).click();
  await expect(page.getByRole('heading', { name: '今天練韓文' })).toBeVisible();
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-card')).toContainText('경계');
  await expect(page.getByRole('alert')).toHaveCount(0);
  assertNoProductionRequests();
});
