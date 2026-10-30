import { expect, test } from '@playwright/test';
import {
  denyFirestoreWrites, expandAllContentGroups, listDocuments, prepareAppPage,
  readDocument, register, resetTestData, seedDocument, setEmulatorRules,
} from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

const entries = [
  { id: 'first', ko: '첫 문장입니다.', zh: '第一句。', startMs: 1000, endMs: 4000 },
  { id: 'second', ko: '두 번째 문장입니다.', zh: '第二句。', startMs: 5000, endMs: 8000 },
  { id: 'third', ko: '세 번째 문장입니다.', zh: '第三句。', startMs: 12000, endMs: 16000 },
];
const createdTitle = '20260921-Sol-練習影片';

async function seedSource(page, request) {
  await seedDocument(page, request, 'ytSubtitles', 'source', {
    id: 'source', title: '練習影片', tag: 'Sol', mode: 'srt', learned: true,
    youtubeUrl: 'https://youtu.be/abcdefghijk', entries,
  });
}

async function openCreator(page) {
  await page.getByRole('button', { name: '影片學習', exact: true }).click();
  await page.getByRole('button', { name: '建立跟讀', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '建立跟讀' });
  await expect(dialog.getByLabel('選擇影片').locator('option', { hasText: '練習影片' })).toHaveCount(1);
  await dialog.getByLabel('選擇影片').selectOption('source');
  await dialog.getByRole('button', { name: '下一步' }).click();
  return dialog;
}

for (const width of [1280, 390]) {
  test(`Y06: create a shadowing snapshot and reopen the shared timed reader (${width}px)`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      window.__shadowingSeek = null;
      window.YT = { Player: class {
        constructor(_element, options) { setTimeout(() => options.events.onReady(), 0); }
        seekTo(time) { window.__shadowingSeek = time; }
        playVideo() {}
        pauseVideo() {}
        getCurrentTime() { return window.__shadowingSeek || 0; }
        destroy() {}
      } };
    });
    const assertHealthy = await prepareAppPage(page);
    await page.route('https://www.youtube.com/embed/**', (route) => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
    await register(page, `shadowing-${width}@example.test`);
    await page.getByRole('button', { name: '影片學習', exact: true }).click();
    await expect(page.getByRole('heading', { name: '跟讀練習', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '建立跟讀', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: '下一步' })).toBeDisabled();
    await expect(page.getByRole('dialog')).toContainText('目前沒有含影片連結與字幕的檔案');
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await seedSource(page, request);
    const dialog = await openCreator(page);
    await expect(dialog.getByRole('button', { name: '儲存', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: '第 3 句', exact: true }).check();
    await dialog.getByRole('checkbox', { name: '第 1 句', exact: true }).check();
    await dialog.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const card = page.locator('.yt-subtitle-note-card').filter({ hasText: createdTitle });
    await expect(card).toContainText('2 句');
    await card.getByRole('button', { name: '編輯字幕筆記', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel('標籤 選填')).toBeDisabled();
    await expect(page.getByRole('dialog').getByLabel('標籤 選填')).toHaveValue('跟讀練習');
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    const documents = await listDocuments(page, request, 'ytSubtitles');
    const created = documents.find((doc) => doc.fields.title?.stringValue === createdTitle);
    expect(created.fields.tag.stringValue).toBe('跟讀練習');
    expect(created.fields.learned.booleanValue).toBe(false);
    expect(created.fields.entries.arrayValue.values.map((value) => value.mapValue.fields.startMs.integerValue)).toEqual(['1000', '12000']);
    expect((await readDocument(page, request, 'ytSubtitles', 'source')).fields.entries.arrayValue.values).toHaveLength(3);
    await page.reload();
    await page.getByRole('button', { name: '影片學習', exact: true }).click();
    await expandAllContentGroups(page, { target: card });
    await card.click();
    await expect(page.locator('.yt-reader-page h1')).toHaveText(createdTitle);
    await expect(page.locator('.yt-subtitle-entry')).toHaveCount(2);
    await expect(page.locator('.yt-subtitle-list')).not.toContainText('두 번째');
    await expect(page.getByRole('button', { name: '播放影片', exact: true })).toBeEnabled();
    await page.locator('.yt-subtitle-entry').nth(1).click();
    await expect.poll(() => page.evaluate(() => window.__shadowingSeek)).toBe(12);
    assertHealthy();
  });
}

test('Y06: cancel, change videos and retry a rejected save without losing selected sentences', async ({ page, request }) => {
  const assertHealthy = await prepareAppPage(page);
  await register(page, 'shadowing-retry@example.test');
  await seedSource(page, request);
  let dialog = await openCreator(page);
  await dialog.getByRole('button', { name: '全選句子' }).click();
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(3);
  await dialog.getByRole('button', { name: '取消全選' }).click();
  await expect(dialog.getByRole('button', { name: '儲存', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: '第 1 句', exact: true }).check();
  await dialog.getByRole('button', { name: '上一步' }).click();
  await dialog.getByLabel('選擇影片').selectOption('');
  await dialog.getByLabel('選擇影片').selectOption('source');
  await dialog.getByRole('button', { name: '下一步' }).click();
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await listDocuments(page, request, 'ytSubtitles')).toHaveLength(1);
  dialog = await openCreator(page);
  await dialog.getByRole('checkbox', { name: '第 2 句', exact: true }).check();
  try {
    await setEmulatorRules(request, denyFirestoreWrites);
    await dialog.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: '第 2 句', exact: true })).toBeChecked();
  } finally {
    await setEmulatorRules(request);
  }
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await listDocuments(page, request, 'ytSubtitles')).length).toBe(2);
  assertHealthy();
});

test('Y06: shadowing created in manual offline mode survives reload and syncs on reconnect', async ({ page, request }) => {
  const assertHealthy = await prepareAppPage(page);
  await register(page, 'shadowing-offline@example.test');
  await seedSource(page, request);
  const dialog = await openCreator(page);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '韓文筆記', exact: true }).click();
  const menu = page.locator('.home-settings-menu');
  await menu.locator('summary').click();
  await menu.getByText('主動離線', { exact: true }).click();
  await expect(menu.getByRole('switch', { name: '主動離線模式' })).toBeChecked();
  const offlineDialog = await openCreator(page);
  await offlineDialog.getByRole('checkbox', { name: '第 1 句', exact: true }).check();
  await offlineDialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(offlineDialog).toHaveCount(0);
  expect(await listDocuments(page, request, 'ytSubtitles')).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: '影片學習', exact: true }).click();
  const card = page.locator('.yt-subtitle-note-card').filter({ hasText: createdTitle });
  await expandAllContentGroups(page, { target: card });
  await expect(card).toContainText('1 句');
  await page.getByRole('button', { name: '韓文筆記', exact: true }).click();
  await menu.locator('summary').click();
  await menu.getByText('主動離線', { exact: true }).click();
  await expect.poll(async () => (await listDocuments(page, request, 'ytSubtitles')).length, { timeout: 15000 }).toBe(2);
  assertHealthy();
});
