import { expect, test } from '@playwright/test';

test('JSON import reviews every missing or legacy word type before writing', async ({ page }) => {
  await page.goto('visual-fixtures.html?case=word-import');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await page.locator('#word-json-input').fill(JSON.stringify({ schemaVersion: 2, data: [
    { ko: '가다', meanings: [{ zh: '去' }] },
    { ko: '오다', pos: '動詞片語', meanings: [{ zh: '來' }] },
    { ko: '보다', pos: '動詞', meanings: [{ zh: '看' }] },
  ] }));
  await page.getByRole('button', { name: '新增到單字庫' }).click();
  await expect(page.locator('.import-fix-card')).toHaveCount(2);
  expect(await page.evaluate(() => window.__wordImportResult)).toBeUndefined();

  for (const ko of ['가다', '오다']) {
    const card = page.locator('.import-fix-card').filter({ hasText: ko });
    await card.getByRole('combobox').selectOption('動詞');
    await card.getByRole('button', { name: '套用修正' }).click();
  }
  await page.getByRole('button', { name: '全部匯入' }).click();
  await expect.poll(() => page.evaluate(() => window.__wordImportResult?.length)).toBe(3);
  const poses = await page.evaluate(() => window.__wordImportResult.map((record) => record.item.pos));
  expect(poses).toEqual(['動詞', '動詞', '動詞']);
});
