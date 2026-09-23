import { expect, test } from '@playwright/test';
import { currentUserId, prepareAppPage, readDocument, register, resetTestData, seedDocument, seedWord } from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

const cards = (page) => page.locator('.word-grid .word-card');

async function openFolders(page) {
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await expect(page.getByRole('heading', { name: '資料夾', exact: true })).toBeVisible();
}

async function createFolder(page, name, tag = '') {
  await page.getByRole('button', { name: '新增資料夾' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('資料夾名稱').fill(name);
  if (tag) await dialog.getByLabel('標籤').fill(tag);
  await dialog.getByRole('button', { name: '儲存' }).click();
  await expect(dialog).toHaveCount(0);
  return page.locator('.folder-card').filter({ hasText: name });
}

async function folderDocByName(page, request, name) {
  const uid = await currentUserId(page);
  const response = await request.get(`http://127.0.0.1:8080/v1/projects/demo-korean-review-web/databases/(default)/documents/users/${uid}/folders`, {
    headers: { Authorization: 'Bearer owner' },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).documents?.find((row) => row.fields.name?.stringValue === name);
}

test('F01 F02 F04: create, rename, tag, pin, collapse and delete preserve words', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'folder-lifecycle@example.test');
  await seedWord(page, request, 'one', '책', '書');
  await openFolders(page);
  const learned = page.locator('.folder-card').filter({ hasText: '已學習' });
  await expect(learned.getByRole('button', { name: '刪除資料夾' })).toHaveCount(0);
  await learned.getByRole('button', { name: '編輯標籤' }).click();
  await expect(page.getByRole('dialog').getByLabel('資料夾名稱')).toBeDisabled();
  await page.getByRole('dialog').getByLabel('標籤').fill('系統');
  await page.getByRole('dialog').getByRole('button', { name: '儲存' }).click();
  await expect(learned.locator('.folder-tag-chip')).toHaveText('系統');
  const first = await createFolder(page, '讀書', '學校');
  await expect(first).toBeVisible();
  const classmate = await createFolder(page, '同學', '學校');
  await expect(classmate).toBeVisible();
  await expect(page.locator('.folder-tag-group').filter({ hasText: '學校' })).toContainText('2 個資料夾');
  const second = await createFolder(page, '其他');
  await expect(second).toBeVisible();
  const folderId = (await folderDocByName(page, request, '讀書'))?.name.split('/').pop();
  expect(folderId).toBeTruthy();
  await first.getByRole('button', { name: '釘選資料夾' }).click();
  await expect(page.locator('.folder-tag-groups')).toContainText('置頂資料夾');
  await first.getByRole('button', { name: '取消釘選資料夾' }).click();
  const group = page.locator('.folder-tag-group').filter({ has: page.locator('.folder-tag-group-heading h2', { hasText: /^學校$/ }) });
  await group.locator('.folder-tag-group-toggle').click();
  await expect(first).toHaveCount(0);
  await group.locator('.folder-tag-group-toggle').click();
  await first.getByRole('button', { name: '編輯資料夾' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('資料夾名稱').fill('閱讀');
  await dialog.getByLabel('標籤').fill('語言');
  await dialog.getByRole('button', { name: '儲存' }).click();
  const renamed = page.locator('.folder-card').filter({ hasText: '閱讀' });
  await expect(renamed).toBeVisible();
  await expect.poll(async () => (await readDocument(page, request, 'folders', folderId))?.fields.name.stringValue).toBe('閱讀');
  page.once('dialog', (dialog) => dialog.dismiss());
  await renamed.getByRole('button', { name: '刪除資料夾' }).click();
  await expect(renamed).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await renamed.getByRole('button', { name: '刪除資料夾' }).click();
  await expect(renamed).toHaveCount(0);
  await expect.poll(async () => (await readDocument(page, request, 'folders', folderId))?.fields.deletedAt?.timestampValue).toBeTruthy();
  expect(await readDocument(page, request, 'records', 'one')).not.toBeNull();
  assertNoProductionRequests();
});

test('F05 W11: stale folder references can be removed and single-card deletion clears memberships', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'folder-stale@example.test');
  await seedWord(page, request, 'live', '꽃', '花');
  await seedDocument(page, request, 'folders', 'stale-folder', {
    id: 'stale-folder', name: '整理', tag: '', wordIds: ['live', 'missing'],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await openFolders(page);
  await page.locator('.folder-card').filter({ hasText: '整理' }).click();
  await page.getByRole('button', { name: /清理 1 個不存在的單字 reference/ }).click();
  await expect.poll(async () => (await readDocument(page, request, 'folders', 'stale-folder'))?.fields.wordIds?.arrayValue?.values?.map((entry) => entry.stringValue)).toEqual(['live']);
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await cards(page).first().getByRole('button', { name: '刪除' }).click();
  await expect(cards(page)).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept());
  await cards(page).first().getByRole('button', { name: '刪除' }).click();
  await expect(cards(page)).toHaveCount(0);
  await expect.poll(async () => (await readDocument(page, request, 'records', 'live'))?.fields.deletedAt?.timestampValue).toBeTruthy();
  await expect.poll(async () => (await readDocument(page, request, 'folders', 'stale-folder'))?.fields.wordIds?.arrayValue?.values?.length || 0).toBe(0);
  assertNoProductionRequests();
});

test('F03 F05 W10 W11: add references, remove membership, and permanently delete a card', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'folder-members@example.test');
  await seedWord(page, request, 'first', '사과', '蘋果', { notes: ['水果筆記'] });
  await seedWord(page, request, 'second', '바나나', '香蕉');
  await openFolders(page);
  const folder = await createFolder(page, '水果');
  await folder.click();
  await expect(page.getByRole('heading', { name: '水果' })).toBeVisible();
  await page.locator('.notebook-actions .action-menu summary').click();
  await page.getByRole('button', { name: '加入現有單字' }).click();
  const addDialog = page.getByRole('dialog');
  await addDialog.getByPlaceholder('搜尋韓文單字或中文意思').fill('蘋果');
  await expect(addDialog.locator('.existing-word-results label')).toHaveCount(1);
  await addDialog.locator('.existing-word-results input[type=checkbox]').check();
  await addDialog.getByPlaceholder('搜尋韓文單字或中文意思').fill('香蕉');
  await expect(addDialog.locator('.existing-word-results label')).toHaveCount(1);
  await addDialog.locator('.existing-word-results input[type=checkbox]').check();
  await expect(addDialog).toContainText('已選擇 2 個單字');
  await addDialog.getByRole('button', { name: '加入資料夾' }).click();
  await expect(addDialog).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).filter({ hasText: '사과' }).getByText('蘋果')).toHaveCount(0);
  await cards(page).filter({ hasText: '사과' }).getByRole('button', { name: '顯示中文' }).click();
  await expect(cards(page).filter({ hasText: '사과' }).getByText('蘋果')).toBeVisible();
  await page.locator('.notebook-actions').getByRole('button', { name: '顯示中文' }).click();
  await page.reload();
  await openFolders(page);
  await page.locator('.folder-card').filter({ hasText: '水果' }).click();
  await expect(cards(page)).toHaveCount(2);
  await page.getByPlaceholder('搜尋韓文單字或中文意思').fill('水果筆記');
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await page.getByPlaceholder('搜尋這個資料夾中的全部卡片內容').fill('');
  await expect(cards(page)).toHaveCount(2);
  await page.locator('.notebook-actions .action-menu summary').click();
  await page.getByRole('button', { name: '匯出 JSON' }).click();
  const exportDialog = page.getByRole('dialog');
  const exported = JSON.parse(await exportDialog.locator('pre').innerText());
  expect(exported.data.map((entry) => entry.ko).sort()).toEqual(['바나나', '사과'].sort());
  await exportDialog.getByRole('button', { name: '關閉' }).click();
  await cards(page).filter({ hasText: '사과' }).getByRole('button', { name: '編輯' }).click();
  await expect(page.getByRole('dialog').getByLabel('韓文 *')).toHaveValue('사과');
  await page.getByRole('dialog').getByRole('button', { name: '關閉' }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await cards(page).filter({ hasText: '사과' }).getByRole('button', { name: '從資料夾移除' }).click();
  await expect(cards(page)).toHaveCount(2);
  page.once('dialog', (dialog) => dialog.accept());
  await cards(page).filter({ hasText: '사과' }).getByRole('button', { name: '從資料夾移除' }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('바나나');
  expect(await readDocument(page, request, 'records', 'first')).not.toBeNull();
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(cards(page)).toHaveCount(2);
  await page.getByRole('checkbox', { name: '選取 사과' }).check();
  await page.locator('.bulk-action-buttons').getByRole('button', { name: '加入資料夾' }).click();
  const assign = page.getByRole('dialog');
  await assign.locator('.folder-picker-dropdown summary').click();
  await assign.locator('.folder-picker-dropdown-menu label').filter({ hasText: '水果' }).getByRole('checkbox').check();
  await assign.getByRole('button', { name: '加入所選' }).click();
  await expect(assign).toHaveCount(0);
  await expect(cards(page).filter({ hasText: '사과' })).toContainText('水果');
  await page.getByRole('checkbox', { name: '選取 바나나' }).check();
  await page.locator('.bulk-action-buttons').getByRole('button', { name: '加入資料夾' }).click();
  await assign.getByPlaceholder('輸入新資料夾名稱').fill('新水果');
  await assign.getByRole('button', { name: '建立並加入' }).click();
  await expect(assign).toHaveCount(0);
  await expect(cards(page).filter({ hasText: '바나나' })).toContainText('新水果');
  await page.getByRole('checkbox', { name: '選取 바나나' }).check();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('.bulk-action-buttons').getByRole('button', { name: '永久刪除' }).click();
  await expect(cards(page)).toHaveCount(2);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.bulk-action-buttons').getByRole('button', { name: '永久刪除' }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect.poll(async () => (await readDocument(page, request, 'records', 'second'))?.fields.deletedAt?.timestampValue).toBeTruthy();
  await expect.poll(async () => (await folderDocByName(page, request, '新水果'))?.fields.wordIds?.arrayValue?.values?.length || 0).toBe(0);
  assertNoProductionRequests();
});

test('F03: select all chooses every filtered word across folder pages', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'folder-select-all@example.test');
  const wordIds = [];
  for (let index = 0; index < 31; index += 1) {
    const id = `folder-word-${String(index).padStart(2, '0')}`;
    wordIds.push(id);
    await seedWord(page, request, id, `단어${index}`, index < 2 ? `共同意思${index}` : `意思${index}`);
  }
  await seedDocument(page, request, 'folders', 'select-all-folder', {
    id: 'select-all-folder', name: '全部選取', tag: '', wordIds,
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await openFolders(page);
  await page.locator('.folder-card').filter({ hasText: '全部選取' }).click();
  await expect(cards(page)).toHaveCount(30);
  const summary = page.locator('.bulk-selection-summary');
  await summary.getByRole('button', { name: '選取全部' }).click();
  await expect(summary).toContainText('已選 31 個');
  await expect(summary.getByRole('button', { name: '取消全部' })).toBeVisible();
  await page.getByPlaceholder('搜尋韓文單字或中文意思').fill('共同意思');
  await expect(cards(page)).toHaveCount(2);
  await expect(summary).toContainText('已選 2 個');
  await summary.getByRole('button', { name: '取消全部' }).click();
  await expect(summary).toContainText('批次選取');
  await summary.getByRole('button', { name: '選取全部' }).click();
  await expect(summary).toContainText('已選 2 個');
  assertNoProductionRequests();
});
