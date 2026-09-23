import { expect, test } from '@playwright/test';
import { denyFirestoreWrites, prepareAppPage, readDocument, register, resetTestData, seedWord, setEmulatorRules } from './helpers.js';
import { progressShardId } from '../../src/review-engine/store.js';

test.beforeEach(async ({ request }) => resetTestData(request));

async function answerSelfGrade(page, correct) {
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  await expect(page.locator('.practice-answer-panel.visible')).toBeVisible();
  await page.locator('.practice-decision-panel').getByRole('button', { name: correct ? '答對' : '答錯' }).click();
}

test('H01 H07 P02-P03 P08: daily review records answers, and wrong-review shrinks after retry', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'daily-session@example.test');
  await seedWord(page, request, 'daily-a', '가다', '去', { date: '2026-09-20' });
  await seedWord(page, request, 'daily-b', '나다', '出現', { date: '2026-09-20' });
  await expect(page.getByText('2 題單字待複習', { exact: false })).toBeVisible();
  await page.locator('.home-actions').getByRole('button', { name: '今日測驗' }).click();
  await expect(page.locator('.practice-start')).toContainText('2 題可測驗');
  await expect(page.locator('.practice-start button.active')).toContainText('韓翻中');
  await page.locator('.practice-start').getByRole('button', { name: '開始' }).click();
  const wrongWord = await page.locator('.practice-page .prompt h1').textContent();
  await answerSelfGrade(page, false);
  await answerSelfGrade(page, true);
  await expect(page.getByRole('heading', { name: '今日測驗 已完成' })).toBeVisible();
  await expect(page.locator('.practice-mistake-card')).toHaveCount(1);
  await expect(page.locator('.practice-mistake-card')).toContainText(wrongWord.trim());
  await expect.poll(async () => (await readDocument(page, request, 'progressShards', progressShardId(wrongWord.trim() === '가다' ? 'daily-a' : 'daily-b')))?.fields?.entries).toBeTruthy();
  await page.getByRole('button', { name: '韓文筆記' }).click();
  await expect(page.locator('.wrong-review-task-card')).toContainText('1 個單字');
  await expect(page.locator('.hero-meter .ring')).toHaveText('100%');
  await expect(page.locator('.home-actions').getByRole('button', { name: '今日測驗' })).toBeDisabled();
  await page.getByRole('button', { name: '日曆' }).click();
  await expect(page.locator('.calendar-grid button.day.today .day-flame')).toBeVisible();
  await page.getByRole('button', { name: '韓文筆記' }).click();
  await page.locator('.wrong-review-task-card').getByRole('button', { name: '查看' }).click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(1);
  await page.locator('.notebook-actions').getByRole('button', { name: '學習' }).click();
  await expect(page.locator('.study-page')).toContainText(wrongWord.trim());
  await page.locator('.study-back-button').click();
  await page.locator('.notebook-actions').getByRole('button', { name: '測驗' }).click();
  await expect(page.locator('.practice-start')).toContainText('1 題可測驗');
  await page.locator('.practice-start').getByRole('button', { name: '中翻韓' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '韓翻中' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '開始' }).click();
  await page.clock.setFixedTime(new Date('2026-09-21T09:00:05+08:00'));
  await answerSelfGrade(page, true);
  await expect(page.locator('.practice-mistake-review')).toContainText('這次沒有答錯的單字');
  await page.getByRole('button', { name: '韓文筆記' }).click();
  await expect(page.locator('.wrong-review-task-card')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.wrong-review-task-card')).toHaveCount(0);
  assertNoProductionRequests();
});

test('W13 P01-P04 P08: filtered notebook test can self-grade, review and retry only mistakes without recording', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'notebook-session@example.test');
  await seedWord(page, request, 'list-a', '가다', '去', { pos: '動詞', date: '2026-09-20' });
  await seedWord(page, request, 'list-b', '학교', '學校', { pos: '名詞', date: '2026-09-20' });
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(2);
  await page.locator('.notebook-actions').getByRole('button', { name: '測驗' }).click();
  await expect(page.locator('.practice-start')).toContainText('2 題可測驗');
  await page.locator('.practice-start').getByRole('button', { name: '有星號' }).click();
  await expect(page.locator('.practice-start')).toContainText('0 題可測驗');
  await page.locator('.practice-start').getByRole('button', { name: '全部卡片' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '中翻韓' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '打字輸入' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '例句' }).click();
  await expect(page.locator('.practice-start')).toContainText('0 題可測驗');
  await page.locator('.practice-start').getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.locator('.practice-start')).toContainText('2 題可測驗');
  await page.locator('.practice-start').getByRole('button', { name: '單字 / 片語' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '韓翻中' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '隨機順序' }).click();
  await expect(page.locator('.practice-start').getByRole('button', { name: '隨機順序' })).toHaveClass(/active/);
  await page.locator('.practice-start').getByRole('button', { name: '依原順序' }).click();
  await expect(page.locator('.practice-start')).toContainText('不會改變熟悉分數');
  await page.locator('.practice-start').getByRole('button', { name: '開始' }).click();
  await expect(page.locator('.practice-page .prompt h1')).toHaveText('가다');
  await answerSelfGrade(page, false);
  await answerSelfGrade(page, true);
  await expect(page.locator('.practice-mistake-card')).toHaveCount(1);
  await expect(page.locator('.practice-mistake-card')).toContainText('가다');
  await expect(readDocument(page, request, 'progressShards', progressShardId('list-a'))).resolves.toBeNull();
  await page.getByRole('button', { name: '重測錯題' }).click();
  await expect(page.locator('.quiz-meta')).toContainText('1 / 1');
  await answerSelfGrade(page, true);
  await expect(page.locator('.practice-mistake-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重測錯題' })).toHaveCount(0);
  await expect(readDocument(page, request, 'progressShards', progressShardId('list-a'))).resolves.toBeNull();
  assertNoProductionRequests();
});

test('P01-P02: typed answers, answer reveal and recording choice follow the selected policy', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'typed-session@example.test');
  await seedWord(page, request, 'typed-a', '가다', '去', { date: '2026-09-20' });
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.notebook-actions').getByRole('button', { name: '測驗' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '中翻韓' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '紀錄答對答錯' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '開始' }).click();
  await expect(page.locator('.practice-page .prompt h1')).toHaveText('去');
  await page.getByPlaceholder('여기에 한국어를 입력하세요 (Enter 送出)').fill('가다');
  await page.locator('.answer-actions').getByRole('button', { name: '確認' }).click();
  await expect(page.locator('.practice-answer-panel.visible')).toContainText('가다');
  await expect(page.locator('.answer-inline-celebration')).toBeVisible();
  await page.locator('.typed-folder-actions button[title="加入「已學習」"]').click();
  await expect.poll(async () => (await readDocument(page, request, 'folders', 'system-learned'))?.fields?.wordIds?.arrayValue?.values?.[0]?.stringValue).toBe('typed-a');
  await page.locator('.answer-actions').getByRole('button', { name: '下一題' }).click();
  await expect(page.getByRole('heading', { name: /已完成/ })).toBeVisible();
  await expect.poll(async () => (await readDocument(page, request, 'progressShards', progressShardId('typed-a')))?.fields?.entries?.mapValue?.fields?.['typed-a']?.mapValue?.fields?.stats?.mapValue?.fields?.correct?.integerValue).toBe('1');
  assertNoProductionRequests();
});

test('P02 P08: a wrong typed answer reveals the Korean card and can be retried correctly', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'typed-wrong@example.test');
  await seedWord(page, request, 'typed-wrong', '보다', '看', { date: '2026-09-20' });
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.notebook-actions').getByRole('button', { name: '測驗' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '中翻韓' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '開始' }).click();
  await page.getByPlaceholder('여기에 한국어를 입력하세요 (Enter 送出)').fill('가다');
  await page.locator('.answer-actions').getByRole('button', { name: '確認' }).click();
  await expect(page.locator('.answer-inline-wrong')).toHaveText('答錯');
  await expect(page.locator('.practice-answer-panel.visible')).toContainText('보다');
  await page.locator('.answer-actions').getByRole('button', { name: '下一題' }).click();
  await expect(page.locator('.practice-mistake-card')).toContainText('보다');
  await page.getByRole('button', { name: '重測錯題' }).click();
  await page.getByPlaceholder('여기에 한국어를 입력하세요 (Enter 送出)').fill('보다');
  await page.getByPlaceholder('여기에 한국어를 입력하세요 (Enter 送出)').press('Enter');
  await expect(page.locator('.answer-inline-celebration')).toBeVisible();
  await page.getByPlaceholder('여기에 한국어를 입력하세요 (Enter 送出)').press('Enter');
  await expect(page.locator('.practice-no-mistakes')).toContainText('這次沒有答錯的單字');
  assertNoProductionRequests();
});

test('P05: daily audio controls replay the requested language and stop automatic prompt speech', async ({ page, request }) => {
  await page.addInitScript(() => {
    window.__spoken = [];
    class TestUtterance { constructor(text) { this.text = text; } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [], cancel: () => {}, resume: () => {},
      speak: (utterance) => window.__spoken.push({ text: utterance.text, lang: utterance.lang }),
    } });
  });
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'practice-audio@example.test');
  await seedWord(page, request, 'audio-a', '쏟다', '傾倒', { date: '2026-09-20', variants: ['쏟아요'] });
  await page.locator('.home-actions').getByRole('button', { name: '今日測驗' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '開始' }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__spoken[0])).toEqual({ text: '쏟다. 쏟아요', lang: 'ko-KR' });
  await page.locator('.quiz-options').getByRole('button', { name: '自動發音' }).click();
  await page.evaluate(() => { window.__spoken = []; });
  await page.locator('.quiz-options').getByRole('button', { name: '重播' }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken)).toEqual([{ text: '쏟다. 쏟아요', lang: 'ko-KR' }]);
  await page.locator('.quiz-options').getByRole('button', { name: '自動發音' }).click();
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.at(-1))).toEqual({ text: '傾倒', lang: 'zh-TW' });
  await page.locator('.quiz-options').getByRole('button', { name: '中文發音' }).click();
  await page.locator('.quiz-options').getByRole('button', { name: '重播' }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.at(-1))).toEqual({ text: '쏟다. 쏟아요', lang: 'ko-KR' });
  await page.locator('.quiz-options').getByRole('button', { name: '音效' }).click();
  await expect(page.locator('.quiz-options').getByRole('button', { name: '音效' })).not.toHaveClass(/selected-soft/);
  assertNoProductionRequests();
});

test('P05: moving to the next daily question does not replay the previous answer', async ({ page, request }) => {
  await page.addInitScript(() => {
    window.__spoken = [];
    class TestUtterance { constructor(text) { this.text = text; } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [], cancel: () => {}, resume: () => {},
      speak: (utterance) => window.__spoken.push({ text: utterance.text, lang: utterance.lang }),
    } });
  });
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'practice-audio-next@example.test');
  await seedWord(page, request, 'next-a', '가다', '去', { date: '2026-09-20' });
  await seedWord(page, request, 'next-b', '보다', '看', { date: '2026-09-20' });
  await expect(page.getByText('2 題單字待複習', { exact: false })).toBeVisible();
  await page.locator('.home-actions').getByRole('button', { name: '今日測驗' }).click();
  await page.locator('.practice-start').getByRole('button', { name: '開始' }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBeGreaterThan(0);
  const firstKorean = await page.locator('.practice-page .prompt h1').textContent();
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.at(-1)?.lang)).toBe('zh-TW');
  await page.evaluate(() => { window.__spoken = []; });
  await page.locator('.practice-decision-panel').getByRole('button', { name: '答對' }).click();
  await expect(page.locator('.quiz-meta')).toContainText('2 / 2');
  const secondKorean = await page.locator('.practice-page .prompt h1').textContent();
  expect(secondKorean).not.toBe(firstKorean);
  await expect.poll(() => page.evaluate(() => window.__spoken)).toEqual([{ text: secondKorean.trim(), lang: 'ko-KR' }]);
  assertNoProductionRequests();
});

test('P08: a failed optional answer keeps the question available and succeeds on retry', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'practice-retry@example.test');
  await seedWord(page, request, 'retry-a', '가다', '去', { date: '2026-09-20' });
  await page.locator('.home-actions').getByRole('button', { name: '新增練習' }).click();
  const dialog = page.getByRole('dialog', { name: '新增練習' });
  await dialog.getByLabel('練習類型').selectOption('words');
  await dialog.getByLabel('題數').fill('1');
  await dialog.getByRole('button', { name: '新增練習' }).click();
  await expect(page.locator('.task-card').filter({ hasText: '單字練習' })).toBeVisible();
  await page.locator('.task-card').filter({ hasText: '單字練習' }).getByRole('button', { name: '開始' }).click();
  await expect(page.locator('.quiz-meta')).toContainText('1 / 1');
  await page.locator('.practice-page').getByRole('button', { name: '公佈答案' }).click();
  try {
    await setEmulatorRules(request, denyFirestoreWrites);
    await page.locator('.practice-decision-panel').getByRole('button', { name: '答對' }).click();
    await expect(page.locator('.practice-page .form-error')).toContainText('失敗');
    await expect(page.locator('.quiz-meta')).toContainText('1 / 1');
  } finally {
    await setEmulatorRules(request);
  }
  const retryButton = page.locator('.practice-decision-panel').getByRole('button', { name: '答對' });
  const completedHeading = page.getByRole('heading', { name: /單字練習.*已完成/ });
  await expect.poll(async () => {
    if (await completedHeading.isVisible()) return 'completed';
    if (await retryButton.isEnabled()) return 'retry-ready';
    return 'pending';
  }).not.toBe('pending');
  if (await retryButton.isVisible()) await retryButton.click();
  await expect(completedHeading).toBeVisible();
  await page.getByRole('button', { name: '韓文筆記' }).click();
  await expect(page.locator('.task-card').filter({ hasText: '單字練習' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.task-card').filter({ hasText: '單字練習' })).toHaveCount(0);
  assertNoProductionRequests();
});

test('P06: an existing optional word task drops a word marked no-review before it starts', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'optional-eligibility@example.test');
  await seedWord(page, request, 'eligible-a', '가다', '去', { date: '2026-09-20' });
  await seedWord(page, request, 'eligible-b', '나다', '出現', { date: '2026-09-20' });
  await page.locator('.home-actions').getByRole('button', { name: '新增練習' }).click();
  const dialog = page.getByRole('dialog', { name: '新增練習' });
  await dialog.getByLabel('練習類型').selectOption('words');
  await dialog.getByLabel('題數').fill('2');
  await dialog.getByRole('button', { name: '新增練習' }).click();
  await expect(page.locator('.task-card').filter({ hasText: '單字練習' })).toContainText('剩餘 2 題');
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.word-grid .word-card').filter({ hasText: '가다' }).getByRole('button', { name: '編輯' }).click();
  await page.getByRole('checkbox', { name: '不複習' }).check();
  await page.getByRole('button', { name: '儲存修改' }).click();
  await expect.poll(async () => (await readDocument(page, request, 'records', 'eligible-a'))?.fields?.item?.mapValue?.fields?.noReview?.booleanValue).toBe(true);
  await page.getByRole('button', { name: '韓文筆記' }).click();
  await expect(page.locator('.task-card').filter({ hasText: '單字練習' })).toContainText('剩餘 1 題');
  await page.locator('.task-card').filter({ hasText: '單字練習' }).getByRole('button', { name: '開始' }).click();
  await expect(page.locator('.quiz-meta')).toContainText('1 / 1');
  await expect(page.locator('.practice-page .prompt h1')).toHaveText('나다');
  assertNoProductionRequests();
});
