import { expect, test } from '@playwright/test';
import {
  listDocuments,
  prepareAppPage,
  readDocument,
  register,
  resetTestData,
  seedDocument,
} from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

const jsonSource = (entries) => JSON.stringify({ data: entries });
const srtSource = (entries) => entries.map((entry, index) => [
  index + 1,
  `00:00:${String(entry.start).padStart(2, '0')},000 --> 00:00:${String(entry.end).padStart(2, '0')},000`,
  entry.ko,
  entry.zh,
].join('\n')).join('\n\n');

async function seedSubtitle(page, request, id, {
  title = '字幕筆記', tag = '', learned = false, mode = 'json', youtubeUrl = '', entries,
} = {}) {
  await seedDocument(page, request, 'ytSubtitles', id, {
    id, title, tag, learned, mode, youtubeUrl,
    entries: entries || [{ id: `${id}-entry-1`, ko: '안녕하세요.', zh: '你好。', startMs: null, endMs: null }],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
}

async function openSubtitles(page) {
  await page.getByRole('button', { name: 'YT 字幕', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'YT 字幕', exact: true })).toBeVisible();
}

const subtitleCard = (page, title) => page.locator('.yt-subtitle-note-card').filter({ hasText: title });

test('Y01 Y02: JSON and SRT subtitles persist tags, learned visibility, search, editing, validation, and deletion', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'subtitle-lifecycle@example.test');
  await openSubtitles(page);

  await page.getByRole('button', { name: '新增字幕' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('標題').fill('旅遊影片');
  await dialog.getByLabel('標籤 選填').fill('旅遊');
  await dialog.getByLabel('YouTube 連結 選填').fill('https://www.youtube.com/watch?v=abcdefghijk');
  await dialog.locator('.yt-subtitle-source').fill(jsonSource([
    { ko: '여행을 떠나요.', zh: '出發去旅行。' },
    { ko: '바다가 아름다워요.', zh: '大海很美。' },
  ]));
  await expect(dialog.locator('.subtitle-parse-success')).toContainText('可匯入 2 句');
  await dialog.getByRole('button', { name: '儲存字幕筆記' }).click();
  await expect(subtitleCard(page, '旅遊影片')).toContainText('旅遊');
  await expect(subtitleCard(page, '旅遊影片')).toContainText('2 句');
  let editedSubtitle;
  await expect.poll(async () => {
    editedSubtitle = (await listDocuments(page, request, 'ytSubtitles'))
      .find((doc) => doc.fields.title?.stringValue === '旅遊影片');
    return editedSubtitle?.name;
  }).toBeTruthy();
  const editedSubtitleId = editedSubtitle.name.split('/').at(-1);

  await page.getByRole('button', { name: '新增字幕' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('標題').fill('新聞片段');
  await dialog.getByLabel('標籤 選填').fill('新聞');
  await dialog.getByRole('checkbox', { name: '已學習' }).check();
  await dialog.getByRole('button', { name: 'SRT 時間字幕' }).click();
  await dialog.locator('.yt-subtitle-source').fill(srtSource([
    { start: 1, end: 4, ko: '오늘의 뉴스입니다.', zh: '這是今天的新聞。' },
  ]));
  await dialog.getByRole('button', { name: '儲存字幕筆記' }).click();
  await expect(subtitleCard(page, '新聞片段')).toHaveCount(0);
  await page.locator('.notebook-actions .action-menu summary').click();
  await page.getByRole('button', { name: '隱藏已學習' }).click();
  await expect(subtitleCard(page, '新聞片段')).toContainText('已學習');

  const search = page.getByPlaceholder('搜尋標題、標籤、影片連結或字幕內容');
  await search.fill('大海');
  await expect(subtitleCard(page, '旅遊影片')).toBeVisible();
  await expect(subtitleCard(page, '新聞片段')).toHaveCount(0);
  await search.fill('');
  await page.locator('.folder-tag-group').filter({ hasText: '旅遊' }).locator('.folder-tag-group-toggle').click();
  await expect(subtitleCard(page, '旅遊影片')).toHaveCount(0);
  await page.locator('.folder-tag-group').filter({ hasText: '旅遊' }).locator('.folder-tag-group-toggle').click();

  await subtitleCard(page, '旅遊影片').getByRole('button', { name: '編輯字幕筆記' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('標題').fill('旅遊韓文');
  await dialog.locator('.yt-subtitle-source').fill('{ broken');
  await expect(dialog.locator('.subtitle-parse-error')).toBeVisible();
  await dialog.getByRole('button', { name: '儲存字幕筆記' }).click();
  await expect(dialog.locator('.json-edit-error')).toBeVisible();
  expect((await listDocuments(page, request, 'ytSubtitles')).filter((doc) => !doc.fields.deletedAt)).toHaveLength(2);
  await dialog.locator('.yt-subtitle-source').fill(jsonSource([{ ko: '여행이 좋아요.', zh: '我喜歡旅行。' }]));
  await dialog.getByRole('button', { name: '儲存字幕筆記' }).click();
  await expect(subtitleCard(page, '旅遊韓文')).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await subtitleCard(page, '旅遊韓文').getByRole('button', { name: '刪除字幕筆記' }).click();
  await expect(subtitleCard(page, '旅遊韓文')).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.accept());
  await subtitleCard(page, '旅遊韓文').getByRole('button', { name: '刪除字幕筆記' }).click();
  await expect(subtitleCard(page, '旅遊韓文')).toHaveCount(0);
  await expect.poll(async () => (
    await readDocument(page, request, 'ytSubtitles', editedSubtitleId)
  )?.fields.deletedAt?.timestampValue).toBeTruthy();
  await page.reload();
  await openSubtitles(page);
  await expect(subtitleCard(page, '旅遊韓文')).toHaveCount(0);
  assertNoProductionRequests();
});

test('Y03 Y04 Y05: the stubbed player synchronizes SRT and selected text creates a highlighted word', async ({ page, request }) => {
  await page.addInitScript(() => {
    window.__ytCalls = [];
    window.__ytTime = 0;
    window.__ytState = 2;
    window.__scrollCalls = [];
    HTMLElement.prototype.scrollTo = function scrollTo(options) {
      window.__scrollCalls.push({ className: this.className, options });
      if (typeof options?.top === 'number') this.scrollTop = options.top;
    };
    window.YT = {
      Player: class Player {
        constructor(_element, options) {
          window.__ytPlayer = this;
          window.setTimeout(() => options.events.onReady(), 0);
        }
        getCurrentTime() { return window.__ytTime; }
        getPlayerState() { return window.__ytState; }
        seekTo(time) { window.__ytTime = time; window.__ytCalls.push(['seek', time]); }
        playVideo() { window.__ytState = 1; window.__ytCalls.push(['play']); }
        pauseVideo() { window.__ytState = 2; window.__ytCalls.push(['pause']); }
        destroy() {}
      },
    };
  });
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'subtitle-player@example.test');
  await seedSubtitle(page, request, 'player-note', {
    title: '播放同步', tag: '影片', mode: 'srt', youtubeUrl: 'https://youtu.be/abcdefghijk',
    entries: [
      { id: 'entry-1', ko: '첫 문장입니다.', zh: '第一句。', startMs: 0, endMs: 5000 },
      { id: 'entry-2', ko: '두 번째 문장입니다.', zh: '第二句。', startMs: 5000, endMs: 10000 },
    ],
  });
  await seedDocument(page, request, 'folders', 'yt-folder', {
    id: 'yt-folder', name: 'YT字幕', tag: 'YT字幕', wordIds: [],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await openSubtitles(page);
  await subtitleCard(page, '播放同步').click();
  await expect(page.getByRole('heading', { name: '播放同步' })).toBeVisible();
  await expect(page.getByRole('link', { name: '在 YouTube 開啟影片' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdefghijk');
  const entries = page.locator('.yt-subtitle-entry');
  const originalHeight = await entries.first().evaluate((element) => element.getBoundingClientRect().height);
  await page.getByRole('button', { name: '隱藏中文' }).click();
  await expect(entries.first().locator('p')).toHaveAttribute('aria-hidden', 'true');
  expect(await entries.first().evaluate((element) => element.getBoundingClientRect().height)).toBe(originalHeight);
  await page.getByRole('button', { name: '顯示中文' }).click();

  await entries.nth(1).click();
  await expect.poll(() => page.evaluate(() => window.__ytCalls)).toContainEqual(['seek', 5]);
  await expect(entries.nth(1)).toHaveAttribute('aria-current', 'true');
  await entries.first().focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__ytCalls)).toContainEqual(['seek', 0]);
  await page.getByRole('button', { name: '暫停影片' }).click();
  await expect.poll(() => page.evaluate(() => window.__ytCalls)).toContainEqual(['pause']);
  await page.getByRole('button', { name: '播放影片' }).click();
  await page.evaluate(() => { window.__ytTime = 6; });
  await expect(entries.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => page.evaluate(() => window.__scrollCalls.length)).toBeGreaterThan(0);

  const korean = entries.first().locator('.yt-subtitle-ko');
  await entries.first().dispatchEvent('pointerdown', { pointerType: 'mouse' });
  await expect.poll(() => page.evaluate(() => window.__ytCalls)).toContainEqual(['pause']);
  await selectText(page, korean, 0, 1);
  const dictionary = page.getByRole('link', { name: /Naver 字典查詢/ });
  await expect(dictionary).toHaveAttribute('href', /query=%EC%B2%AB/);
  await clearSelection(page);
  await expect(dictionary).toHaveCount(0);
  await entries.first().dispatchEvent('pointerdown', { pointerType: 'touch' });
  await selectText(page, korean, 0, 3);
  await expect(dictionary).toHaveAttribute('href', /query=%EC%B2%AB%20%EB%AC%B8/);
  await page.getByRole('button', { name: /畫線標記/ }).click();
  let highlight = korean.locator('.reading-text-highlight');
  await expect(highlight).toHaveText('첫 문');
  await expect.poll(async () => (
    await readDocument(page, request, 'ytSubtitles', 'player-note')
  )?.fields.highlights?.arrayValue.values.length).toBe(1);
  await page.getByRole('button', { name: '匯出劃線' }).click();
  const exportDialog = page.getByRole('dialog', { name: '匯出劃線' });
  await expect(exportDialog.locator('pre')).toHaveText('첫 문');
  await exportDialog.getByRole('button', { name: '複製' }).click();
  await expect(exportDialog.getByRole('button', { name: '已複製' })).toBeVisible();
  await exportDialog.getByRole('button', { name: '關閉' }).click();
  await page.reload();
  await openSubtitles(page);
  await subtitleCard(page, '播放同步').click();
  highlight = korean.locator('.reading-text-highlight');
  await expect(highlight).toHaveText('첫 문');
  await highlight.click();
  await page.getByRole('button', { name: /刪除.*畫線/ }).click();
  await expect.poll(async () => (
    await readDocument(page, request, 'ytSubtitles', 'player-note')
  )?.fields.highlights?.arrayValue.values?.length || 0).toBe(0);
  await selectText(page, korean, 0, 3);
  await page.getByRole('button', { name: '將選取的韓文新增為單字' }).click();
  let addDialog = page.getByRole('dialog');
  await expect(addDialog.getByLabel('韓文 *')).toHaveValue('첫 문');
  await addDialog.getByLabel('詞性 / 類型 *').selectOption('名詞');
  await addDialog.locator('.meaning-editor-card').getByLabel('中文 *').fill('第一句的開頭');
  await addDialog.getByRole('button', { name: '新增到單字庫' }).click();
  await expect(addDialog).toHaveCount(0);
  const known = korean.locator('.subtitle-known-word').filter({ hasText: '첫 문' });
  await expect(known).toBeVisible();
  await known.click();
  await expect(page.getByRole('status')).toContainText('第一句的開頭');
  await page.mouse.click(1, 1);
  await known.dblclick();
  await expect(page.getByRole('dialog')).toContainText('첫 문');
  await page.getByRole('dialog').getByRole('button', { name: '關閉' }).click();

  await page.locator('.yt-subtitle-entry-add').first().click();
  addDialog = page.getByRole('dialog');
  await expect(addDialog.getByLabel('韓文 *')).toHaveValue('첫 문장입니다.');
  await addDialog.getByRole('button', { name: '關閉' }).click();
  await page.getByRole('button', { name: '開啟資料夾「YT字幕」' }).click();
  await expect(page.getByRole('heading', { name: 'YT字幕' })).toBeVisible();
  assertNoProductionRequests();
});

test('Y03: a subtitle without a video shows its fallback and keeps sentence cards non-seekable', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'subtitle-no-video@example.test');
  await seedSubtitle(page, request, 'no-video', { title: '沒有影片' });
  await openSubtitles(page);
  await subtitleCard(page, '沒有影片').click();
  await expect(page.getByText('這篇字幕筆記沒有 YouTube 影片連結。')).toBeVisible();
  await expect(page.locator('.yt-subtitle-entry')).not.toHaveAttribute('role', 'button');
  await expect(page.getByRole('button', { name: '播放影片' })).toHaveCount(0);
  assertNoProductionRequests();
});

test('Y03: a YouTube iframe API failure is reported without blanking the reader', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await page.route('**/iframe_api', (route) => route.abort());
  await register(page, 'subtitle-player-error@example.test');
  await seedSubtitle(page, request, 'player-error', {
    title: '播放器錯誤', mode: 'srt', youtubeUrl: 'https://youtu.be/abcdefghijk',
    entries: [{ id: 'error-entry', ko: '안녕하세요.', zh: '你好。', startMs: 0, endMs: 5000 }],
  });
  await openSubtitles(page);
  await subtitleCard(page, '播放器錯誤').click();
  await expect.poll(() => page.locator('script[data-youtube-iframe-api]').count()).toBe(1);
  await page.locator('script[data-youtube-iframe-api]').evaluate((script) => script.dispatchEvent(new Event('error')));
  await expect(page.locator('.form-error')).toContainText('YouTube 播放器載入失敗');
  await expect(page.getByRole('heading', { name: '播放器錯誤' })).toBeVisible();
  await expect(page.locator('.yt-subtitle-entry')).toHaveCount(1);
  assertNoProductionRequests();
});

async function clearSelection(page) {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
}

async function selectText(page, locator, start, end) {
  await locator.evaluate((element, offsets) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let consumed = 0;
    let startNode;
    let startOffset;
    let endNode;
    let endOffset;
    while (node) {
      const next = consumed + node.textContent.length;
      if (!startNode && offsets.start >= consumed && offsets.start <= next) {
        startNode = node;
        startOffset = offsets.start - consumed;
      }
      if (offsets.end >= consumed && offsets.end <= next) {
        endNode = node;
        endOffset = offsets.end - consumed;
        break;
      }
      consumed = next;
      node = walker.nextNode();
    }
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { start, end });
}
