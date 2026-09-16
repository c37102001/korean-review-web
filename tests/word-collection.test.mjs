import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWordQuestionIds,
  deriveWordCollection,
  enrichWordsWithStats,
  filterItemsByFolderSelection,
  questionsForWords,
  UNFILED_FOLDER_FILTER_ID,
} from '../src/features/word-library/collection/model.js';

const items = [
  {
    id: 'word-a',
    ko: '가다',
    zh: '去',
    date: '2026-09-14',
    order: 1,
    meanings: [{ zh: '去', examples: [] }],
  },
  {
    id: 'word-b',
    ko: '나라',
    zh: '國家',
    date: '2026-09-16',
    order: 2,
    meanings: [{ zh: '國家', examples: [] }],
  },
  {
    id: 'word-c',
    ko: '다른',
    zh: '不同的',
    date: '2026-09-15',
    order: 3,
    meanings: [{ zh: '不同的', examples: [] }],
  },
];

const questions = [
  { id: 'a-term', itemId: 'word-a' },
  { id: 'a-example', itemId: 'word-a' },
  { id: 'b-term', itemId: 'word-b' },
  { id: 'c-term', itemId: 'word-c' },
];

const store = {
  stats: {
    'a-term': { total: 3, correct: 2, wrong: 1 },
    'a-example': { total: 2, correct: 0, wrong: 2 },
    'b-term': { total: 5, correct: 5, wrong: 0 },
    'c-term': { total: 2, correct: 1, wrong: 1 },
  },
};

const folders = [
  { id: 'folder-1', name: '動詞', wordIds: ['word-a'] },
  { id: 'folder-2', name: 'TOPIK', wordIds: ['word-b'] },
];

test('word question ids and stats are joined once per collection', () => {
  assert.deepEqual(buildWordQuestionIds(questions).get('word-a'), ['a-term', 'a-example']);

  const enriched = enrichWordsWithStats(items, questions, store);
  assert.deepEqual(
    enriched.map(({ id, total, correct, wrong, score, level }) => ({ id, total, correct, wrong, score, level })),
    [
      { id: 'word-a', total: 5, correct: 2, wrong: 3, score: -1, level: '不熟悉' },
      { id: 'word-b', total: 5, correct: 5, wrong: 0, score: 5, level: '已熟悉' },
      { id: 'word-c', total: 2, correct: 1, wrong: 1, score: 0, level: '學習中' },
    ],
  );
});

test('folder filters use union semantics and include unfiled words', () => {
  assert.deepEqual(
    filterItemsByFolderSelection(items, folders, ['folder-1', UNFILED_FOLDER_FILTER_ID]).map((item) => item.id),
    ['word-a', 'word-c'],
  );
});

test('one collection selector composes search, familiarity, folders, sorting and pagination', () => {
  const result = deriveWordCollection({
    items,
    questions,
    store,
    folders,
    selectedFolderIds: ['folder-1', UNFILED_FOLDER_FILTER_ID],
    selectedLevels: ['score-negative-1', '學習中'],
    sort: 'alphabetical',
    pageNumber: 2,
    pageSize: 1,
  });

  assert.deepEqual(result.filteredItems.map((item) => item.id), ['word-a', 'word-c']);
  assert.deepEqual(result.pagedItems.map((item) => item.id), ['word-c']);
  assert.deepEqual(result.filteredQuestions.map((question) => question.id), ['a-term', 'a-example', 'c-term']);
  assert.equal(result.pageCount, 2);
  assert.equal(result.unfiledCount, 1);
});

test('practice questions are derived from the same filtered word collection', () => {
  assert.deepEqual(
    questionsForWords(questions, [items[1]]).map((question) => question.id),
    ['b-term'],
  );
});
