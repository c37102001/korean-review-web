import { expect, test } from '@playwright/test';
import {
  listDocuments,
  prepareAppPage,
  readDocument,
  register,
  resetTestData,
  seedDocument,
  seedWord,
} from './helpers.js';

test.beforeEach(async ({ request }) => resetTestData(request));

const readingData = (overrides = {}) => ({
  tag: 'TOPIK',
  passage: { ko: '요즘은 물건을 빌려 쓰는 사람이 많아요.', zh: '最近很多人會租借物品使用。' },
  question: { ko: '이 글의 내용과 같은 것을 고르십시오.', zh: '請選出與文章內容相符的選項。' },
  options: [
    { id: '1', ko: '물건을 사야 합니다.', zh: '必須購買物品。' },
    { id: '2', ko: '물건을 빌려 쓸 수 있습니다.', zh: '可以租借物品使用。' },
  ],
  answer: '2', learned: false,
  ...overrides,
});

async function seedReading(page, request, id, overrides = {}) {
  await seedDocument(page, request, 'readingTests', id, {
    id, ...readingData(overrides), order: 0,
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
}

async function openReading(page) {
  await page.getByRole('button', { name: '閱讀測驗', exact: true }).click();
  await expect(page.getByRole('heading', { name: '閱讀測驗', exact: true })).toBeVisible();
}

const readingCard = (page, text) => page.locator('.reading-test-card').filter({ hasText: text });

test('R01: copy, batch import, search, collapse, edit, validation, delete, and reload preserve reading data', async ({ page, request, context }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'reading-lifecycle@example.test');
  await openReading(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.notebook-actions .action-menu summary').click();
  await page.getByRole('button', { name: '複製 JSON 格式' }).click();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).data).toHaveLength(1);

  await page.getByRole('button', { name: '匯入題目' }).click();
  let dialog = page.getByRole('dialog', { name: '匯入閱讀題' });
  const imported = [readingData(), readingData({
    tag: '',
    passage: { ko: '지하철은 편리합니다.', zh: '地鐵很方便。' },
    question: { ko: '어떤 내용입니까?', zh: '內容是什麼？' },
    options: [
      { id: '1', ko: '지하철은 불편합니다.', zh: '地鐵不方便。' },
      { id: '2', ko: '지하철은 편리합니다.', zh: '地鐵很方便。' },
    ],
  })];
  await dialog.locator('.yt-subtitle-source').fill(JSON.stringify({ schemaVersion: 1, data: imported }));
  await expect(dialog.locator('.subtitle-parse-success')).toContainText('可儲存 2 題');
  await dialog.getByRole('button', { name: '匯入 2 題' }).click();
  await expect(page.locator('.reading-test-card')).toHaveCount(2);

  const search = page.getByPlaceholder('搜尋韓文文章、題目、選項或中文翻譯');
  await search.fill('地鐵');
  await expect(readingCard(page, '지하철은 편리합니다.')).toBeVisible();
  await expect(page.locator('.reading-test-card')).toHaveCount(1);
  await search.fill('');
  await page.locator('.folder-tag-group').filter({ hasText: 'TOPIK' }).locator('.folder-tag-group-toggle').click();
  await expect(readingCard(page, '요즘은')).toHaveCount(0);
  await page.locator('.folder-tag-group').filter({ hasText: 'TOPIK' }).locator('.folder-tag-group-toggle').click();

  await readingCard(page, '요즘은').getByRole('button', { name: '編輯閱讀題' }).click();
  dialog = page.getByRole('dialog', { name: '編輯閱讀題' });
  await dialog.getByLabel('標籤 選填').fill('生活');
  const source = dialog.locator('.yt-subtitle-source');
  const parsed = JSON.parse(await source.inputValue());
  parsed.data[0].passage.zh = '最近有很多人借物品。';
  await source.fill('{ broken');
  await expect(dialog.locator('.subtitle-parse-error')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '儲存修改' })).toBeDisabled();
  await source.fill(JSON.stringify(parsed));
  await dialog.getByRole('button', { name: '儲存修改' }).click();
  await expect(page.locator('.folder-tag-group').filter({ hasText: '生活' })).toBeVisible();

  await expect.poll(async () => (
    (await listDocuments(page, request, 'readingTests'))
      .find((doc) => doc.fields.tag?.stringValue === '生活')
      ?.fields.passage.mapValue.fields.zh.stringValue
  )).toBe('最近有很多人借物品。');
  const edited = (await listDocuments(page, request, 'readingTests')).find((doc) => doc.fields.tag?.stringValue === '生活');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await readingCard(page, '요즘은').getByRole('button', { name: '刪除閱讀題' }).click();
  await expect(readingCard(page, '요즘은')).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.accept());
  await readingCard(page, '요즘은').getByRole('button', { name: '刪除閱讀題' }).click();
  await expect(readingCard(page, '요즘은')).toHaveCount(0);
  await expect.poll(async () => (await readDocument(page, request, 'readingTests', edited.name.split('/').at(-1)))?.fields.deletedAt?.timestampValue).toBeTruthy();
  await page.reload();
  await openReading(page);
  await expect(page.locator('.reading-test-card')).toHaveCount(1);
  assertNoProductionRequests();
});

test('R02: wrong and correct submissions reveal translations, lock choices, and reset cleanly', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'reading-answer@example.test');
  await seedReading(page, request, 'answer-test');
  await openReading(page);
  await page.locator('.reading-test-card').click();
  const options = page.getByRole('radiogroup', { name: '閱讀題選項' });
  await options.getByRole('radio').nth(0).check();
  await page.getByRole('button', { name: '確認答案' }).click();
  await expect(page.locator('.reading-result')).toContainText('答錯了');
  await expect(page.locator('.reading-passage')).toContainText('最近很多人會租借物品使用。');
  await expect(page.locator('.reading-question')).toContainText('請選出與文章內容相符的選項。');
  await expect(page.locator('.reading-option').nth(1)).toContainText('可以租借物品使用。');
  await expect(options.getByRole('radio').nth(1)).toBeDisabled();
  await page.getByRole('button', { name: '再做一次' }).click();
  await expect(page.locator('.reading-translation')).toHaveCount(0);
  await expect(options.getByRole('radio').nth(1)).toBeEnabled();
  await options.getByRole('radio').nth(1).check();
  await page.getByRole('button', { name: '確認答案' }).click();
  await expect(page.locator('.reading-result')).toContainText('答對了');
  assertNoProductionRequests();
});

test('R02: one passage supports multiple questions with independent options and answers', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'reading-multiple@example.test');
  await seedReading(page, request, 'multiple-test', {
    questions: [
      {
        id: 'content',
        question: { ko: '글의 내용은 무엇입니까?', zh: '文章內容是什麼？' },
        options: [{ id: '1', ko: '물건을 빌립니다.', zh: '租借物品。' }, { id: '2', ko: '물건을 버립니다.', zh: '丟棄物品。' }],
        answer: '1',
      },
      {
        id: 'benefit',
        question: { ko: '어떤 점이 좋습니까?', zh: '有什麼優點？' },
        options: [{ id: '1', ko: '비용이 늘어납니다.', zh: '費用增加。' }, { id: '2', ko: '자원을 아낍니다.', zh: '節省資源。' }],
        answer: '2',
      },
    ],
  });
  await openReading(page);
  await page.locator('.reading-test-card').click();

  const groups = page.getByRole('radiogroup');
  await expect(groups).toHaveCount(2);
  const submit = page.getByRole('button', { name: '確認答案' });
  await groups.nth(0).getByRole('radio').nth(0).check();
  await expect(submit).toBeDisabled();
  await groups.nth(1).getByRole('radio').nth(0).check();
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.locator('.reading-result')).toContainText('答對 1 / 2 題');
  await expect(page.locator('.reading-question').nth(0)).toContainText('文章內容是什麼？');
  await expect(page.locator('.reading-question').nth(1)).toContainText('有什麼優點？');
  await expect(page.locator('.reading-option.correct')).toHaveCount(2);
  await expect(page.locator('.reading-option.incorrect')).toHaveCount(1);
  assertNoProductionRequests();
});

test('R03: learned state, editing, folder navigation, delete cancellation, and confirmed deletion persist', async ({ page, request }) => {
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'reading-state@example.test');
  await seedReading(page, request, 'state-test');
  await seedDocument(page, request, 'folders', 'reading-folder', {
    id: 'reading-folder', name: '閱讀測驗', tag: '閱讀測驗', wordIds: [],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await openReading(page);
  await page.locator('.reading-test-card').click();
  await page.getByRole('button', { name: '已學習' }).click();
  await expect.poll(async () => (await readDocument(page, request, 'readingTests', 'state-test'))?.fields.learned?.booleanValue).toBe(true);
  await page.getByRole('button', { name: '編輯' }).click();
  const dialog = page.getByRole('dialog', { name: '編輯閱讀題' });
  await dialog.getByLabel('標籤 選填').fill('已完成');
  await dialog.getByRole('button', { name: '儲存修改' }).click();
  await expect.poll(async () => (await readDocument(page, request, 'readingTests', 'state-test'))?.fields.tag?.stringValue).toBe('已完成');
  await page.getByRole('button', { name: '開啟資料夾「閱讀測驗」' }).click();
  await expect(page.getByRole('heading', { name: '閱讀測驗' })).toBeVisible();
  await page.getByRole('button', { name: '閱讀測驗', exact: true }).click();
  await page.locator('.reading-test-card').click();
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.getByRole('button', { name: '刪除' }).click();
  await expect(page.getByRole('heading', { name: '閱讀題' })).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('button', { name: '刪除' }).click();
  await expect(page.getByRole('heading', { name: '閱讀測驗', exact: true })).toBeVisible();
  await expect.poll(async () => (await readDocument(page, request, 'readingTests', 'state-test'))?.fields.deletedAt?.timestampValue).toBeTruthy();
  assertNoProductionRequests();
});

test('R04: selected text opens Naver, highlights persist and export, and saved words expose details', async ({ page, request, context }) => {
  page.on('pageerror', (error) => { throw error; });
  const assertNoProductionRequests = await prepareAppPage(page);
  await register(page, 'reading-selection@example.test');
  await seedReading(page, request, 'selection-test');
  await seedWord(page, request, 'known-word', '물건', '物品');
  await seedDocument(page, request, 'folders', 'reading-folder', {
    id: 'reading-folder', name: '閱讀測驗', tag: '閱讀測驗', wordIds: ['known-word'],
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  });
  await openReading(page);
  await page.locator('.reading-test-card').click();
  const passage = page.locator('.reading-passage [data-selectable-entry-id]');
  let known = passage.locator('.subtitle-known-word').first();
  await known.click();
  let wordDialog = page.getByRole('dialog', { name: '符合 1 張單字卡' });
  await expect(wordDialog).toContainText('物品');
  await wordDialog.getByRole('button', { name: '編輯單字' }).click();
  let editDialog = page.getByRole('dialog');
  await editDialog.locator('.meaning-editor-card').getByLabel('中文 *').fill('物品、東西');
  await editDialog.getByRole('button', { name: '儲存修改' }).click();
  await expect.poll(async () => (
    await readDocument(page, request, 'records', 'known-word')
  )?.fields.item.mapValue.fields.meanings.arrayValue.values[0].mapValue.fields.zh.stringValue).toBe('物品、東西');

  known = passage.locator('.subtitle-known-word').first();
  await expect(known).toBeVisible();
  await known.click();
  wordDialog = page.getByRole('dialog', { name: '符合 1 張單字卡' });
  await expect(wordDialog).toContainText('物品、東西');
  page.once('dialog', (confirmation) => confirmation.accept());
  await wordDialog.locator('.delete-icon-button').click();
  await expect(known).toHaveCount(0);
  await expect.poll(async () => (
    await readDocument(page, request, 'records', 'known-word')
  )?.fields.deletedAt?.timestampValue).toBeTruthy();

  await selectText(page, passage, 0, 2);
  const dictionary = page.getByRole('link', { name: /Naver 字典查詢/ });
  await expect(dictionary).toHaveAttribute('href', /query=%EC%9A%94%EC%A6%98/);
  await expect(dictionary).toHaveAttribute('target', '_blank');
  await page.getByRole('button', { name: /畫線標記/ }).click();
  let highlight = passage.locator('.reading-text-highlight');
  await expect(highlight).toHaveText('요즘');
  await expect.poll(async () => (
    await readDocument(page, request, 'readingTests', 'selection-test')
  )?.fields.highlights?.arrayValue.values.length).toBe(1);
  await page.getByRole('button', { name: '匯出劃線' }).click();
  const exportDialog = page.getByRole('dialog', { name: '匯出劃線' });
  await expect(exportDialog.locator('.highlight-export-item')).toContainText('요즘');
  await expect(exportDialog.locator('.highlight-export-item')).toContainText('요즘은 물건을 빌려 쓰는 사람이 많아요.');
  await exportDialog.getByRole('button', { name: '複製' }).click();
  await expect(exportDialog.getByRole('button', { name: '已複製' })).toBeVisible();
  await exportDialog.getByRole('button', { name: '刪除所有劃線' }).click();
  await expect(exportDialog.locator('.highlight-export-item')).toHaveCount(0);
  await expect.poll(async () => (
    await readDocument(page, request, 'readingTests', 'selection-test')
  )?.fields.highlights?.arrayValue.values?.length || 0).toBe(0);
  await exportDialog.getByRole('button', { name: '關閉' }).click();
  await selectText(page, passage, 0, 2);
  await page.getByRole('button', { name: /畫線標記/ }).click();
  await expect.poll(async () => (
    await readDocument(page, request, 'readingTests', 'selection-test')
  )?.fields.highlights?.arrayValue.values?.length || 0).toBe(1);
  await page.reload();
  await openReading(page);
  await page.locator('.reading-test-card').click();
  const reloadedPassage = page.locator('.reading-passage [data-selectable-entry-id]');
  highlight = reloadedPassage.locator('.reading-text-highlight');
  await expect(highlight).toHaveText('요즘');
  await highlight.click();
  await page.getByRole('button', { name: '將選取的韓文新增為單字' }).click();
  const addDialog = page.getByRole('dialog');
  await expect(addDialog.getByLabel('韓文 *')).toHaveValue('요즘');
  await addDialog.getByLabel('詞性 / 類型 *').selectOption('副詞');
  await addDialog.locator('.meaning-editor-card').getByLabel('中文 *').fill('最近');
  await addDialog.getByRole('button', { name: '新增到單字庫' }).click();
  await expect(addDialog).toHaveCount(0);
  await expect(highlight).toHaveCount(0);
  await expect.poll(async () => (
    await readDocument(page, request, 'readingTests', 'selection-test')
  )?.fields.highlights?.arrayValue.values?.length || 0).toBe(0);
  await expect.poll(async () => (
    (await listDocuments(page, request, 'records')).filter((doc) => !doc.fields.deletedAt).length
  )).toBe(1);
  await expect(reloadedPassage.locator('.subtitle-known-word').filter({ hasText: '요즘' })).toBeVisible();
  await expect.poll(async () => (
    (await readDocument(page, request, 'folders', 'reading-folder'))?.fields.wordIds.arrayValue.values.length
  )).toBe(1);
  assertNoProductionRequests();
});

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
