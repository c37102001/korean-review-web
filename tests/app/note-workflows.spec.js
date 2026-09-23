import { expect, test } from '@playwright/test';
import {
  denyFirestoreWrites,
  listDocuments,
  prepareAppPage,
  readDocument,
  register,
  resetTestData,
  seedDocument,
  setEmulatorRules,
} from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

const taggedNote = (title, notes, examples = []) => [
  '[標題]', '', title, '',
  '[筆記]', '', notes, '',
  '[例句]', '',
  ...examples.flatMap((example, index) => [example.ko, example.zh, ...(index < examples.length - 1 ? [''] : [])]),
].join('\n');

const noteCard = (page, title) => page.locator('.grammar-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

async function openNotes(page) {
  await page.getByRole('button', { name: '筆記', exact: true }).click();
  await expect(page.getByRole('heading', { name: '筆記', exact: true })).toBeVisible();
}

async function addNote(page, buttonName, category, content) {
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '新增筆記' }) });
  await dialog.getByRole('button', { name: category, exact: true }).click();
  await dialog.locator('.tagged-note-textarea').fill(content);
  await dialog.getByRole('button', { name: '儲存筆記' }).click();
  await expect(dialog).toHaveCount(0);
}

async function seedNote(page, request, id, title, category = 'vocabulary', order = 0) {
  await seedDocument(page, request, 'grammarNotes', id, {
    id,
    title,
    notes: `${title}說明`,
    category,
    pinned: false,
    examples: [{ id: `${id}-example`, ko: `${title} 한국어`, zh: `${title}中文` }],
    createdAt: `2026-09-2${order}T00:00:00.000Z`,
    updatedAt: `2026-09-21T01:0${order}:00.000Z`,
  });
}

test('N01 N02: create both note types, search, collapse, inspect, edit category, and reload', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'note-lifecycle@example.test');
  await openNotes(page);
  await addNote(page, '新增單字筆記', '單字筆記', taggedNote('生活單字', '每天會用到', [
    { ko: '오늘 날씨가 좋아요.', zh: '今天天氣很好。' },
  ]));
  await addNote(page, '新增文法', '文法筆記', taggedNote('-기로 하다', '表示決定', [
    { ko: '운동하기로 했어요.', zh: '決定要運動。' },
  ]));
  await expect(noteCard(page, '生活單字')).toBeVisible();
  await expect(noteCard(page, '-기로 하다')).toBeVisible();

  const search = page.getByPlaceholder('搜尋標題、筆記或例句');
  await search.fill('運動');
  await expect(noteCard(page, '-기로 하다')).toBeVisible();
  await expect(noteCard(page, '生活單字')).toHaveCount(0);
  await search.fill('');
  await page.getByTitle('收合單字筆記').click();
  await expect(noteCard(page, '生活單字')).toHaveCount(0);
  await page.getByTitle('展開單字筆記').click();

  await noteCard(page, '生活單字').getByRole('heading', { name: '生活單字' }).click();
  const details = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '生活單字' }) });
  await expect(details).toContainText('每天會用到');
  await expect(details).toContainText('今天天氣很好。');
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);

  await noteCard(page, '生活單字').getByRole('button', { name: '編輯筆記' }).click();
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '編輯筆記' }) });
  await editor.getByRole('button', { name: '文法筆記' }).click();
  await editor.locator('.tagged-note-textarea').fill(taggedNote('生活表達', '已移到文法分類', [
    { ko: '오늘 날씨가 정말 좋아요.', zh: '今天天氣真的很好。' },
  ]));
  await editor.getByRole('button', { name: '儲存筆記' }).click();
  await expect(noteCard(page, '生活表達')).toBeVisible();
  const savedNote = async () => (await listDocuments(page, request, 'grammarNotes'))
    .find((document) => document.fields.title?.stringValue === '生活表達');
  await expect.poll(async () => (await savedNote())?.fields.category?.stringValue).toBe('grammar');
  await expect.poll(async () => (await savedNote())?.fields.examples?.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('今天天氣真的很好。');

  await page.reload();
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
  await openNotes(page);
  await expect(noteCard(page, '生活表達')).toBeVisible();
  await expect(noteCard(page, '生活單字')).toHaveCount(0);
  assertNoProductionRequests();
});

test('N03: pin and delete honor persistence, cancel, and tombstones', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'note-pin-delete@example.test');
  await seedNote(page, request, 'note-first', '第一篇', 'vocabulary', 0);
  await seedNote(page, request, 'note-second', '第二篇', 'vocabulary', 1);
  await openNotes(page);
  await expect(noteCard(page, '第二篇')).toBeVisible();
  await noteCard(page, '第一篇').getByRole('button', { name: '釘選筆記' }).click();
  await expect(noteCard(page, '第一篇').getByRole('button', { name: '取消釘選筆記' })).toBeVisible();
  await expect.poll(async () => (await readDocument(page, request, 'grammarNotes', 'note-first'))?.fields.pinned?.booleanValue).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
  await openNotes(page);
  await expect(page.locator('.note-category-section').first().locator('.grammar-card h2').first()).toHaveText('第一篇');
  await noteCard(page, '第一篇').getByRole('button', { name: '取消釘選筆記' }).click();

  page.once('dialog', (dialog) => dialog.dismiss());
  await noteCard(page, '第二篇').getByRole('button', { name: '刪除筆記' }).click();
  await expect(noteCard(page, '第二篇')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await noteCard(page, '第二篇').getByRole('button', { name: '刪除筆記' }).click();
  await expect(noteCard(page, '第二篇')).toHaveCount(0);
  await expect.poll(async () => (await readDocument(page, request, 'grammarNotes', 'note-second'))?.fields.deletedAt?.timestampValue).toBeTruthy();
  assertNoProductionRequests();
});

test('N04: single and selected note practice use exactly the chosen examples', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'note-practice@example.test');
  await seedNote(page, request, 'practice-one', '問候', 'vocabulary', 0);
  await seedNote(page, request, 'practice-two', '天氣', 'vocabulary', 1);
  await openNotes(page);

  await noteCard(page, '問候').getByRole('heading', { name: '問候' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '練習' }).click();
  await expect(page.locator('.practice-start')).toContainText('1 題可測驗');
  await expect(page.locator('.practice-start')).toContainText('此練習包含所選單字筆記的全部例句');
  await page.getByRole('button', { name: '筆記', exact: true }).click();

  await noteCard(page, '問候').getByRole('checkbox', { name: '選取 問候' }).check();
  await noteCard(page, '天氣').getByRole('checkbox', { name: '選取 天氣' }).check();
  const section = page.locator('.note-category-section').first();
  await expect(section).toContainText('已選 2 個筆記');
  await section.getByRole('button', { name: '練習 (2)' }).click();
  await expect(page.locator('.practice-start')).toContainText('2 題可測驗');
  await page.getByRole('button', { name: '筆記', exact: true }).click();
  await section.getByRole('button', { name: '選取本頁' }).click();
  await expect(section).toContainText('已選 2 個筆記');
  await section.getByRole('button', { name: '清除' }).click();
  await expect(section).toContainText('選取單字筆記');
  assertNoProductionRequests();
});

test('N01 N02: invalid input and rejected saves retain content and can retry', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'note-save-errors@example.test');
  await openNotes(page);
  await page.getByRole('button', { name: '新增單字筆記' }).click();
  const dialog = page.getByRole('dialog');
  const textarea = dialog.locator('.tagged-note-textarea');
  await textarea.fill('[標題]\n格式錯誤');
  await dialog.getByRole('button', { name: '儲存筆記' }).click();
  await expect(dialog.locator('.json-edit-error')).toContainText('缺少 [筆記]、[例句] 區段');
  await expect(textarea).toHaveValue('[標題]\n格式錯誤');

  const valid = taggedNote('可重試筆記', '內容仍保留', [{ ko: '다시 해요.', zh: '再試一次。' }]);
  await textarea.fill(valid);
  try {
    await setEmulatorRules(request, denyFirestoreWrites);
    await dialog.getByRole('button', { name: '儲存筆記' }).click();
    await expect(dialog.locator('.json-edit-error')).toBeVisible();
    await expect(textarea).toHaveValue(valid);
  } finally {
    await setEmulatorRules(request);
  }
  await dialog.getByRole('button', { name: '儲存筆記' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(noteCard(page, '可重試筆記')).toBeVisible();

  await page.getByRole('button', { name: '新增單字筆記' }).click();
  await page.getByRole('dialog').locator('.tagged-note-textarea').fill(taggedNote('不應儲存', '取消內容'));
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
  await expect(noteCard(page, '不應儲存')).toHaveCount(0);
  assertNoProductionRequests();
});
