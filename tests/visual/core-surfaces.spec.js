import { expect, test } from '@playwright/test';

const CASES = ['word-card', 'notebook', 'folder', 'study', 'practice', 'yt-reader', 'notes', 'reading'];
const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const fixture of CASES) {
      test(`${fixture} remains stable without Firebase`, async ({ page }) => {
        await page.addInitScript(() => {
          class FixtureUtterance {
            constructor(text) { this.text = text; }
          }
          Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FixtureUtterance });
          Object.defineProperty(window, 'speechSynthesis', {
            configurable: true,
            value: { cancel() {}, resume() {}, speak(utterance) { window.setTimeout(() => utterance.onend?.(), 0); }, getVoices() { return []; } },
          });
        });
        const remoteRequests = [];
        page.on('request', (request) => {
          if (/^https:\/\/.*(?:firestore|firebaseio|googleapis\.com\/identitytoolkit)/.test(request.url())) {
            remoteRequests.push(request.url());
          }
        });
        await page.goto(`visual-fixtures.html?case=${fixture}`);
        await page.addStyleTag({
          content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
        });
        await expect(page.locator('[data-fixture]')).toHaveAttribute('data-fixture', fixture);
        await page.waitForTimeout(250);

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        expect(remoteRequests).toEqual([]);

        const koreanHeading = page.locator('.word-card-head .speakable-heading').first();
        if (await koreanHeading.count()) {
          const box = await koreanHeading.boundingBox();
          expect(box?.width || 0).toBeGreaterThan(80);
          expect(box?.height || 0).toBeLessThan(100);

          const actionsBox = await page.locator('.word-card-head .card-actions').first().boundingBox();
          expect(actionsBox?.y || 0).toBeGreaterThanOrEqual((box?.y || 0) + (box?.height || 0) - 1);
        }

        if (fixture === 'study') {
          await page.locator('.flashcard').evaluate((element) => element.click());
          await expect(page.locator('.flashcard')).toHaveClass(/flipped/);
          await expect(page.locator('.flash-face.back')).toContainText('어쩌피');
          await page.addStyleTag({
            content: [
              '.flashcard.flipped .front { display: none !important; }',
              '.flashcard.flipped .back { transform: none !important; backface-visibility: visible !important; }',
            ].join(' '),
          });
        } else if (fixture === 'practice') {
          await page.getByRole('button', { name: '公佈答案' }).click();
          await expect(page.locator('.practice-answer-panel')).toHaveClass(/visible/);
        } else if (fixture === 'reading') {
          await page.locator('.reading-option').last().click();
          await page.getByRole('button', { name: '確認答案' }).click();
          await expect(page.locator('.reading-result')).toBeVisible();
        } else if (fixture === 'yt-reader') {
          const firstSubtitle = page.locator('.yt-subtitle-entry').first();
          const before = await firstSubtitle.boundingBox();
          await page.locator('.yt-reader-floating-button').last().click();
          const after = await firstSubtitle.boundingBox();
          expect(Math.abs((before?.height || 0) - (after?.height || 0))).toBeLessThanOrEqual(1);
        }

        await page.waitForTimeout(100);
        await expect(page).toHaveScreenshot(`${fixture}-${viewport.name}.png`, { fullPage: false });
      });
    }
  });
}
