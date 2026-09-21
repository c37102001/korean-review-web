import { expect, test } from '@playwright/test';
import { prepareAppPage, register, resetTestData, seedDocument, seedFolder } from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

async function seedNavigationContent(page, request) {
  const createdAt = '2026-09-21T00:00:00.000Z';
  await seedFolder(page, request, '導覽資料夾');
  await seedDocument(page, request, 'records', 'nav-word', {
    id: 'nav-word', date: '2026-09-21', createdAt, updatedAt: createdAt,
    item: { ko: '안녕하세요', pos: '其他', meanings: [{ zh: '你好', examples: [] }] },
  });
  await seedDocument(page, request, 'grammarNotes', 'nav-note', {
    id: 'nav-note', title: '導覽筆記', notes: '測試內容', category: 'grammar',
    examples: [], createdAt, updatedAt: createdAt,
  });
  await seedDocument(page, request, 'ytSubtitles', 'nav-subtitle', {
    id: 'nav-subtitle', title: '導覽字幕', tag: '', learned: false, youtubeUrl: '', mode: 'json',
    entries: [{ id: 'line-1', ko: '안녕하세요', zh: '你好' }], createdAt, updatedAt: createdAt,
  });
  await seedDocument(page, request, 'readingTests', 'nav-reading', {
    id: 'nav-reading', tag: '', learned: false,
    passage: { ko: '오늘은 맑아요.', zh: '今天天氣晴朗。' },
    question: { ko: '무엇이 맑아요?', zh: '什麼是晴朗的？' },
    options: [{ id: '1', ko: '하늘', zh: '天空' }, { id: '2', ko: '바다', zh: '海洋' }],
    answer: '1', order: 1, createdAt, updatedAt: createdAt,
  });
}

test('G04: every main tab opens its real page and loads its own data', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'navigation@example.test');
  await seedNavigationContent(page, request);
  const destinations = [
    ['日曆', '學習日曆', '2026-09-21'],
    ['單字本', '單字本', '안녕하세요'],
    ['資料夾', '資料夾', '導覽資料夾'],
    ['筆記', '筆記', '導覽筆記'],
    ['YT 字幕', 'YT 字幕', '導覽字幕'],
    ['閱讀測驗', '閱讀測驗', '오늘은 맑아요.'],
  ];
  for (const [tab, heading, content] of destinations) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText(content, { exact: false }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: '韓文筆記' }).click();
  await expect(page.getByRole('heading', { name: '今天練韓文' })).toBeVisible();
  assertNoProductionRequests();
});

test('G04: mobile navigation can open and leave a feature page', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'mobile-navigation@example.test');
  await seedFolder(page, request, '手機資料夾');
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await expect(page.getByText('手機資料夾')).toBeVisible();
  await page.getByRole('button', { name: '回到上一層' }).click();
  await expect(page.getByRole('heading', { name: '今天練韓文' })).toBeVisible();
  assertNoProductionRequests();
});

test('G05: global back returns one level through subtitle and folder details', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'back@example.test');
  await seedFolder(page, request, '返回資料夾');
  await seedDocument(page, request, 'records', 'back-word', {
    id: 'back-word', date: '2026-09-21',
    item: { ko: '돌아가다', pos: '動詞', meanings: [{ zh: '返回', examples: [] }] },
    createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await seedDocument(page, request, 'folders', 'seed-folder', {
    id: 'seed-folder', name: '返回資料夾', tag: '', wordIds: ['back-word'],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T01:00:00.000Z',
  });
  await seedDocument(page, request, 'ytSubtitles', 'back-subtitle', {
    id: 'back-subtitle', title: '返回字幕', mode: 'json', tag: '', learned: false,
    entries: [{ ko: '안녕하세요', zh: '你好' }],
    createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await page.getByText('返回資料夾', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '返回資料夾' })).toBeVisible();
  await page.locator('.notebook-actions').getByRole('button', { name: '學習' }).click();
  await page.locator('.study-back-button').click();
  await expect(page.getByRole('heading', { name: '返回資料夾' })).toBeVisible();
  await page.getByRole('button', { name: '回到上一層' }).click();
  await expect(page.getByRole('heading', { name: '資料夾', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '回到上一層' }).click();
  await expect(page.getByRole('heading', { name: '今天練韓文' })).toBeVisible();

  await page.getByRole('button', { name: 'YT 字幕', exact: true }).click();
  await page.getByText('返回字幕', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '返回字幕' })).toBeVisible();
  await page.getByRole('button', { name: '回到上一層' }).click();
  await expect(page.getByRole('heading', { name: 'YT 字幕' })).toBeVisible();
  assertNoProductionRequests();
});

test('G06: settings menu closes on Escape/outside and commands stay distinct', async ({ page }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'settings-menu@example.test');
  const menu = page.locator('.home-settings-menu');
  await menu.locator('summary').click();
  await expect(menu).toHaveJSProperty('open', true);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveJSProperty('open', false);
  await menu.locator('summary').click();
  await page.getByRole('heading', { name: '今天練韓文' }).click();
  await expect(menu).toHaveJSProperty('open', false);
  await menu.locator('summary').click();
  await menu.getByRole('button', { name: '語音' }).click();
  await expect(page.getByRole('dialog', { name: '語音設定' })).toBeVisible();
  await expect(menu).toHaveJSProperty('open', false);
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: '主動離線模式' })).toHaveCount(0);

  await page.getByRole('button', { name: '單字本', exact: true }).click();
  const more = page.locator('.notebook-actions .action-menu');
  await more.locator('summary').click();
  await expect(more).toHaveJSProperty('open', true);
  await page.keyboard.press('Escape');
  await expect(more).toHaveJSProperty('open', false);
  await more.locator('summary').click();
  await more.getByRole('button', { name: '匯出 JSON' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: '匯出 JSON' })).toBeVisible();
  await expect(more).toHaveJSProperty('open', false);
  await page.getByRole('dialog').getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('heading', { name: '單字本' })).toBeVisible();
  assertNoProductionRequests();
});
