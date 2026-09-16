export const FAMILIARITY_FILTER_OPTIONS = [
  { value: 'score-negative-1', label: '熟悉度 -1' },
  { value: 'score-negative-2', label: '熟悉度 -2' },
  { value: 'score-negative-3', label: '熟悉度 -3' },
  { value: 'score-negative-4-or-less', label: '熟悉度 -4 以下' },
  { value: '學習中', label: '學習中' },
  { value: '熟悉', label: '熟悉' },
  { value: '已熟悉', label: '已熟悉' },
];

export const UNFILED_FOLDER_FILTER_ID = '__unfiled__';

const koreanWordCollator = new Intl.Collator('ko-KR', {
  sensitivity: 'base',
  numeric: true,
});

export function familiarityScore(stats = {}) {
  const correct = Number(stats.correct) || 0;
  const wrong = Number.isFinite(Number(stats.wrong))
    ? Number(stats.wrong)
    : Math.max(0, (Number(stats.total) || 0) - correct);
  return correct - wrong;
}

export function familiarityLevel(score) {
  if (score < 0) return '不熟悉';
  if (score >= 5) return '已熟悉';
  if (score >= 3) return '熟悉';
  return '學習中';
}

export function familiarityFilterValue(level, score) {
  if (level !== '不熟悉') return level;
  if (score === -1) return 'score-negative-1';
  if (score === -2) return 'score-negative-2';
  if (score === -3) return 'score-negative-3';
  return 'score-negative-4-or-less';
}

export function matchesFamiliarityLevels(level, selectedLevels = [], score = 0) {
  return !selectedLevels.length || selectedLevels.includes(familiarityFilterValue(level, score));
}

export function folderFilterWordIds(folders = [], selectedFolderIds = []) {
  if (!selectedFolderIds.length) return null;
  const selected = new Set(selectedFolderIds);
  return new Set(
    folders
      .filter((folder) => selected.has(folder.id))
      .flatMap((folder) => folder.wordIds || []),
  );
}

export function filterItemsByFolderSelection(items = [], folders = [], selectedFolderIds = []) {
  if (!selectedFolderIds.length) return items;
  const selected = new Set(selectedFolderIds);
  const selectedFolderWordIds = folderFilterWordIds(
    folders,
    selectedFolderIds.filter((folderId) => folderId !== UNFILED_FOLDER_FILTER_ID),
  ) || new Set();
  const allFolderWordIds = selected.has(UNFILED_FOLDER_FILTER_ID)
    ? new Set(folders.flatMap((folder) => folder.wordIds || []))
    : null;

  return items.filter((item) => (
    selectedFolderWordIds.has(item.id)
    || (allFolderWordIds && !allFolderWordIds.has(item.id))
  ));
}

export function wordFolderIds(folders = [], wordId) {
  if (!wordId) return [];
  return folders
    .filter((folder) => (folder.wordIds || []).includes(wordId))
    .map((folder) => folder.id);
}

export function selectedFoldersFirst(folders = [], selectedFolderIds = []) {
  const selected = new Set(selectedFolderIds);
  return folders
    .map((folder, index) => ({ folder, index }))
    .sort((left, right) => (
      Number(selected.has(right.folder.id)) - Number(selected.has(left.folder.id))
      || left.index - right.index
    ))
    .map(({ folder }) => folder);
}

export function folderMembershipChanges(folders = [], wordId, desiredFolderIds = []) {
  const currentSet = new Set(wordFolderIds(folders, wordId));
  const desiredSet = new Set(desiredFolderIds);
  return {
    add: [...desiredSet].filter((folderId) => !currentSet.has(folderId)),
    remove: [...currentSet].filter((folderId) => !desiredSet.has(folderId)),
  };
}

function questionStats(store, id) {
  const stats = store?.stats?.[id] || { total: 0, correct: 0, wrong: 0 };
  const score = familiarityScore(stats);
  return { ...stats, score, level: familiarityLevel(score) };
}

export function aggregateItemStats(store, questionIds = []) {
  const stats = questionIds.map((id) => questionStats(store, id));
  const total = stats.reduce((sum, current) => sum + (current.total || 0), 0);
  const correct = stats.reduce((sum, current) => sum + (current.correct || 0), 0);
  const wrong = stats.reduce((sum, current) => (
    sum + (Number.isFinite(Number(current.wrong))
      ? Number(current.wrong)
      : Math.max(0, (current.total || 0) - (current.correct || 0)))
  ), 0);
  const score = correct - wrong;
  return { total, correct, wrong, score, level: familiarityLevel(score) };
}

export function buildWordQuestionIds(questions = []) {
  const result = new Map();
  questions.forEach((question) => {
    if (!question?.itemId) return;
    const ids = result.get(question.itemId) || [];
    ids.push(question.id);
    result.set(question.itemId, ids);
  });
  return result;
}

export function enrichWordsWithStats(items = [], questions = [], store = {}) {
  const questionIdsByWord = buildWordQuestionIds(questions);
  return items.map((item) => ({
    ...item,
    ...aggregateItemStats(store, questionIdsByWord.get(item.id) || [item.id]),
  }));
}

function normalizedSearchValue(value) {
  return String(value || '').trim().normalize('NFC').toLocaleLowerCase();
}

function itemSearchText(item) {
  return [
    item.ko,
    item.zh,
    item.pos,
    item.date,
    ...(item.notes || []),
    ...(item.meanings || []).flatMap((meaning) => [
      meaning.zh,
      meaning.pattern,
      ...(meaning.examples || []).flatMap((example) => [example.ko, example.zh]),
    ]),
    ...(item.related || []),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

export function itemMatchesSearch(item, query, scope = 'all') {
  const normalizedQuery = normalizedSearchValue(query);
  if (!normalizedQuery) return true;
  if (scope === 'word') {
    const wordAndMeanings = [
      item.ko,
      ...(item.meanings || []).map((meaning) => meaning.zh),
    ].filter(Boolean).join(' ');
    return normalizedSearchValue(wordAndMeanings).includes(normalizedQuery);
  }
  return normalizedSearchValue(itemSearchText(item)).includes(normalizedQuery);
}

export function compareItemsByKoreanAlphabet(left, right) {
  const koreanOrder = koreanWordCollator.compare(
    String(left?.ko || '').normalize('NFC'),
    String(right?.ko || '').normalize('NFC'),
  );
  if (koreanOrder) return koreanOrder;

  const chineseOrder = String(left?.zh || '').localeCompare(String(right?.zh || ''), 'zh-TW');
  if (chineseOrder) return chineseOrder;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

export function sortWordCollection(items = [], sort = 'source') {
  if (sort === 'source') return items;
  return [...items].sort((left, right) => {
    if (sort === 'alphabetical') return compareItemsByKoreanAlphabet(left, right);
    if (sort === 'score') return left.score - right.score;
    if (left.date !== right.date) return String(right.date || '').localeCompare(String(left.date || ''));
    if (left.order !== right.order) return (Number(right.order) || 0) - (Number(left.order) || 0);
    return String(left.id || '').localeCompare(String(right.id || ''));
  });
}

export function questionsForWords(questions = [], items = []) {
  const itemIds = new Set(items.map((item) => item.id));
  return questions.filter((question) => itemIds.has(question.itemId));
}

export function deriveWordCollection({
  items = [],
  questions = [],
  store = {},
  folders = [],
  query = '',
  searchScope = 'word',
  selectedLevels = [],
  selectedFolderIds = [],
  sort = 'source',
  pageNumber = 1,
  pageSize = 0,
} = {}) {
  const folderFiltered = filterItemsByFolderSelection(items, folders, selectedFolderIds);
  const enriched = enrichWordsWithStats(folderFiltered, questions, store)
    .filter((item) => itemMatchesSearch(item, query, searchScope))
    .filter((item) => matchesFamiliarityLevels(item.level, selectedLevels, item.score));
  const filteredItems = sortWordCollection(enriched, sort);
  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(filteredItems.length / pageSize)) : 1;
  const safePageNumber = Math.min(Math.max(1, pageNumber), pageCount);
  const pagedItems = pageSize > 0
    ? filteredItems.slice((safePageNumber - 1) * pageSize, safePageNumber * pageSize)
    : filteredItems;
  const assignedWordIds = new Set(folders.flatMap((folder) => folder.wordIds || []));

  return {
    filteredItems,
    pagedItems,
    filteredQuestions: questionsForWords(questions, filteredItems),
    pageCount,
    pageNumber: safePageNumber,
    totalCount: filteredItems.length,
    unfiledCount: items.filter((item) => !assignedWordIds.has(item.id)).length,
  };
}
