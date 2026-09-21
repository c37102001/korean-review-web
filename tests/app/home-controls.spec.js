import { expect, test } from '@playwright/test';
import { prepareAppPage, register, resetTestData, seedDocument } from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

async function seedTomorrowWord(page, request, id) {
  await seedDocument(page, request, 'records', id, {
    id, date: '2026-09-21', createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z',
    item: { ko: id, pos: '其他', meanings: [{ zh: `${id} 中文`, examples: [] }] },
  });
}

test('H02: tomorrow count is calculated on demand and recalculated after data changes', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'tomorrow@example.test');
  const button = page.locator('.home-actions button[title$="明天每日測驗的題數"]');
  await expect(button).toBeVisible();
  await seedTomorrowWord(page, request, 'tomorrow-one');
  await page.reload();
  await expect(button).toHaveText('查看明日題數');
  await expect.poll(async () => {
    await button.click();
    return button.innerText();
  }).toContain('明日 1 題');
  await page.getByRole('button', { name: '新增單字' }).click();
  const addDialog = page.getByRole('dialog');
  await addDialog.getByLabel('韓文 *').fill('새단어');
  await addDialog.getByLabel('詞性 / 類型 *').selectOption('名詞');
  await addDialog.getByLabel('中文 *').fill('新單字');
  await addDialog.getByRole('button', { name: '新增到單字庫' }).click();
  await expect(addDialog).toHaveCount(0);
  await expect(button).toHaveText(/明日 1 題/);
  await expect.poll(async () => {
    await button.click();
    return button.innerText();
  }).toContain('明日 2 題');
  assertNoProductionRequests();
});

test('H08: font size respects both bounds and survives a reload', async ({ page }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'font-scale@example.test');
  const menu = page.locator('.home-settings-menu');
  await menu.locator('summary').click();
  const smaller = menu.getByRole('button', { name: '縮小字體' });
  const larger = menu.getByRole('button', { name: '放大字體' });
  for (let index = 0; index < 10; index += 1) await larger.click();
  await expect(menu.getByText('字體 150%')).toBeVisible();
  await expect(larger).toBeDisabled();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--user-font-scale').trim())).toBe('1.5');
  await page.reload();
  await menu.locator('summary').click();
  await expect(menu.getByText('字體 150%')).toBeVisible();
  for (let index = 0; index < 14; index += 1) await smaller.click();
  await expect(menu.getByText('字體 80%')).toBeVisible();
  await expect(smaller).toBeDisabled();
  await page.reload();
  await menu.locator('summary').click();
  await expect(menu.getByText('字體 80%')).toBeVisible();
  assertNoProductionRequests();
});

async function installSpeechStub(page) {
  await page.addInitScript(() => {
    const voices = [
      { name: 'Test Korean', lang: 'ko-KR', voiceURI: 'test-ko', localService: true, default: false },
      { name: 'Test Chinese', lang: 'zh-TW', voiceURI: 'test-zh', localService: true, default: false },
    ];
    window.__speechCalls = [];
    class TestUtterance { constructor(text) { this.text = text; } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => voices,
      addEventListener: () => {},
      removeEventListener: () => {},
      cancel: () => window.__speechCalls.push({ action: 'cancel' }),
      speak: (utterance) => window.__speechCalls.push({ action: 'speak', text: utterance.text, lang: utterance.lang, voice: utterance.voice?.voiceURI }),
    } });
  });
}

async function openVoiceSettings(page) {
  const menu = page.locator('.home-settings-menu');
  await menu.locator('summary').click();
  await menu.getByRole('button', { name: '語音' }).click();
  return page.getByRole('dialog', { name: '語音設定' });
}

test('H09: voice previews use the selected language; cancel discards and save persists', async ({ page }) => {
  await installSpeechStub(page);
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'voice@example.test');
  let dialog = await openVoiceSettings(page);
  await dialog.getByRole('button', { name: '試聽 Test Korean' }).click();
  await dialog.getByRole('radio', { name: /Test Korean/ }).check();
  await expect.poll(() => page.evaluate(() => window.__speechCalls.filter((call) => call.action === 'speak'))).toEqual([
    { action: 'speak', text: '오늘도 즐겁게 한국어를 공부해요.', lang: 'ko-KR', voice: 'test-ko' },
    { action: 'speak', text: '오늘도 즐겁게 한국어를 공부해요.', lang: 'ko-KR', voice: 'test-ko' },
  ]);
  await dialog.getByRole('button', { name: '取消' }).click();
  dialog = await openVoiceSettings(page);
  await expect(dialog.locator('input[name="voice-ko"]').first()).toBeChecked();
  await dialog.getByRole('radio', { name: /Test Korean/ }).check();
  await dialog.getByRole('radio', { name: /Test Chinese/ }).check();
  await dialog.getByRole('button', { name: '試聽 Test Chinese' }).click();
  await expect.poll(() => page.evaluate(() => window.__speechCalls.filter((call) => call.action === 'speak').at(-1))).toEqual({
    action: 'speak', text: '今天也一起開心地學習韓文。', lang: 'zh-TW', voice: 'test-zh',
  });
  await dialog.getByRole('button', { name: '儲存設定' }).click();
  await page.reload();
  dialog = await openVoiceSettings(page);
  await expect(dialog.getByRole('radio', { name: /Test Korean/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /Test Chinese/ })).toBeChecked();
  assertNoProductionRequests();
});

test('H09: unsupported speech disables saving instead of pretending to play', async ({ page }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'speechSynthesis'); });
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'no-speech@example.test');
  const dialog = await openVoiceSettings(page);
  await expect(dialog.getByText('這個瀏覽器不支援網頁語音播放。')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '儲存設定' })).toBeDisabled();
  assertNoProductionRequests();
});
