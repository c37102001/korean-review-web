import { expect, test } from '@playwright/test';

for (const mode of ['表單', 'JSON']) {
  test(`editing a word saves in ${mode} mode without a runtime error`, async ({ page }) => {
    await page.goto('visual-fixtures.html?case=word-edit');
    await expect(page.locator('[data-fixture]')).toHaveAttribute('data-fixture', 'word-edit');
    if (mode === 'JSON') await page.getByRole('button', { name: 'JSON', exact: true }).click();
    await page.getByRole('button', { name: '儲存修改' }).click();
    await expect(page.getByText('已更新單字')).toBeVisible();
    const saved = await page.evaluate(() => window.__wordEditResult);
    expect(saved?.id).toBe('word-1');
    expect(saved?.item?.ko).toBe('어쩌피');
  });
}
