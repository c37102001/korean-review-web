import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignReadingTestsTag,
  formatReadingTestsJson,
  groupReadingTestsByTag,
  normalizeReadingTest,
  parseReadingTestsJson,
  readingTestTagLabel,
  readingTestTitle,
  UNTAGGED_READING_TEST_LABEL,
} from '../src/reading/model.js';

const readingTest = (id, tag, learned = false) => ({
  id,
  tag,
  learned,
  passage: { ko: `${id} 글`, zh: `${id} 文章` },
  question: { ko: '고르세요.', zh: '請選擇。' },
  options: [
    { id: '1', ko: '하나', zh: '一' },
    { id: '2', ko: '둘', zh: '二' },
  ],
  answer: '1',
});

test('reading test tags normalize and appear in exported JSON', () => {
  const legacy = normalizeReadingTest(readingTest('old'));
  assert.equal(legacy.tag, '');
  assert.equal(legacy.questions.length, 1);
  assert.equal(legacy.questions[0].answer, '1');
  assert.equal(normalizeReadingTest(readingTest('tagged', '  TOPIK  ')).tag, 'TOPIK');
  assert.equal(readingTestTagLabel(readingTest('old')), UNTAGGED_READING_TEST_LABEL);

  const original = readingTest('tagged', 'TOPIK');
  const exported = JSON.parse(formatReadingTestsJson([original]));
  assert.equal(exported.data[0].tag, 'TOPIK');
});

test('reading titles use persisted serial numbers that JSON cannot import or export', () => {
  const existing = normalizeReadingTest({ ...readingTest('fixed', 'TOPIK'), serialNumber: 12 });
  const document = JSON.parse(formatReadingTestsJson([existing]));
  assert.equal(document.data[0].serialNumber, undefined);
  assert.equal(document.data[0].title, undefined);

  document.data[0].serialNumber = 999;
  document.data[0].title = '任意標題';
  const [edited] = parseReadingTestsJson(JSON.stringify(document), [existing], { editingId: existing.id });
  const [created] = parseReadingTestsJson(JSON.stringify({ ...document, data: [{ ...document.data[0], id: 'new' }] }));
  assert.equal(edited.serialNumber, 12);
  assert.equal(created.serialNumber, 0);
  assert.equal(readingTestTitle(edited), '閱讀題12');
  assert.equal(readingTestTitle(created), '閱讀題');
});

test('reading test export contains only the requested public fields', () => {
  const source = [readingTest('tagged', 'TOPIK'), readingTest('untagged', '')];
  source[0].order = 42;
  source[0].serialNumber = 7;
  source[0].highlights = [{ id: 'mark', entryId: 'tagged-passage', text: 'tagged', start: 0, end: 6 }];
  source[0].createdAt = '2026-10-02T00:00:00.000Z';
  const exported = JSON.parse(formatReadingTestsJson(source));

  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.data.length, 2);
  assert.deepEqual(Object.keys(exported.data[0]), ['tag', 'passage', 'questions', 'learned']);
  assert.deepEqual(exported.data.map((entry) => entry.tag), ['TOPIK', '']);
  assert.equal(exported.data[0].passage.ko, source[0].passage.ko);
  assert.deepEqual(exported.data[0].questions, normalizeReadingTest(source[0]).questions);
});

test('reading highlights persist only while their source text and offsets remain valid', () => {
  const source = readingTest('highlighted', 'TOPIK');
  source.passage.ko = '최근 글';
  source.highlights = [
    { id: 'valid', entryId: 'highlighted-passage', text: '최근', start: 0, end: 2 },
    { id: 'stale', entryId: 'highlighted-passage', text: '이전', start: 0, end: 2 },
  ];

  const normalized = normalizeReadingTest(source);
  assert.deepEqual(normalized.highlights, [source.highlights[0]]);
  const [roundTripped] = parseReadingTestsJson(formatReadingTestsJson([normalized]), [normalized], { editingId: normalized.id });
  assert.deepEqual(roundTripped.highlights, [source.highlights[0]]);
});

test('reading tests group by tag and place learned tests last inside each group', () => {
  const groups = groupReadingTestsByTag([
    readingTest('learned-first', 'TOPIK', true),
    readingTest('active', 'TOPIK'),
    readingTest('untagged', ''),
    readingTest('travel', '旅遊'),
  ]);

  assert.deepEqual(groups.map((group) => group.label), ['旅遊', 'TOPIK', UNTAGGED_READING_TEST_LABEL]);
  const topik = groups.find((group) => group.label === 'TOPIK');
  assert.deepEqual(topik.tests.map((entry) => entry.id), ['active', 'learned-first']);
});

test('a batch of reading tests can be assigned to a new tag or left untagged', () => {
  const source = [readingTest('one', 'TOPIK'), readingTest('two', '旅遊')];
  assert.deepEqual(assignReadingTestsTag(source, '  新聞  ').map((entry) => entry.tag), ['新聞', '新聞']);
  assert.deepEqual(assignReadingTestsTag(source, '').map((entry) => entry.tag), ['', '']);
  assert.deepEqual(source.map((entry) => entry.tag), ['TOPIK', '旅遊']);
});
