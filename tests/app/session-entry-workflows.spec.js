import { expect, test } from '@playwright/test';
import { prepareAppPage, readDocument, register, resetTestData, seedDocument, seedWord } from './helpers.js';
import { progressShardId } from '../../src/review-engine/store.js';

test.beforeEach(async ({ request }) => resetTestData(request));

test('W13 C03 H07: folder, date and weakest entry points pass only eligible scoped words', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'session-entries@example.test');
  await seedWord(page, request, 'entry-a', '가다', '去', { date: '2026-09-15' });
  await seedWord(page, request, 'entry-b', '보다', '看', { date: '2026-09-21' });
  await seedWord(page, request, 'entry-c', '오다', '來', { date: '2026-09-21', noReview: true });
  await seedWord(page, request, 'entry-d', '먹다', '吃', { date: '2026-09-15' });
  await seedDocument(page, request, 'folders', 'entry-folder', {
    id: 'entry-folder', name: '旅遊', tag: '', wordIds: ['entry-a', 'entry-c'],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await page.locator('.folder-card').filter({ hasText: '旅遊' }).click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(2);
  await page.locator('.notebook-actions').getByRole('button', { name: '學習' }).click();
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('1 / 1');
  await expect(page.locator('.flash-face.front')).toContainText('가다');
  await page.locator('.study-back-button').click();
  await page.locator('.notebook-actions').getByRole('button', { name: '測驗' }).click();
  await expect(page.locator('.practice-start')).toContainText('1 題可測驗');
  await page.getByRole('button', { name: '日曆' }).click();
  await page.locator('.calendar-grid button.day:not(.muted)').nth(14).click();
  await page.getByRole('button', { name: '查看日期' }).click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(2);
  await page.locator('.date-folder-filter-row').getByRole('button', { name: '資料夾 全部' }).click();
  const dateFolders = page.getByRole('group', { name: '資料夾篩選' });
  await dateFolders.getByRole('button', { name: '展開資料夾' }).click();
  await dateFolders.getByRole('checkbox', { name: /旅遊/ }).check();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(1);
  await page.locator('.notebook-actions').getByRole('button', { name: '學習' }).click();
  await expect(page.locator('.flash-face.front')).toContainText('가다');
  await page.locator('.study-back-button').click();
  await page.locator('.date-folder-filter-row').getByRole('button', { name: '資料夾 全部' }).click();
  await page.getByRole('group', { name: '資料夾篩選' }).getByRole('button', { name: '展開資料夾' }).click();
  await page.getByRole('group', { name: '資料夾篩選' }).getByRole('checkbox', { name: /旅遊/ }).check();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(1);
  await page.locator('.notebook-actions').getByRole('button', { name: '測驗' }).click();
  await expect(page.locator('.practice-start')).toContainText('1 題可測驗');
  await page.getByRole('button', { name: '韓文筆記' }).click();
  await expect(page.locator('.weak-practice-panel button')).toContainText('3 題');
  await page.locator('.weak-practice-panel button').click();
  await expect(page.locator('.quiz-meta')).toContainText('1 / 3 · 韓翻中');
  for (let answered = 0; answered < 3; answered += 1) {
    await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
    await page.locator('.practice-decision-panel').getByRole('button', { name: '答對' }).click();
  }
  await expect(page.getByRole('heading', { name: '不熟悉加強 已完成' })).toBeVisible();
  assertNoProductionRequests();
});

test('P01-P02 P04 P07: example source reveals its source card, classification and edit persist', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'example-session@example.test');
  await seedWord(page, request, 'example-a', '가다', '去', {
    date: '2026-09-20', examples: [{ id: 'example-one', ko: '학교에 가요.', zh: '去學校。' }],
  });
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.notebook-actions').getByRole('button', { name: '測驗' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '中翻韓' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '心中作答' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '例句' }).click();
  await expect(page.locator('.practice-start')).toContainText('1 題可測驗');
  await page.locator('.practice-start').getByRole('button', { name: '開始' }).click();
  await expect(page.locator('.practice-page .prompt h1')).toHaveText('去學校。');
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  await expect(page.locator('.practice-answer-panel.visible')).toContainText('학교에 가요.');
  await page.locator('.practice-answer-panel').getByRole('button', { name: '打星號' }).click();
  await page.locator('.practice-decision-panel button[title="加入「不熟悉」"]').click();
  await expect.poll(async () => (await readDocument(page, request, 'folders', 'system-unfamiliar'))?.fields?.wordIds?.arrayValue?.values?.[0]?.stringValue).toBe('example-a');
  await page.locator('.practice-answer-panel').getByRole('button', { name: '編輯' }).click();
  await expect(page.getByRole('heading', { name: '編輯單字' })).toBeVisible();
  await page.getByRole('dialog').getByLabel('韓文 *').fill('가보다');
  await page.getByRole('button', { name: '儲存修改' }).click();
  await expect.poll(async () => (await readDocument(page, request, 'records', 'example-a'))?.fields?.item?.mapValue?.fields?.ko?.stringValue).toBe('가보다');
  await page.locator('.practice-decision-panel').getByRole('button', { name: '答對' }).click();
  await expect(page.getByRole('heading', { name: /已完成/ })).toBeVisible();
  await expect(readDocument(page, request, 'progressShards', progressShardId('example-one'))).resolves.toBeNull();
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-grid .word-card').getByRole('button', { name: '取消星號' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-grid .word-card').getByRole('button', { name: '取消星號' })).toBeVisible();
  assertNoProductionRequests();
});

test('P03 P07: listening, reading and grammar practice reveal the expected stages and finish', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'practice-kinds@example.test');
  await seedWord(page, request, 'kind-a', '가다', '去', {
    date: '2026-09-20', examples: [{ id: 'kind-example', ko: '학교에 가요.', zh: '去學校。' }],
  });
  await seedDocument(page, request, 'grammarNotes', 'kind-grammar', {
    id: 'kind-grammar', title: '-고 싶다', notes: '願望', category: 'grammar',
    examples: [{ id: 'grammar-example', ko: '학교에 가고 싶어요.', zh: '想去學校。' }],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  const createPractice = async (kind, title) => {
    await page.locator('.home-actions').getByRole('button', { name: '新增練習' }).click();
    const dialog = page.getByRole('dialog', { name: '新增練習' });
    await dialog.getByLabel('練習類型').selectOption(kind);
    await expect(dialog).toContainText('可用 1 題');
    await dialog.getByRole('button', { name: '新增練習' }).click();
    await page.locator('.task-card').filter({ hasText: title }).getByRole('button', { name: '開始' }).click();
    await expect(page.locator('.quiz-meta')).toContainText('1 / 1');
  };
  await createPractice('listening', '單字例句聽力練習');
  await expect(page.locator('.recognition-listening-prompt')).toContainText('請聆聽單字例句');
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  await expect(page.locator('.practice-answer-panel.visible')).toContainText('학교에 가요.');
  await page.locator('.practice-decision-panel').getByRole('button', { name: '答對' }).click();
  await expect(page.getByRole('heading', { name: /已完成/ })).toBeVisible();
  await page.getByRole('button', { name: '韓文筆記' }).click();

  await createPractice('reading', '單字例句閱讀練習');
  await expect(page.locator('.practice-page .prompt h1')).toContainText('학교에 가요.');
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  await expect(page.locator('.practice-answer-panel.visible')).toContainText('去學校。');
  await page.locator('.practice-decision-panel').getByRole('button', { name: '答對' }).click();
  await page.getByRole('button', { name: '韓文筆記' }).click();

  await createPractice('grammar', '文法例句練習');
  await expect(page.locator('.recognition-listening-prompt')).toContainText('請聆聽文法例句');
  await page.locator('.practice-page').getByRole('button', { name: '顯示中文' }).click();
  await expect(page.locator('.practice-page .prompt')).toContainText('想去學校。');
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  await expect(page.locator('.practice-answer-panel.visible')).toContainText('학교에 가고 싶어요.');
  await page.locator('.practice-decision-panel').getByRole('button', { name: '答對' }).click();
  await expect(page.getByRole('heading', { name: /已完成/ })).toBeVisible();
  assertNoProductionRequests();
});
