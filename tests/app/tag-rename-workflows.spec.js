import { expect, test } from '@playwright/test';
import {
  denyFirestoreWrites, prepareAppPage, readDocument, register,
  resetTestData, seedDocument, setEmulatorRules,
} from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

const cases = [
  { tab: '資料夾', collection: 'folders', fields: { name: '標籤測試', wordIds: ['word-one'], pinned: true } },
  { tab: '影片學習', collection: 'ytSubtitles', fields: {
    title: '標籤測試', mode: 'srt', youtubeUrl: 'https://youtu.be/abcdefghijk',
    entries: [{ id: 'entry', ko: '안녕하세요', zh: '你好', startMs: 5000, endMs: 9000 }],
  } },
];

async function seedGroup(page, request, config) {
  for (const [id, tag, extra] of [
    ['visible', '來源', { pinned: false }],
    ['concealed', '來源', { hidden: true, learned: true }],
    ['pinned', '來源', { pinned: true }],
    ['destination', '目的', {}],
    ['unrelated', '其他', {}],
  ]) {
    await seedDocument(page, request, config.collection, id, { id, ...config.fields, tag, ...extra });
  }
}

async function editTag(page, label = '來源') {
  await page.getByRole('button', { name: `編輯標籤「${label}」`, exact: true }).click();
  return page.getByRole('dialog', { name: '編輯標籤', exact: true });
}

const contentFields = (document) => {
  const { tag, updatedAt, ...fields } = document.fields;
  return fields;
};

for (const config of cases) {
  test(`tag rename in ${config.tab} updates the whole group, merges and clears without changing content`, async ({ page, request }) => {
    const assertHealthy = await prepareAppPage(page);
    await register(page, `tag-rename-${config.collection}@example.test`);
    await seedGroup(page, request, config);
    const before = {};
    for (const id of ['visible', 'concealed', 'pinned', 'destination', 'unrelated']) {
      before[id] = await readDocument(page, request, config.collection, id);
    }
    await page.getByRole('button', { name: config.tab, exact: true }).click();
    let dialog = await editTag(page);
    await expect(dialog).toContainText(config.collection === 'folders' ? '3 個資料夾' : '3 個影片');
    await dialog.getByLabel('標籤名稱').fill('取消改名');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect((await readDocument(page, request, config.collection, 'visible')).fields.tag.stringValue).toBe('來源');
    dialog = await editTag(page);
    await dialog.getByLabel('標籤名稱').fill(' 目的 ');
    await dialog.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: '編輯標籤「來源」', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '編輯標籤「目的」', exact: true })).toBeVisible();
    for (const id of ['visible', 'concealed', 'pinned', 'destination']) {
      await expect.poll(async () => (await readDocument(page, request, config.collection, id)).fields.tag.stringValue).toBe('目的');
      expect(contentFields(await readDocument(page, request, config.collection, id))).toEqual(contentFields(before[id]));
    }
    expect(await readDocument(page, request, config.collection, 'unrelated')).toEqual(before.unrelated);
    if (config.collection === 'ytSubtitles') {
      await expect(page.getByRole('heading', { name: '跟讀練習', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '編輯標籤「跟讀練習」', exact: true })).toHaveCount(0);
    }
    dialog = await editTag(page, '目的');
    await dialog.getByLabel('標籤名稱').fill('');
    await dialog.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    for (const id of ['visible', 'concealed', 'pinned', 'destination']) {
      await expect.poll(async () => (await readDocument(page, request, config.collection, id)).fields.tag.stringValue).toBe('');
    }
    await page.reload();
    await page.getByRole('button', { name: config.tab, exact: true }).click();
    await expect(page.getByRole('button', { name: '編輯標籤「目的」', exact: true })).toHaveCount(0);
    dialog = await editTag(page, '無標籤');
    await expect(dialog.getByLabel('標籤名稱')).toHaveValue('');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assertHealthy();
  });

  test(`tag rename in ${config.tab} preserves input after a rejected batch and can retry`, async ({ page, request }) => {
    const assertHealthy = await prepareAppPage(page);
    await register(page, `tag-retry-${config.collection}@example.test`);
    await seedGroup(page, request, config);
    await page.getByRole('button', { name: config.tab, exact: true }).click();
    const dialog = await editTag(page);
    await dialog.getByLabel('標籤名稱').fill('重試標籤');
    try {
      await setEmulatorRules(request, denyFirestoreWrites);
      await dialog.getByRole('button', { name: '儲存', exact: true }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog.getByLabel('標籤名稱')).toHaveValue('重試標籤');
    } finally {
      await setEmulatorRules(request);
    }
    await dialog.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    for (const id of ['visible', 'concealed', 'pinned']) {
      await expect.poll(async () => (await readDocument(page, request, config.collection, id)).fields.tag.stringValue).toBe('重試標籤');
    }
    assertHealthy();
  });

  test(`tag rename in ${config.tab} stays local offline and syncs after reconnect`, async ({ page, request }) => {
    const assertHealthy = await prepareAppPage(page);
    await register(page, `tag-offline-${config.collection}@example.test`);
    await seedGroup(page, request, config);
    await page.getByRole('button', { name: config.tab, exact: true }).click();
    await expect(page.getByRole('button', { name: '編輯標籤「來源」', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '韓文筆記', exact: true }).click();
    const menu = page.locator('.home-settings-menu');
    await menu.locator('summary').click();
    await menu.getByText('主動離線', { exact: true }).click();
    await expect(menu.getByRole('switch', { name: '主動離線模式' })).toBeChecked();
    await page.getByRole('button', { name: config.tab, exact: true }).click();
    const dialog = await editTag(page);
    await dialog.getByLabel('標籤名稱').fill('離線改名');
    await dialog.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await readDocument(page, request, config.collection, 'concealed')).fields.tag.stringValue).toBe('來源');
    await page.reload();
    await page.getByRole('button', { name: config.tab, exact: true }).click();
    await expect(page.getByRole('button', { name: '編輯標籤「離線改名」', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '韓文筆記', exact: true }).click();
    await menu.locator('summary').click();
    await menu.getByText('主動離線', { exact: true }).click();
    for (const id of ['visible', 'concealed', 'pinned']) {
      await expect.poll(async () => (await readDocument(page, request, config.collection, id)).fields.tag.stringValue, { timeout: 15000 }).toBe('離線改名');
    }
    assertHealthy();
  });
}
