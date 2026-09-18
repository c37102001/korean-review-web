import { expect, test } from '@playwright/test';

test('subtitle reader embeds the signed-in YouTube domain and offers a direct fallback', async ({ page }) => {
  await page.route(/youtube\.com/, (route) => route.abort());
  await page.goto('visual-fixtures.html?case=yt-reader-video');

  const iframe = page.locator('.yt-video-frame iframe');
  await expect(iframe).toHaveAttribute('src', /^https:\/\/www\.youtube\.com\/embed\/subtitle-video\?/);
  await expect(iframe).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

  const directLink = page.getByRole('link', { name: '在 YouTube 開啟影片' });
  await expect(directLink).toHaveAttribute('href', 'https://www.youtube.com/watch?v=subtitle-video');
  await expect(directLink).toHaveAttribute('target', '_blank');
  await expect(directLink).toHaveAttribute('rel', 'noopener noreferrer');
});
