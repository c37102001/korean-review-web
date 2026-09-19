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
