import { expect, test } from '@playwright/test';

test('a page render error shows recovery controls instead of a blank screen', async ({ page }) => {
  await page.goto('visual-fixtures.html?case=render-error');
  await expect(page.getByRole('alert')).toContainText('頁面暫時無法顯示');
  await expect(page.getByRole('button', { name: '重新載入' })).toBeVisible();
  await page.getByText('錯誤資訊').click();
  await expect(page.getByText('Test render failure')).toBeVisible();
});
