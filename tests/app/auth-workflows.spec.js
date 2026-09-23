import { expect, test } from '@playwright/test';
import {
  prepareAppPage,
  register,
  resetTestData,
  seedFolder,
  signOut,
  submitCredentials,
} from './helpers.js';

test.beforeEach(async ({ request }) => {
  await resetTestData(request);
});

test('G01: valid login enters the real workspace; invalid password can be retried', async ({ page }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'login@example.test');
  await signOut(page);

  await submitCredentials(page, 'login@example.test', 'wrong-pass');
  await expect(page.locator('.form-error')).toBeVisible();
  await expect(page.getByRole('button', { name: '登入', exact: true })).toBeEnabled();
  await submitCredentials(page, 'login@example.test');
  await expect(page.getByRole('button', { name: '單字本' })).toBeVisible();
  await page.getByRole('button', { name: '單字本' }).click();
  await expect(page.getByRole('heading', { name: '單字本' })).toBeVisible();
  assertNoProductionRequests();
});

test('G02: registration mode switches back to login; failed registration can be retried', async ({ page }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await page.getByRole('button', { name: '還沒有帳號？建立新帳號' }).click();
  await expect(page.getByRole('heading', { name: '建立新帳號' })).toBeVisible();
  await page.getByRole('button', { name: '已有帳號？返回登入' }).click();
  await expect(page.getByRole('heading', { name: '登入後開始測驗' })).toBeVisible();
  await register(page, 'existing@example.test');
  await signOut(page);

  await page.getByRole('button', { name: '還沒有帳號？建立新帳號' }).click();
  await page.getByLabel('Email').fill('existing@example.test');
  await page.getByLabel('密碼').fill('test-pass-123');
  await page.getByRole('button', { name: '建立帳號', exact: true }).click();
  await expect(page.locator('.form-error')).toBeVisible();
  await expect(page.getByRole('button', { name: '建立帳號', exact: true })).toBeEnabled();
  await page.getByLabel('Email').fill('new@example.test');
  await page.getByRole('button', { name: '建立帳號', exact: true }).click();
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
  assertNoProductionRequests();
});

test('G03: logout and reload keep two accounts and their cached folders isolated', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'owner@example.test');
  await seedFolder(page, request, '帳號A專屬資料夾');
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await expect(page.getByText('帳號A專屬資料夾')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await expect(page.getByText('帳號A專屬資料夾')).toBeVisible();
  await signOut(page);

  await register(page, 'other@example.test');
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await expect(page.getByText('帳號A專屬資料夾')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await expect(page.getByText('帳號A專屬資料夾')).toHaveCount(0);
  await signOut(page);

  await submitCredentials(page, 'owner@example.test');
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await expect(page.getByText('帳號A專屬資料夾')).toBeVisible();
  assertNoProductionRequests();
});
