import { expect, test } from '@playwright/test';
import {
  prepareAppPage,
  listDocuments,
  readDocument,
  register,
  resetTestData,
  seedWord,
  signOut,
} from './helpers.js';
import { progressShardId } from '../../src/review-engine/store.js';

test.beforeEach(async ({ request }) => resetTestData(request));

const settingsMenu = (page) => page.locator('.home-settings-menu');

async function openSettings(page) {
  const menu = settingsMenu(page);
  if (!await menu.evaluate((element) => element.open)) await menu.locator('summary').click();
  return menu;
}

async function prepareOfflineData(page) {
  const menu = await openSettings(page);
  await menu.getByRole('button', { name: '下載離線資料' }).click();
  await expect.poll(() => page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem('korean-review-offline-ready-v1') || 'null');
    return value?.sectionCount || 0;
  }), { timeout: 15_000 }).toBe(10);
}

async function toggleManualOffline(page, enabled) {
  const menu = await openSettings(page);
  const toggle = menu.getByRole('switch', { name: '主動離線模式' });
  await toggle.setChecked(enabled, { force: true });
  await expect(toggle).toBeChecked({ checked: enabled });
}

async function addWord(page, ko, zh) {
  await page.getByRole('button', { name: '新增單字', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('韓文 *').fill(ko);
  await dialog.getByLabel('詞性 / 類型 *').selectOption('名詞');
  await dialog.locator('.meaning-editor-card').first().getByLabel('中文 *').fill(zh);
  await dialog.getByRole('button', { name: '新增到單字庫' }).click();
  await expect(dialog).toHaveCount(0);
}

async function answerDailyQuestion(page, correct = true) {
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  await page.locator('.practice-decision-panel').getByRole('button', { name: correct ? '答對' : '答錯' }).click();
}

test('O02: download, incremental update and full rebuild preserve readiness and pending operations', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'offline-prepare@example.test');
  await seedWord(page, request, 'cached-a', '비행기', '飛機');
  await prepareOfflineData(page);

  let ready = await page.evaluate(() => JSON.parse(localStorage.getItem('korean-review-offline-ready-v1')));
  expect(ready.documentCount).toBeGreaterThan(0);
  expect(ready.forceFull).toBe(false);

  await seedWord(page, request, 'cached-b', '공항', '機場');
  const previousCompletedAt = ready.completedAt;
  await page.clock.setFixedTime(new Date('2026-09-21T09:00:05+08:00'));
  let menu = await openSettings(page);
  await menu.getByRole('button', { name: '更新離線資料' }).click();
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(localStorage.getItem('korean-review-offline-ready-v1'))?.completedAt
  )), { timeout: 15_000 }).not.toBe(previousCompletedAt);

  await page.evaluate(async () => {
    const { trackOfflineWrite } = await import('/korean-review-web/src/offlineSupport.js');
    window.__unresolvedOfflineWrite = new Promise(() => {});
    await trackOfflineWrite(window.__unresolvedOfflineWrite, '完整重建保留測試');
  });
  await expect(page.getByRole('status')).toContainText('1 筆');
  menu = await openSettings(page);
  await menu.getByRole('button', { name: '重新下載全部' }).click();
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(localStorage.getItem('korean-review-offline-ready-v1'))?.forceFull
  )), { timeout: 15_000 }).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('korean-review-offline-pending-writes-v1'))?.count)).toBe(1);
  await page.evaluate(async () => {
    const { clearOfflinePendingWrites } = await import('/korean-review-web/src/offlineSupport.js');
    clearOfflinePendingWrites();
  });

  await signOut(page);
  await register(page, 'offline-other@example.test');
  menu = await openSettings(page);
  await expect(menu.getByRole('button', { name: '下載離線資料' })).toBeVisible();
  assertNoProductionRequests();
});

test('O01 O03: manual offline CRUD stays local, queues writes and synchronizes exactly once when re-enabled', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'offline-crud@example.test');
  await seedWord(page, request, 'edit-offline', '하늘', '天空');
  await seedWord(page, request, 'delete-offline', '바다', '海洋');
  await prepareOfflineData(page);
  await toggleManualOffline(page, true);
  await expect(page.getByRole('status')).toContainText('主動離線模式');

  await addWord(page, '구름', '雲');
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  const editCard = page.locator('.word-card').filter({ hasText: '하늘' });
  await editCard.getByRole('button', { name: '編輯' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('.meaning-editor-card').first().getByLabel('中文 *').fill('天空、天上');
  await dialog.getByRole('button', { name: '儲存修改' }).click();
  await expect(dialog).toHaveCount(0);

  page.once('dialog', (confirmation) => confirmation.accept());
  await page.locator('.word-card').filter({ hasText: '바다' }).getByRole('button', { name: '刪除' }).click();
  await expect(page.locator('.word-card').filter({ hasText: '바다' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(/\d+ 筆操作等待同步/);
  await expect(page.locator('.word-card').filter({ hasText: '구름' })).toBeVisible();
  await editCard.getByRole('button', { name: '顯示中文' }).click();
  await expect(editCard).toContainText('天空、天上');

  await page.getByRole('button', { name: '韓文筆記' }).click();
  await toggleManualOffline(page, false);
  await expect.poll(async () => (
    await page.evaluate(() => JSON.parse(localStorage.getItem('korean-review-offline-pending-writes-v1') || '{"count":0}').count)
  ), { timeout: 20_000 }).toBe(0);
  await expect.poll(async () => (
    await readDocument(page, request, 'records', 'edit-offline')
  )?.fields.item.mapValue.fields.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue, { timeout: 15_000 }).toBe('天空、天上');
  await expect.poll(async () => (
    await readDocument(page, request, 'records', 'delete-offline')
  )?.fields.deletedAt?.timestampValue, { timeout: 15_000 }).toBeTruthy();
  const records = await listDocuments(page, request, 'records');
  const created = records.filter((document) => (
    document.fields?.item?.mapValue?.fields?.ko?.stringValue === '구름'
  ));
  expect(created).toHaveLength(1);
  assertNoProductionRequests();
});

test('O03: a daily answer completed offline is synchronized once after manual offline mode ends', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'offline-daily@example.test');
  await seedWord(page, request, 'offline-daily', '걷다', '走路', { date: '2026-09-20' });
  await prepareOfflineData(page);
  await toggleManualOffline(page, true);

  await page.locator('.home-actions').getByRole('button', { name: '今日測驗' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '開始' }).click();
  await answerDailyQuestion(page, true);
  await expect(page.getByRole('heading', { name: '今日測驗 已完成' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(/操作等待同步/);

  await page.getByRole('button', { name: '韓文筆記' }).click();
  await toggleManualOffline(page, false);
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(localStorage.getItem('korean-review-offline-pending-writes-v1') || '{"count":0}').count
  )), { timeout: 20_000 }).toBe(0);

  const shard = await readDocument(page, request, 'progressShards', progressShardId('offline-daily'));
  expect(shard.fields.entries.mapValue.fields['offline-daily'].mapValue.fields.stats.mapValue.fields.correct.integerValue).toBe('1');
  assertNoProductionRequests();
});

test('O03 O04: a browser network interruption queues a write and reconnecting clears it without false success', async ({ page, context, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'offline-network@example.test');
  await prepareOfflineData(page);

  await context.setOffline(true);
  await expect(page.getByRole('status')).toContainText('離線模式');
  await addWord(page, '연결', '連線');
  await expect(page.getByRole('status')).toContainText('1 筆操作等待同步');
  expect(await listDocuments(page, request, 'records')).toHaveLength(0);

  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(localStorage.getItem('korean-review-offline-pending-writes-v1') || '{"count":0}').count
  )), { timeout: 20_000 }).toBe(0);
  await expect.poll(async () => (
    await listDocuments(page, request, 'records')
  ).filter((document) => document.fields?.item?.mapValue?.fields?.ko?.stringValue === '연결').length).toBe(1);
  await expect(page.getByRole('status')).toHaveCount(0);
  assertNoProductionRequests();
});

test('G08: delayed and failed synchronization stays visible and Check Sync recovers the status', async ({ page }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'offline-status@example.test');

  await page.evaluate(async () => {
    const { trackOfflineWrite } = await import('/korean-review-web/src/offlineSupport.js');
    window.__delayedOfflineWrite = new Promise(() => {});
    await trackOfflineWrite(window.__delayedOfflineWrite, '延遲同步測試');
  });
  await expect(page.getByRole('status')).toContainText('正在同步 1 筆');
  await expect(page.getByRole('status')).toContainText('尚未收到 Firebase 確認', { timeout: 20_000 });
  await page.getByRole('button', { name: '檢查同步' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.evaluate(async () => {
    const { trackOfflineWrite } = await import('/korean-review-web/src/offlineSupport.js');
    await trackOfflineWrite(Promise.reject(new Error('測試寫入遭拒')), '新增單字');
  });
  await expect(page.getByRole('status')).toContainText('新增單字同步失敗：測試寫入遭拒');
  assertNoProductionRequests();
});
