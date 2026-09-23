import { expect, test } from '@playwright/test';
import {
  denyFirestoreWrites,
  prepareAppPage,
  readDocument,
  register,
  resetTestData,
  seedDocument,
  seedWord,
  setEmulatorRules,
} from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

const taskCard = (page, title) => page.locator('.task-card').filter({ hasText: title });

async function openCreator(page) {
  await page.locator('.home-actions').getByRole('button', { name: '新增練習' }).click();
  return page.getByRole('dialog', { name: '新增練習' });
}

async function createPractice(page, kind, title, configure = async () => {}) {
  const dialog = await openCreator(page);
  await dialog.getByLabel('練習類型').selectOption(kind);
  await configure(dialog);
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: '新增練習' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(taskCard(page, title)).toBeVisible();
}

async function optionalPracticeDocument(page, request) {
  return readDocument(page, request, 'settings', 'grammarReview');
}

test('H04: all four practice types create the configured pool and can start', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'optional-types@example.test');
  await seedWord(page, request, 'type-a', '가다', '去', {
    date: '2026-09-20', examples: [{ id: 'type-example-a', ko: '학교에 가요.', zh: '去學校。' }],
  });
  await seedWord(page, request, 'type-b', '보다', '看', {
    date: '2026-09-20', examples: [{ id: 'type-example-b', ko: '영화를 봐요.', zh: '看電影。' }],
  });
  await seedDocument(page, request, 'folders', 'type-folder', {
    id: 'type-folder', name: '動作', tag: '分類', wordIds: ['type-a'],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await expect(page.locator('.folder-card').filter({ hasText: '動作' })).toBeVisible();
  await page.getByRole('button', { name: '韓文筆記' }).click();
  await seedDocument(page, request, 'grammarNotes', 'type-grammar', {
    id: 'type-grammar', title: '-고 싶다', notes: '願望', category: 'grammar',
    examples: [{ id: 'type-grammar-example', ko: '가고 싶어요.', zh: '想去。' }],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T01:01:00.000Z',
  });
  await createPractice(page, 'words', '單字練習', async (dialog) => {
    await dialog.getByLabel('題數').fill('1');
    await dialog.getByLabel('方向').selectOption('zh-ko');
    await dialog.getByPlaceholder('搜尋韓文單字或中文意思').fill('去');
    await dialog.getByRole('button', { name: '熟悉度 全部' }).click();
    await dialog.getByRole('group', { name: '熟悉度篩選' }).getByRole('checkbox', { name: '學習中' }).check();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: /資料夾 全部/ }).click();
    const folders = dialog.getByRole('group', { name: '資料夾篩選' });
    await folders.locator('.folder-filter-group').filter({ hasText: '分類' }).getByRole('button', { name: '展開資料夾' }).click();
    await folders.getByRole('checkbox', { name: /動作/ }).check();
    await expect(dialog).toContainText('可用 1 題');
  });
  await taskCard(page, '單字練習').getByRole('button', { name: '開始' }).click();
  await expect(page.locator('.quiz-meta')).toContainText('1 / 1 · 中翻韓');
  await page.getByRole('button', { name: '韓文筆記' }).click();

  for (const [kind, title] of [
    ['listening', '單字例句聽力練習'],
    ['reading', '單字例句閱讀練習'],
  ]) {
    await createPractice(page, kind, title);
    await taskCard(page, title).getByRole('button', { name: '開始' }).click();
    if (kind === 'listening') {
      await expect(page.locator('.practice-page')).toContainText('請聆聽單字例句');
    } else {
      await expect(page.locator('.practice-page .prompt h1')).toBeVisible();
      await expect(page.locator('.practice-page')).toContainText('請在心中想中文意思');
    }
    await page.getByRole('button', { name: '韓文筆記' }).click();
  }

  await createPractice(page, 'grammar', '文法例句練習', async (dialog) => {
    await dialog.locator('select').nth(1).selectOption({ label: '-고 싶다' });
    await expect(dialog).toContainText('可用 1 題');
  });
  await taskCard(page, '文法例句練習').getByRole('button', { name: '開始' }).click();
  await expect(page.locator('.practice-page')).toContainText('請聆聽文法例句');
  const stored = await optionalPracticeDocument(page, request);
  expect(stored?.fields?.optionalPractice?.mapValue?.fields?.tasks?.arrayValue?.values?.length).toBe(4);
  assertNoProductionRequests();
});

test('H05: partial completion survives navigation and reload; correct and wrong answers update the pool', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'optional-progress@example.test');
  await seedWord(page, request, 'pool-a', '가다', '去', { date: '2026-09-20' });
  await seedWord(page, request, 'pool-b', '보다', '看', { date: '2026-09-20' });
  await expect(page.getByText('2 題單字待複習', { exact: false })).toBeVisible();
  await createPractice(page, 'words', '單字練習', async (dialog) => dialog.getByLabel('題數').fill('2'));
  await taskCard(page, '單字練習').getByRole('button', { name: '開始' }).click();
  const firstQuestion = await page.locator('.practice-page .prompt h1').textContent();
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  await page.locator('.practice-decision-panel').getByRole('button', { name: '答對' }).click();
  await expect(page.locator('.quiz-meta')).toContainText('2 / 2');
  await page.getByRole('button', { name: '韓文筆記' }).click();
  await expect(taskCard(page, '單字練習')).toContainText('剩餘 1 題');
  await page.reload();
  await expect(taskCard(page, '單字練習')).toContainText('剩餘 1 題');
  await taskCard(page, '單字練習').getByRole('button', { name: '開始' }).click();
  await expect(page.locator('.quiz-meta')).toContainText('1 / 1');
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  await page.locator('.practice-decision-panel').getByRole('button', { name: '答錯' }).click();
  await expect(page.getByRole('heading', { name: /單字練習.*已完成/ })).toBeVisible();
  await page.getByRole('button', { name: '韓文筆記' }).click();
  await expect(taskCard(page, '單字練習')).toHaveCount(0);
  const state = (await optionalPracticeDocument(page, request)).fields.optionalPractice.mapValue.fields;
  const seenIds = state.pools.mapValue.fields.words.arrayValue.values.map((value) => value.stringValue);
  expect(seenIds).toEqual([firstQuestion === '가다' ? 'pool-a' : 'pool-b']);
  await createPractice(page, 'words', '單字練習', async (dialog) => dialog.getByLabel('題數').fill('1'));
  await taskCard(page, '單字練習').getByRole('button', { name: '開始' }).click();
  await expect(page.locator('.practice-page .prompt h1')).not.toHaveText(firstQuestion.trim());
  assertNoProductionRequests();
});

test('H06 H10: cancel and close create nothing; removal respects confirm and dismiss', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'optional-cancel@example.test');
  await seedWord(page, request, 'cancel-a', '가다', '去', { date: '2026-09-20' });
  let dialog = await openCreator(page);
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(taskCard(page, '單字練習')).toHaveCount(0);
  dialog = await openCreator(page);
  await dialog.getByRole('button', { name: '關閉' }).click();
  await expect(taskCard(page, '單字練習')).toHaveCount(0);
  await createPractice(page, 'words', '單字練習', async (modal) => modal.getByLabel('題數').fill('1'));
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await taskCard(page, '單字練習').getByRole('button', { name: '移除練習' }).click();
  await expect(taskCard(page, '單字練習')).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.accept());
  await taskCard(page, '單字練習').getByRole('button', { name: '移除練習' }).click();
  await expect(taskCard(page, '單字練習')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
  await expect(taskCard(page, '單字練習')).toHaveCount(0);
  expect((await optionalPracticeDocument(page, request))?.fields?.optionalPractice?.mapValue?.fields?.tasks?.arrayValue?.values || []).toHaveLength(0);
  assertNoProductionRequests();
});

test('H10: rejected practice creation keeps all selections and succeeds after retry', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'optional-rejected@example.test');
  await seedWord(page, request, 'reject-a', '가다', '去', { date: '2026-09-20' });
  const dialog = await openCreator(page);
  await dialog.getByLabel('練習類型').selectOption('words');
  await dialog.getByLabel('題數').fill('1');
  await dialog.getByLabel('方向').selectOption('zh-ko');
  await dialog.getByPlaceholder('搜尋韓文單字或中文意思').fill('去');
  try {
    await setEmulatorRules(request, denyFirestoreWrites);
    await dialog.getByRole('button', { name: '新增練習' }).click();
    await expect(dialog.locator('.form-error')).toBeVisible();
    await expect(dialog.getByLabel('題數')).toHaveValue('1');
    await expect(dialog.getByLabel('方向')).toHaveValue('zh-ko');
    await expect(dialog.getByPlaceholder('搜尋韓文單字或中文意思')).toHaveValue('去');
  } finally {
    await setEmulatorRules(request);
  }
  await dialog.getByRole('button', { name: '新增練習' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(taskCard(page, '單字練習')).toBeVisible();
  assertNoProductionRequests();
});
