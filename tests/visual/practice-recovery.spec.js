import { expect, test } from '@playwright/test';

async function finishOneQuestion(page) {
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  await page.locator('.practice-decision-panel').getByRole('button', { name: '答對' }).click();
  await expect(page.getByRole('heading', { name: '流程測試 已完成' })).toBeVisible();
}

test('P08: completion retry exposes the error and calls the save callback again', async ({ page }) => {
  await page.goto('visual-fixtures.html?case=practice-recovery');
  await finishOneQuestion(page);
  await expect(page.locator('.practice-complete-panel .form-error')).toContainText('暫時無法儲存');
  await page.getByRole('button', { name: '重新儲存進度' }).click();
  await expect(page.locator('.practice-complete-panel .form-error')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__completionAttempts)).toBe(2);
});

test('P08: repeatable session restarts its full question set after completion', async ({ page }) => {
  await page.goto('visual-fixtures.html?case=practice-repeat');
  await finishOneQuestion(page);
  await page.getByRole('button', { name: '再練一次' }).click();
  await expect(page.locator('.quiz-meta')).toContainText('1 / 1');
  await expect(page.locator('.practice-answer-panel')).not.toHaveClass(/visible/);
});
