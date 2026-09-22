import { expect, test } from '@playwright/test';
import { prepareAppPage, readDocument, register, resetTestData, seedWord } from './helpers.js';
import { shuffleItems } from '../../src/features/sessions/practice/model.js';

test.beforeEach(async ({ request }) => resetTestData(request));

async function installSpeechStub(page) {
  await page.addInitScript(() => {
    window.__speechCalls = [];
    class TestUtterance { constructor(text) { this.text = text; } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [],
      cancel: () => window.__speechCalls.push({ type: 'cancel' }),
      speak: (utterance) => {
        window.__speechCalls.push({ type: 'speak', text: utterance.text, lang: utterance.lang });
        queueMicrotask(() => utterance.onend?.());
      },
    } });
  });
}

test('S01-S02 S04-S06: study filters, keyboard, Chinese reveal, speech and classification persist', async ({ page, request }) => {
  await installSpeechStub(page);
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'study-controls@example.test');
  await seedWord(page, request, 'study-verb', '가다', '去', { pos: '動詞', variants: ['가요'], examples: [{ ko: '학교에 가요.', zh: '去學校。' }] });
  await seedWord(page, request, 'study-noun', '학교', '學校', { pos: '名詞' });
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(2);
  await page.locator('.notebook-actions').getByRole('button', { name: '學習' }).click();
  await expect(page.locator('.study-page')).toBeVisible();
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('1 / 2');
  const frontWord = page.locator('.flash-face.front .study-pronunciation-row strong');
  const firstWord = await frontWord.textContent();
  await page.getByRole('button', { name: '下一張' }).click();
  const secondWord = await frontWord.textContent();
  await page.getByRole('button', { name: '上一張' }).click();
  await page.getByRole('button', { name: '隨機' }).click();
  const expectedRandom = shuffleItems([firstWord, secondWord], new Date('2026-09-21T09:00:00+08:00').getTime());
  await expect(frontWord).toHaveText(expectedRandom[0]);
  await page.getByRole('button', { name: '下一張' }).click();
  await expect(frontWord).toHaveText(expectedRandom[1]);
  await page.getByRole('button', { name: '隨機' }).click();
  await page.locator('.study-topbar select').selectOption('動詞');
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('1 / 1');
  await expect(page.locator('.flash-face.front')).toContainText('가요');
  await page.getByRole('button', { name: '中文正面' }).click();
  await expect(page.locator('.flash-face.front .flashcard-translation')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(page.locator('.flash-face.front .flashcard-translation')).toHaveText('去');
  await page.keyboard.press('Space');
  await expect(page.locator('.flash-face.front .flashcard-translation')).toHaveCount(0);
  await page.locator('.flash-face.front .card-chinese-toggle').click();
  await expect(page.locator('.flash-face.front .flashcard-translation')).toHaveText('去');
  await page.locator('.flash-face.front .card-chinese-toggle').click();
  await expect(page.locator('.flash-face.front .flashcard-translation')).toHaveCount(0);
  await page.getByRole('button', { name: '韓文正面' }).click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.flashcard')).toHaveClass(/flipped/);
  await page.keyboard.press('Space');
  await expect(page.locator('.flash-face.back')).toContainText('去');
  await page.locator('.study-repeat-control select').selectOption('2');
  await page.getByRole('button', { name: '例句語音' }).click();
  await page.getByRole('button', { name: '語音', exact: true }).click();
  await page.getByRole('button', { name: '自動', exact: true }).click();
  await expect(page.getByRole('button', { name: '自動', exact: true })).toHaveClass(/selected-soft/);
  await page.getByRole('button', { name: '自動', exact: true }).click();
  await page.locator('.study-folder-actions button[title="加入「不熟悉」"]').click();
  await expect(page.locator('.study-folder-actions button[title="移出「不熟悉」"]')).toBeVisible();
  await expect.poll(async () => (await readDocument(page, request, 'folders', 'system-unfamiliar'))?.fields?.wordIds?.arrayValue?.values?.length).toBe(1);
  await page.locator('.flashcard-star').getByRole('button', { name: '打星號' }).click();
  await expect(page.locator('.flashcard-star').getByRole('button', { name: '取消星號' })).toBeVisible();
  await page.locator('.flashcard-star button[title="編輯"]').click();
  await expect(page.getByRole('heading', { name: '編輯單字' })).toBeVisible();
  await page.getByRole('dialog').getByLabel('韓文 *').fill('가보다');
  await page.getByRole('button', { name: '儲存修改' }).click();
  await expect.poll(async () => (await readDocument(page, request, 'records', 'study-verb'))?.fields?.item?.mapValue?.fields?.ko?.stringValue).toBe('가보다');
  await page.locator('.study-topbar select').selectOption('全部');
  await page.getByRole('button', { name: '有星號' }).click();
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('1 / 1');
  await page.getByRole('button', { name: '隨機' }).click();
  await expect(page.getByRole('button', { name: '隨機' })).toHaveClass(/selected-soft/);
  await page.locator('.study-folder-actions button[title="加入「已學習」"]').click();
  await expect(page.locator('.study-folder-actions button[title="移出「已學習」"]')).toBeVisible();
  await expect.poll(async () => (await readDocument(page, request, 'folders', 'system-learned'))?.fields?.wordIds?.arrayValue?.values?.[0]?.stringValue).toBe('study-verb');
  await page.getByRole('button', { name: '返回上一層' }).click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(1);
  const calls = await page.evaluate(() => window.__speechCalls);
  expect(calls.some((call) => call.type === 'speak' && call.text.includes('가다') && call.text.includes('가요') && call.lang === 'ko-KR')).toBeTruthy();
  assertNoProductionRequests();
});

test('S02-S03: study arrows and touch double taps navigate only the intended card', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'study-touch@example.test');
  await seedWord(page, request, 'touch-a', '가다', '去');
  await seedWord(page, request, 'touch-b', '나다', '出現');
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await expect(page.locator('.word-grid .word-card')).toHaveCount(2);
  await page.locator('.notebook-actions').getByRole('button', { name: '學習' }).click();
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('1 / 2');
  await page.getByRole('button', { name: '下一張' }).click();
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('2 / 2');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('1 / 2');
  await page.locator('.flashcard').click({ position: { x: 160, y: 150 } });
  await expect(page.locator('.flashcard')).toHaveClass(/flipped/);
  await page.locator('.flashcard').click({ position: { x: 160, y: 150 } });
  await expect(page.locator('.flashcard')).not.toHaveClass(/flipped/);
  await page.locator('.study-topbar select').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('1 / 2');
  await page.locator('.flashcard').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.flashcard')).toHaveClass(/flipped/);
  await page.keyboard.press('Space');
  await expect(page.locator('.flash-face.back')).toContainText('去');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('2 / 2');
  await expect(page.locator('.flashcard')).not.toHaveClass(/flipped/);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.flash-face.back .card-chinese-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('1 / 2');
  await page.setViewportSize({ width: 390, height: 844 });
  const card = page.locator('.flashcard');
  const bounds = await card.boundingBox();
  const tap = async (fraction, movement = 0) => {
    const x = bounds.x + bounds.width * fraction;
    const y = bounds.y + bounds.height * 0.5;
    await card.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: x, clientY: y });
    await card.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: x + movement, clientY: y });
  };
  await tap(0.85);
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('1 / 2');
  await tap(0.85);
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('2 / 2');
  await tap(0.15);
  await tap(0.15);
  await expect(page.locator('.flash-face.front > span').first()).toHaveText('1 / 2');
  await tap(0.5, 25);
  await tap(0.5);
  await expect(card).not.toHaveClass(/flipped/);
  await tap(0.5);
  await expect(card).toHaveClass(/flipped/);
  assertNoProductionRequests();
});

test('S05: autoplay uses configured repetition and stops speech when disabled or leaving study', async ({ page, request }) => {
  await installSpeechStub(page);
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'study-autoplay@example.test');
  await seedWord(page, request, 'auto-word', '쏟다', '傾倒', { variants: ['쏟아요'], examples: [{ id: 'auto-example', ko: '물을 쏟아요.', zh: '把水倒出來。' }] });
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.notebook-actions').getByRole('button', { name: '學習' }).click();
  await page.getByRole('button', { name: '例句語音' }).click();
  await page.locator('.study-repeat-control select').selectOption('2');
  await page.evaluate(() => { window.__speechCalls = []; });
  await page.getByRole('button', { name: '自動', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.__speechCalls.filter((call) => call.type === 'speak' && call.lang === 'ko-KR'))).length).toBeGreaterThanOrEqual(2);
  const spoken = await page.evaluate(() => window.__speechCalls.filter((call) => call.type === 'speak'));
  expect(spoken.slice(0, 2).map((call) => call.text)).toEqual(['쏟다. 쏟아요', '쏟다. 쏟아요']);
  await page.getByRole('button', { name: '自動', exact: true }).click();
  const callCount = await page.evaluate(() => window.__speechCalls.length);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__speechCalls.length)).toBe(callCount);
  await page.getByRole('button', { name: '每張先隱藏中文' }).click();
  await page.getByRole('button', { name: '例句語音' }).click();
  await page.locator('.study-repeat-control select').selectOption('1');
  await page.evaluate(() => { window.__speechCalls = []; });
  await page.getByRole('button', { name: '自動', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.__speechCalls.filter((call) => call.type === 'speak'))).length).toBeGreaterThanOrEqual(4);
  const fullCycle = await page.evaluate(() => window.__speechCalls.filter((call) => call.type === 'speak').slice(0, 4));
  expect(fullCycle).toEqual([
    { type: 'speak', text: '쏟다. 쏟아요', lang: 'ko-KR' },
    { type: 'speak', text: '傾倒', lang: 'zh-TW' },
    { type: 'speak', text: '물을 쏟아요.', lang: 'ko-KR' },
    { type: 'speak', text: '把水倒出來。', lang: 'zh-TW' },
  ]);
  await page.getByRole('button', { name: '返回上一層' }).click();
  await expect(page.locator('.study-page')).toHaveCount(0);
  assertNoProductionRequests();
});

test('S03: touching an aligned mobile card restores its top edge after a small page drift', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'study-magnet@example.test');
  await seedWord(page, request, 'magnet-a', '가다', '去');
  await page.getByRole('button', { name: '單字本', exact: true }).click();
  await page.locator('.notebook-actions').getByRole('button', { name: '學習' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const position = () => page.evaluate(() => {
    const app = document.querySelector('.app');
    const wrap = document.querySelector('.flashcard-wrap');
    const gap = Number.parseFloat(getComputedStyle(app).getPropertyValue('--mobile-card-edge-gap')) || 0;
    return { top: wrap.getBoundingClientRect().top, target: document.querySelector('.sidebar').getBoundingClientRect().bottom + gap };
  });
  const initial = await position();
  await page.evaluate(({ top, target }) => window.scrollBy({ top: top - target, behavior: 'instant' }), initial);
  await expect.poll(async () => Math.abs((await position()).top - (await position()).target)).toBeLessThanOrEqual(28);
  const card = page.locator('.flashcard');
  const bounds = await card.boundingBox();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await card.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: x, clientY: y });
  await page.evaluate(() => window.scrollBy({ top: 12, behavior: 'instant' }));
  await card.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: x, clientY: y });
  await expect.poll(async () => {
    const { top, target } = await position();
    return Math.abs(top - target);
  }).toBeLessThanOrEqual(2);
  assertNoProductionRequests();
});
