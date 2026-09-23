import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatReadingTestsJson,
  groupReadingTestsByTag,
  normalizeReadingTest,
  parseReadingTestsJson,
  readingTestTagLabel,
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

test('reading test tags normalize and round-trip through JSON', () => {
  assert.equal(normalizeReadingTest(readingTest('old')).tag, '');
  assert.equal(normalizeReadingTest(readingTest('tagged', '  TOPIK  ')).tag, 'TOPIK');
  assert.equal(readingTestTagLabel(readingTest('old')), UNTAGGED_READING_TEST_LABEL);

  const original = readingTest('tagged', 'TOPIK');
  const [parsed] = parseReadingTestsJson(formatReadingTestsJson([original]), [original]);
  assert.equal(parsed.tag, 'TOPIK');
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
  const [roundTripped] = parseReadingTestsJson(formatReadingTestsJson([normalized]), [normalized]);
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
