import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { createServer } from 'vite';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let server;
let helpers;

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  helpers = await server.ssrLoadModule('/src/main.jsx');
});

after(async () => {
  await server?.close();
});

test('ID generation falls back when randomUUID is unavailable', () => {
  const originalCrypto = globalThis.crypto;
  const fallbackCrypto = {
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index + 1;
      return bytes;
    },
  };
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: fallbackCrypto });
  try {
    assert.match(helpers.createId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
  }
});

test('Naver dictionary links use the current Korean dictionary search route', () => {
  assert.equal(
    helpers.naverDictionaryUrl('사랑'),
    'https://korean.dict.naver.com/kozhdict/#/search?query=%EC%82%AC%EB%9E%91',
  );
});

function item(ko, zh, extra = {}) {
  return {
    ko,
    meanings: [{ zh, examples: [] }],
    related: [],
    ...extra,
  };
}

test('user-created optional tasks never write daily scores or scheduling results', () => {
  for (const optionalKind of ['words', 'listening', 'reading', 'grammar']) {
    assert.equal(helpers.shouldRecordPracticeResults({ optionalKind, dailyReview: true, allowResultRecording: true, recordResults: true }), false);
  }
});

test('replacing an existing duplicate becomes one update with no second conflict', () => {
  const existing = { id: 'existing-id', date: '2026-07-20', createdAt: '2026-07-20T00:00:00.000Z', ...item('질문', '問題') };
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [item('질문', '提問')] }), '2026-07-22');
  draft.conflict = helpers.findImportConflict(draft.entries, [existing]);

  assert.equal(draft.conflict.type, 'existing');
  const resolved = helpers.resolveImportConflictDraft(draft, 'incoming', [existing]);
  assert.equal(resolved.conflict, null);
  assert.equal(resolved.entries.length, 1);
  assert.equal(resolved.entries[0].action, 'update');

  const records = helpers.createRecordsFromImportEntries(resolved.entries, '2026-07-22', [existing], true);
  assert.equal(records.addRecords.length, 0);
  assert.equal(records.updateRecords.length, 1);
  assert.equal(records.updateRecords[0].id, existing.id);
  assert.equal(records.updateRecords[0].date, existing.date);
  assert.equal(records.updateRecords[0].item.meanings[0].zh, '提問');
  assert.ok(records.updateRecords[0].order > 0);
});

test('keeping an existing duplicate retains its id for folder assignment', () => {
  const existing = { id: 'existing-id', date: '2026-07-20', ...item('질문', '問題') };
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [item('질문', '提問')] }), '2026-07-22');
  draft.conflict = helpers.findImportConflict(draft.entries, [existing]);

  const resolved = helpers.resolveImportConflictDraft(draft, 'existing', [existing]);

  assert.deepEqual(resolved.entries, []);
  assert.deepEqual(resolved.keptExistingIds, ['existing-id']);
  assert.equal(resolved.conflict, null);
});

test('replaced existing cards follow their position in the current JSON batch', () => {
  const existing = { id: 'existing-id', date: '2026-07-22', order: 1, ...item('하나도', '舊資料') };
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [
    item('하나도', '一點都不'),
    item('직접', '親自'),
  ] }), '2026-07-22');
  draft.conflict = helpers.findImportConflict(draft.entries, [existing]);
  const resolved = helpers.resolveImportConflictDraft(draft, 'incoming', [existing]);
  const { addRecords, updateRecords } = helpers.createRecordsFromImportEntries(resolved.entries, draft.targetDate, [existing], true);

  const ordered = [...addRecords, ...updateRecords].sort((a, b) => a.order - b.order);
  assert.deepEqual(ordered.map((record) => record.item.ko), ['하나도', '직접']);
});

test('duplicate input ids are reported even when Korean words differ', () => {
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [
    item('질문', '問題', { id: 'same-id' }),
    item('대답', '回答', { id: 'same-id' }),
  ] }), '2026-07-22');
  const conflict = helpers.findImportConflict(draft.entries, []);
  assert.equal(conflict.type, 'input');
  assert.equal(conflict.reason, 'id');
});

test('Korean duplicate matching normalizes Unicode composition', () => {
  const composed = '가';
  const decomposed = composed.normalize('NFD');
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [item(composed, '一'), item(decomposed, '二')] }), '2026-07-22');
  const conflict = helpers.findImportConflict(draft.entries, []);
  assert.equal(conflict.reason, 'ko');
  assert.equal(helpers.normalizeKoreanKey(composed), helpers.normalizeKoreanKey(decomposed));
});

test('generated ids remain stable across retries and locked imports force the selected date', () => {
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [item('새롭다', '新', { date: '2026-01-01' })] }), '2026-07-22');
  const first = helpers.createRecordsFromImportEntries(draft.entries, draft.targetDate, [], true).addRecords[0];
  const retry = helpers.createRecordsFromImportEntries(draft.entries, draft.targetDate, [], true).addRecords[0];
  assert.equal(first.id, retry.id);
  assert.equal(first.date, '2026-07-22');
});

test('JSON array order is persisted as ascending record order', () => {
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [
    item('첫째', '第一'),
    item('둘째', '第二'),
    item('셋째', '第三'),
  ] }), '2026-07-22');
  const records = helpers.createRecordsFromImportEntries(draft.entries, draft.targetDate, [], true).addRecords;

  assert.deepEqual(records.map((record) => record.item.ko), ['첫째', '둘째', '셋째']);
  assert.ok(records[0].order < records[1].order);
  assert.ok(records[1].order < records[2].order);
});

test('explicit exported order is preserved when importing', () => {
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [
    item('순서', '順序', { order: 123456 }),
  ] }), '2026-07-22');
  const record = helpers.createRecordsFromImportEntries(draft.entries, draft.targetDate, [], true).addRecords[0];
  assert.equal(record.order, 123456);
});

test('Firebase date records use ascending order and a stable id fallback', () => {
  const values = [
    { id: 'third', date: '2026-07-22', order: 10 },
    { id: 'second', date: '2026-07-22', order: 20 },
    { id: 'first', date: '2026-07-22', order: 20 },
  ];
  const records = helpers.recordsFromSnapshot({
    docs: values.map((value) => ({ data: () => value })),
  });
  assert.deepEqual(records.map((record) => record.id), ['third', 'first', 'second']);
});

test('empty JSON imports are rejected before opening review', () => {
  assert.throws(() => helpers.buildJsonImportDraft('{"data":[]}', '2026-07-22'), /至少需要包含 1 筆/);
});

test('editing a replacement into another existing Korean word is rejected', () => {
  const first = { id: 'first', date: '2026-07-20', ...item('질문', '問題') };
  const second = { id: 'second', date: '2026-07-20', ...item('대답', '回答') };
  const draft = helpers.buildJsonImportDraft(JSON.stringify({ data: [item('질문', '提問')] }), '2026-07-22');
  draft.conflict = helpers.findImportConflict(draft.entries, [first, second]);
  draft.conflict.editText = JSON.stringify(item('대답', '新的回答'));
  assert.throws(() => helpers.resolveImportConflictDraft(draft, 'edit', [first, second]), /會和既有單字重複/);
});

test('daily word-example listening never adds more questions after the daily limit was answered', () => {
  const questions = Array.from({ length: 100 }, (_, index) => ({
    id: `example-${index}`,
    itemId: `card-${Math.floor(index / 4)}`,
    date: '2026-07-01',
    kind: 'example',
    ko: `例句 ${index}`,
    zh: `句子 ${index}`,
    source: { index },
  }));
  const attempts = Array.from({ length: 50 }, (_, index) => ({
    id: `attempt-${index}`,
    questionId: `example-${index}`,
    correct: true,
    date: '2026-07-22',
    time: `2026-07-22T01:${String(index).padStart(2, '0')}:00.000Z`,
    mode: 'daily-recognition',
  }));
  const store = {
    attempts,
    recognition: {
      correctIds: [],
      pendingWrongIds: [],
      roundCompletedOn: '',
      dailyDate: '2026-07-22',
      assignmentIds: Array.from({ length: 50 }, (_, index) => `example-${index + 50}`),
      answeredIds: [],
    },
  };

  const schedule = helpers.dailyRecognitionSchedule(store, questions, '2026-07-22', 50);
  assert.equal(schedule.questions.length, 0);
  assert.deepEqual(new Set(schedule.state.assignmentIds), new Set(attempts.map((attempt) => attempt.questionId)));
  const repeated = helpers.dailyRecognitionSchedule({ ...store, recognition: schedule.state }, questions, '2026-07-22', 50);
  assert.deepEqual(repeated, schedule);
});

test('daily recognition initialization runs only when the persisted date changes', () => {
  assert.equal(helpers.shouldInitializeDailyRecognition(null, '2026-07-23'), true);
  assert.equal(helpers.shouldInitializeDailyRecognition({ dailyDate: '2026-07-22' }, '2026-07-23'), true);
  assert.equal(helpers.shouldInitializeDailyRecognition({
    dailyDate: '2026-07-23',
    assignmentIds: ['stale-or-different-client-value'],
  }, '2026-07-23'), false);
});

test('grammar listening mode reveals its Chinese cue before the answer', () => {
  const listeningStart = helpers.nextRecognitionRevealState(true, false, false);
  assert.deepEqual(listeningStart, { wordVisible: true, revealed: false });
  assert.deepEqual(
    helpers.nextRecognitionRevealState(true, listeningStart.wordVisible, listeningStart.revealed),
    { wordVisible: true, revealed: true },
  );
  assert.deepEqual(
    helpers.nextRecognitionRevealState(false, true, false),
    { wordVisible: true, revealed: true },
  );
});

test('daily word-example listening replaces stale term assignments on the same day', () => {
  const questions = Array.from({ length: 60 }, (_, index) => ({
    id: `example-${index}`,
    itemId: `card-${index}`,
    date: '2026-07-01',
    kind: 'example',
    source: { index },
  }));
  const schedule = helpers.dailyRecognitionSchedule({
    attempts: [],
    recognition: {
      correctIds: ['old-term'],
      pendingWrongIds: [],
      roundCompletedOn: '',
      dailyDate: '2026-07-22',
      assignmentIds: ['old-term'],
      answeredIds: [],
    },
  }, questions, '2026-07-22', 50);
  assert.equal(schedule.questions.length, 50);
  assert.ok(schedule.questions.every((question) => question.kind === 'example'));
  assert.ok(!schedule.state.assignmentIds.includes('old-term'));
});

test('every stored word example enters the listening pool even when text is repeated', () => {
  const records = ['first', 'second'].map((id, index) => ({
    id,
    date: '2026-08-01',
    order: index,
    item: {
      ko: `단어 ${index}`,
      meanings: [{
        id: `${id}-meaning`,
        zh: `單字 ${index}`,
        examples: [{ id: `${id}-example`, ko: '같은 문장입니다.', zh: '相同的句子。' }],
      }],
      related: [],
    },
  }));
  const { questions } = helpers.normalizeRecords(records);
  const examples = questions.filter((question) => question.kind === 'example');
  assert.deepEqual(examples.map((question) => question.id), ['first-example', 'second-example']);
  assert.equal(helpers.dailyRecognitionSchedule({ attempts: [], recognition: null }, questions, '2026-08-13').questions.length, 2);
});

test('daily word-example listening wrong answers only affect tomorrow round state', () => {
  const question = {
    id: 'example-1', itemId: 'card-1', kind: 'example', ko: '문장입니다.', zh: '這是句子。', source: {},
  };
  const store = {
    attempts: [],
    stats: { untouched: { total: 1 } },
    progress: { untouched: { stage: 1 } },
    recognition: {
      correctIds: [], pendingWrongIds: [], roundCompletedOn: '', dailyDate: '2026-08-13',
      assignmentIds: [question.id], answeredIds: [],
    },
  };
  const next = helpers.recordDailyRecognitionAnswer(store, question, false);
  assert.deepEqual(next.stats, store.stats);
  assert.deepEqual(next.progress, store.progress);
  assert.equal(next.attempts[0].correct, false);
  assert.deepEqual(next.recognition.pendingWrongIds, [question.id]);
});

test('daily correct answers count for both translation directions', () => {
  const question = { id: 'daily-ko-zh', kind: 'term', date: '2026-08-20' };
  const store = {
    attempts: [],
    stats: { [question.id]: { total: 6, correct: 4, wrong: 2 } },
    progress: { [question.id]: { stage: 2, nextDue: '2026-08-24' } },
  };
  for (const direction of ['zh-ko', 'ko-zh']) {
    const next = helpers.recordDailyReviewAnswer(store, question, true, direction);
    assert.equal(next.stats[question.id].total, 7);
    assert.equal(next.stats[question.id].correct, 5);
    assert.equal(next.stats[question.id].wrong, 2);
    assert.equal(next.progress[question.id].stage, 1);
    assert.equal(next.attempts[0].correct, true);
  }
});

test('daily wrong answers count for both translation directions', () => {
  const question = { id: 'daily-ko-zh-wrong', kind: 'term', date: '2026-08-20' };
  const store = {
    attempts: [],
    stats: { [question.id]: { total: 6, correct: 4, wrong: 2 } },
    progress: { [question.id]: { stage: 3, nextDue: '2026-09-01' } },
  };
  for (const direction of ['zh-ko', 'ko-zh']) {
    const next = helpers.recordDailyReviewAnswer(store, question, false, direction);
    assert.equal(next.stats[question.id].total, 7);
    assert.equal(next.stats[question.id].correct, 4);
    assert.equal(next.stats[question.id].wrong, 3);
    assert.equal(next.progress[question.id].stage, 0);
  }
});

test('daily reviews always record while notebook and folder tests require opt-in', () => {
  assert.equal(helpers.shouldRecordPracticeResults({ dailyReview: true, dueOnly: true }), true);
  assert.equal(helpers.shouldRecordPracticeResults({ dueOnly: true }), false);
  assert.equal(helpers.shouldRecordPracticeResults({ recordResults: true }), false);
  assert.equal(helpers.shouldRecordPracticeResults({ allowResultRecording: true, recordResults: false }), false);
  assert.equal(helpers.shouldRecordPracticeResults({ allowResultRecording: true, recordResults: true }), true);
  assert.equal(helpers.shouldRecordPracticeResults({}), false);
});

test('Chinese-to-Korean supports typing and self-grading while Korean-to-Chinese is always self-graded', () => {
  assert.equal(helpers.isSelfGradeAnswerMode('zh-ko', 'typing'), false);
  assert.equal(helpers.isSelfGradeAnswerMode('zh-ko', 'self-grade'), true);
  assert.equal(helpers.isSelfGradeAnswerMode('ko-zh', 'typing'), true);
});

test('today wrong review contains only unique term questions failed on that date', () => {
  const source = { index: 0, ko: '하다' };
  const questions = [
    { id: 'term-a', itemId: 'card-a', date: '2026-08-19', kind: 'term', ko: '하다', source },
    { id: 'term-b', itemId: 'card-b', date: '2026-08-19', kind: 'term', ko: '가다', source: { index: 1, ko: '가다' } },
    { id: 'example-a', itemId: 'card-a', date: '2026-08-19', kind: 'example', source },
  ];
  const store = {
    attempts: [
      { questionId: 'term-a', correct: false, date: '2026-08-19' },
      { questionId: 'term-a', correct: false, date: '2026-08-19' },
      { questionId: 'term-b', correct: false, date: '2026-08-19' },
      { questionId: 'example-a', correct: false, date: '2026-08-19' },
      { questionId: 'term-b', correct: false, date: '2026-08-18' },
    ],
  };

  assert.deepEqual(
    helpers.dailyWrongTermQuestions(store, questions, '2026-08-19').map((question) => question.id),
    ['term-b', 'term-a'],
  );
});

test('learned words are excluded from both daily terms and example listening', () => {
  const questions = [
    { id: 'term-a', itemId: 'card-a', kind: 'term' },
    { id: 'example-a', itemId: 'card-a', kind: 'example' },
    { id: 'term-b', itemId: 'card-b', kind: 'term' },
    { id: 'example-b', itemId: 'card-b', kind: 'example' },
  ];
  assert.deepEqual(
    helpers.excludeLearnedQuestions(questions, ['card-a']).map((question) => question.id),
    ['term-b', 'example-b'],
  );
});

test('daily correct answers keep the normal review progression', () => {
  const question = { id: 'term-normal', kind: 'term' };
  const store = {
    attempts: [],
    stats: { [question.id]: { total: 5, correct: 5, wrong: 0 } },
    progress: { [question.id]: { stage: 1, nextDue: '2026-08-12' } },
  };
  const normal = helpers.recordAnswer(store, question, true);
  assert.equal(normal.progress[question.id].stage, 2);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  assert.equal(
    (Date.parse(normal.progress[question.id].nextDue) - Date.parse(normal.attempts[0].date)) / millisecondsPerDay,
    7,
  );
});

test('negative familiarity cards return tomorrow after a wrong answer', () => {
  const question = { id: 'term-negative-wrong', kind: 'term' };
  const store = {
    attempts: [],
    stats: { [question.id]: { total: 2, correct: 1, wrong: 1 } },
    progress: { [question.id]: { stage: 3, nextDue: '2026-09-20' } },
  };
  const next = helpers.recordAnswer(store, question, false);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  assert.equal(helpers.familiarityScore(next.stats[question.id]), -4);
  assert.equal(next.progress[question.id].stage, 0);
  assert.equal(
    (Date.parse(next.progress[question.id].nextDue) - Date.parse(next.attempts[0].date)) / millisecondsPerDay,
    1,
  );
});

test('negative familiarity cards rest one day after a correct answer', () => {
  const question = { id: 'term-negative-correct', kind: 'term' };
  const store = {
    attempts: [],
    stats: { [question.id]: { total: 3, correct: 1, wrong: 2 } },
    progress: { [question.id]: { stage: 4, nextDue: '2026-09-20' } },
  };
  const next = helpers.recordAnswer(store, question, true);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  assert.equal(helpers.familiarityScore(next.stats[question.id]), -3);
  assert.equal(next.progress[question.id].stage, 0);
  assert.equal(
    (Date.parse(next.progress[question.id].nextDue) - Date.parse(next.attempts[0].date)) / millisecondsPerDay,
    2,
  );
});

test('a negative card re-enters the forgetting curve after reaching zero', () => {
  const question = { id: 'term-recovered', kind: 'term' };
  const store = {
    attempts: [],
    stats: { [question.id]: { total: 6, correct: 4, wrong: 2 } },
    progress: { [question.id]: { stage: 4, nextDue: '2026-09-20' } },
  };
  const next = helpers.recordAnswer(store, question, true);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  assert.equal(helpers.familiarityScore(next.stats[question.id]), 0);
  assert.equal(next.progress[question.id].stage, 1);
  assert.equal(
    (Date.parse(next.progress[question.id].nextDue) - Date.parse(next.attempts[0].date)) / millisecondsPerDay,
    3,
  );
});

test('exhausted daily quota is not retried as a transient Firestore error', () => {
  assert.equal(helpers.isTransientFirestoreError({
    code: 'resource-exhausted',
    message: 'Quota exceeded.',
  }), false);
  assert.equal(helpers.isTransientFirestoreError({
    code: 'resource-exhausted',
    message: 'Temporarily rate limited.',
  }), true);
});

test('explicit local attempt date takes priority over the UTC timestamp date', () => {
  assert.equal(helpers.attemptDate({ date: '2026-07-23', time: '2026-07-22T23:30:00.000Z' }), '2026-07-23');
});

test('completed review dates remain append-only in local state', () => {
  const completed = helpers.markReviewDateComplete({ completedReviewDates: ['2026-07-21'] }, '2026-07-22');
  assert.deepEqual(completed.completedReviewDates, ['2026-07-21', '2026-07-22']);
});

test('daily flame requires only the word review to be complete', () => {
  assert.equal(helpers.isDailyWordReviewComplete([]), true);
  assert.equal(helpers.isDailyWordReviewComplete([{ id: 'due-term' }]), false);
});

test('grammar notes normalize searchable content without review fields', () => {
  const note = helpers.normalizeGrammarNote({
    title: '  形容詞 + 다고 느끼다  ',
    notes: '  覺得、感受到  ',
    examples: [
      { ko: ' 한국이 다르다고 느꼈어요. ', zh: ' 我覺得韓國不一樣。 ' },
      { ko: ' ', zh: '' },
    ],
    createdAt: '2026-07-23T01:00:00.000Z',
  }, 'grammar-1');

  assert.deepEqual(note, {
    id: 'grammar-1',
    title: '形容詞 + 다고 느끼다',
    notes: '覺得、感受到',
    examples: [{ id: 'grammar-1-example-0', ko: '한국이 다르다고 느꼈어요.', zh: '我覺得韓國不一樣。' }],
    category: 'grammar',
    pinned: false,
    createdAt: '2026-07-23T01:00:00.000Z',
    updatedAt: '',
  });
  assert.equal('stats' in note, false);
  assert.equal('progress' in note, false);
});

test('note categories default to grammar and preserve vocabulary notes', () => {
  assert.equal(helpers.normalizeGrammarNote({ title: '舊筆記' }, 'legacy').category, 'grammar');
  assert.equal(helpers.normalizeGrammarNote({ title: '近義詞', category: 'vocabulary' }, 'vocab').category, 'vocabulary');
  assert.equal(helpers.normalizeGrammarNote({ title: '錯誤分類', category: 'other' }, 'other').category, 'grammar');
  assert.equal(helpers.normalizeGrammarNote({ title: '置頂', pinned: true }, 'pinned').pinned, true);
});

test('folders keep unique word id references without copying word content', () => {
  assert.deepEqual(
    helpers.normalizeFolder({
      id: 'folder-1',
      name: '  交通  ',
      wordIds: ['word-1', 'word-2', 'word-1', '', null],
      createdAt: '2026-08-17T00:00:00.000Z',
    }),
    {
      id: 'folder-1',
      name: '交通',
      tag: '',
      pinned: false,
      wordIds: ['word-1', 'word-2'],
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '',
      systemKey: '',
    },
  );
});

test('folders are grouped by tag and untagged folders share a fallback group', () => {
  const groups = helpers.groupFoldersByTag([
    { id: 'one', name: '動詞', tag: 'TOPIK', wordIds: [] },
    { id: 'two', name: '名詞', tag: 'TOPIK', wordIds: [] },
    { id: 'three', name: '其他', tag: '', wordIds: [] },
  ]);

  assert.deepEqual(groups.map((group) => [group.label, group.folders.map((folder) => folder.id)]), [
    ['TOPIK', ['one', 'two']],
    ['無標籤', ['three']],
  ]);
  assert.equal(helpers.folderTagLabel({ tag: '  旅遊  ' }), '旅遊');
  assert.equal(helpers.folderTagLabel({}), '無標籤');
});

test('youtube subtitles normalize and group tags without migrating old notes', () => {
  assert.equal(helpers.normalizeYoutubeSubtitle({ title: '舊字幕' }, 'old').tag, '');
  assert.equal(helpers.normalizeYoutubeSubtitle({ title: '新字幕', tag: '  Podcast  ' }, 'new').tag, 'Podcast');

  const groups = helpers.groupYoutubeSubtitlesByTag([
    { id: 'one', title: '第一集', tag: 'Podcast' },
    { id: 'two', title: '第二集', tag: 'Podcast' },
    { id: 'three', title: '其他', tag: '' },
  ]);
  assert.deepEqual(groups.map((group) => [group.label, group.notes.map((note) => note.id)]), [
    ['Podcast', ['one', 'two']],
    ['無標籤', ['three']],
  ]);
  assert.equal(helpers.youtubeSubtitleTagLabel({ tag: '  TOPIK  ' }), 'TOPIK');
  assert.equal(helpers.youtubeSubtitleTagLabel({}), '無標籤');
});

test('folder tag selection selects the whole group and toggles it off', () => {
  assert.deepEqual(
    helpers.toggleFolderGroupSelection(['outside', 'one'], ['one', 'two']),
    ['outside', 'one', 'two'],
  );
  assert.deepEqual(
    helpers.toggleFolderGroupSelection(['outside', 'one', 'two'], ['one', 'two']),
    ['outside'],
  );
});

test('the learned folder is recognized by its fixed id, system key, or reserved name', () => {
  assert.equal(helpers.isLearnedFolder({ id: 'system-learned', name: 'Other' }), true);
  assert.equal(helpers.isLearnedFolder({ id: 'legacy-id', systemKey: 'learned', name: 'Other' }), true);
  assert.equal(helpers.isLearnedFolder({ id: 'legacy-id', name: '已學習' }), true);
  assert.equal(helpers.isLearnedFolder({ id: 'folder-1', name: '交通' }), false);
});

test('the unfamiliar folder is permanent but is not treated as learned', () => {
  assert.equal(helpers.isUnfamiliarFolder({ id: 'system-unfamiliar', name: 'Other' }), true);
  assert.equal(helpers.isUnfamiliarFolder({ id: 'legacy-id', systemKey: 'unfamiliar', name: 'Other' }), true);
  assert.equal(helpers.isUnfamiliarFolder({ id: 'legacy-id', name: '不熟悉' }), true);
  assert.equal(helpers.isLearnedFolder({ id: 'system-unfamiliar', name: '不熟悉' }), false);
  assert.equal(helpers.isSystemFolder({ id: 'system-learned' }), true);
  assert.equal(helpers.isSystemFolder({ id: 'system-unfamiliar' }), true);
  assert.equal(helpers.isSystemFolder({ id: 'folder-1', name: '交通' }), false);
});

test('grammar examples parse Korean and Chinese lines into separate examples', () => {
  const text = `오늘은 휴일이라서 회사에 안 가요.
今天是假日，所以不用去公司。

저는 학생이라서 돈이 별로 없어요.
因為我是學生，所以沒什麼錢。

주말이라서 사람이 정말 많아요.
因為是週末，所以人真的很多。`;
  const examples = helpers.parseGrammarExamplesText(text);
  assert.equal(examples.length, 3);
  assert.deepEqual(
    examples.map(({ ko, zh }) => ({ ko, zh })),
    [
      { ko: '오늘은 휴일이라서 회사에 안 가요.', zh: '今天是假日，所以不用去公司。' },
      { ko: '저는 학생이라서 돈이 별로 없어요.', zh: '因為我是學生，所以沒什麼錢。' },
      { ko: '주말이라서 사람이 정말 많아요.', zh: '因為是週末，所以人真的很多。' },
    ],
  );
  assert.equal(helpers.formatGrammarExamplesText(examples), text);
});

test('grammar example parser preserves ids and rejects an incomplete pair', () => {
  const existing = [
    { id: 'example-a', ko: '첫 문장입니다.', zh: '第一句。' },
    { id: 'example-b', ko: '둘째 문장입니다.', zh: '第二句。' },
  ];
  const edited = helpers.parseGrammarExamplesText(
    '새 문장입니다.\n新的句子。\n첫 문장입니다.\n第一句。',
    existing,
  );
  assert.equal(edited[0].id, 'example-b');
  assert.equal(edited[1].id, 'example-a');
  assert.throws(
    () => helpers.parseGrammarExamplesText('한국어 문장입니다.'),
    /第 1 個例句缺少中文翻譯/,
  );
});

test('tagged note input parses title, notes, and paired examples from one text area', () => {
  const text = `[標題]

表示過去反覆的習慣：動詞 + -곤 했다

[筆記]

用來表達「以前常常……」。
動詞詞幹 + -곤 했다\\

[例句]

어렸을 때 주말마다 할머니 댁에 가곤 했어요.\\
小時候每到週末常常會去奶奶家。

학생 때 시험 전에 밤늦게까지 공부하곤 했어요.
學生時代考試前常常會讀書讀到很晚。`;
  const parsed = helpers.parseTaggedNoteText(text);

  assert.equal(parsed.title, '表示過去反覆的習慣：動詞 + -곤 했다');
  assert.equal(parsed.notes, '用來表達「以前常常……」。\n動詞詞幹 + -곤 했다');
  assert.deepEqual(parsed.examples.map(({ ko, zh }) => ({ ko, zh })), [
    { ko: '어렸을 때 주말마다 할머니 댁에 가곤 했어요.', zh: '小時候每到週末常常會去奶奶家。' },
    { ko: '학생 때 시험 전에 밤늦게까지 공부하곤 했어요.', zh: '學生時代考試前常常會讀書讀到很晚。' },
  ]);
});

test('tagged note editor round-trips existing notes and rejects malformed sections', () => {
  const note = {
    title: '近義詞整理',
    notes: '使用時機不同。',
    examples: [{ id: 'kept-example', ko: '예문이에요.', zh: '這是例句。' }],
  };
  const parsed = helpers.parseTaggedNoteText(helpers.formatTaggedNoteText(note), note.examples);

  assert.equal(parsed.title, note.title);
  assert.equal(parsed.notes, note.notes);
  assert.equal(parsed.examples[0].id, 'kept-example');
  assert.throws(() => helpers.parseTaggedNoteText('[標題]\n只有標題'), /缺少 \[筆記\]、\[例句\] 區段/);
  assert.throws(
    () => helpers.parseTaggedNoteText('[標題]\n一\n[標題]\n二\n[筆記]\n內容\n[例句]'),
    /\[標題\] 不可以重複/,
  );
});

test('YouTube subtitle JSON parses Korean and Chinese sentence cards', () => {
  const entries = helpers.parseYoutubeSubtitleJson(JSON.stringify({
    data: [
      { ko: '안녕하세요.', zh: '你好。' },
      { ko: '반가워요.', zh: '很高興見到你。' },
    ],
  }));
  assert.deepEqual(entries.map(({ ko, zh, startMs }) => ({ ko, zh, startMs })), [
    { ko: '안녕하세요.', zh: '你好。', startMs: null },
    { ko: '반가워요.', zh: '很高興見到你。', startMs: null },
  ]);
  assert.throws(() => helpers.parseYoutubeSubtitleJson('{"data":[{"ko":"안녕하세요."}]}'), /第 1 句必須同時包含 ko 與 zh/);
});

test('SRT subtitles parse timestamps and retain matching entry ids on edit', () => {
  const source = `1
00:00:01,250 --> 00:00:03,500
안녕하세요.
你好。

2
00:00:04,000 --> 00:00:06,000
반가워요.
很高興見到你。`;
  const entries = helpers.parseYoutubeSubtitleSrt(source);
  assert.deepEqual(entries.map(({ ko, zh, startMs, endMs }) => ({ ko, zh, startMs, endMs })), [
    { ko: '안녕하세요.', zh: '你好。', startMs: 1250, endMs: 3500 },
    { ko: '반가워요.', zh: '很高興見到你。', startMs: 4000, endMs: 6000 },
  ]);
  const edited = helpers.parseYoutubeSubtitleSrt(source, [{ ...entries[0], id: 'kept-subtitle' }]);
  assert.equal(edited[0].id, 'kept-subtitle');
  assert.equal(helpers.formatYoutubeSubtitleSrt(entries), source);
});

test('YouTube links resolve standard watch, short, and embed video ids', () => {
  assert.equal(helpers.youtubeVideoId('https://www.youtube.com/watch?v=abc123'), 'abc123');
  assert.equal(helpers.youtubeVideoId('https://youtu.be/abc123?t=10'), 'abc123');
  assert.equal(helpers.youtubeVideoId('https://www.youtube.com/shorts/abc123'), 'abc123');
  assert.equal(helpers.youtubeVideoId('https://example.com/watch?v=abc123'), '');
});

test('subtitle highlights only saved words and prefers the longest overlapping word', () => {
  const matches = helpers.subtitleWordMatches('우리 사랑 얘기와 사랑 이야기', [
    { ko: '사랑', zh: '愛情' },
    { ko: '우리 사랑', zh: '我們的愛情' },
  ]);

  assert.deepEqual(matches.map(({ start, end, word }) => ({ start, end, ko: word.ko })), [
    { start: 0, end: 5, ko: '우리 사랑' },
    { start: 10, end: 12, ko: '사랑' },
  ]);
});

test('SRT playback resolves the subtitle entry at the current time', () => {
  const entries = [
    { id: 'first', startMs: 0, endMs: 1400 },
    { id: 'second', startMs: 1400, endMs: 2600 },
    { id: 'third', startMs: 2600, endMs: 4000 },
  ];

  assert.equal(helpers.subtitleEntryAtTime(entries, 0)?.id, 'first');
  assert.equal(helpers.subtitleEntryAtTime(entries, 1399)?.id, 'first');
  assert.equal(helpers.subtitleEntryAtTime(entries, 1400)?.id, 'second');
  assert.equal(helpers.subtitleEntryAtTime(entries, 4500), null);
});

test('word examples use alternating Korean and Chinese lines', () => {
  const text = `오늘은 날씨가 좋아요.
今天天氣很好。

주말에는 사람이 많아요.
週末人很多。`;
  const examples = helpers.parsePairLines(text);
  assert.deepEqual(examples, [
    { ko: '오늘은 날씨가 좋아요.', zh: '今天天氣很好。' },
    { ko: '주말에는 사람이 많아요.', zh: '週末人很多。' },
  ]);
  assert.equal(helpers.formatPairLines(examples), text);
  assert.throws(() => helpers.parsePairLines('한국어만 있어요.'), /第 1 個例句缺少中文翻譯/);
});

test('word example parser remains compatible with old pipe-separated input', () => {
  assert.deepEqual(
    helpers.parsePairLines('첫 문장입니다. | 第一句。\n두 번째 문장입니다. | 第二句。'),
    [
      { ko: '첫 문장입니다.', zh: '第一句。' },
      { ko: '두 번째 문장입니다.', zh: '第二句。' },
    ],
  );
});

test('daily grammar review continues into newly added notes before wrapping', () => {
  const grammarNotes = Array.from({ length: 13 }, (_, index) => ({
    id: `grammar-${index + 1}`,
    title: `文法 ${index + 1}`,
    notes: '',
    createdAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    examples: [
      { id: `example-${index + 1}-a`, ko: `문장 ${index + 1}가`, zh: `句子 ${index + 1}A` },
      { id: `example-${index + 1}-b`, ko: `문장 ${index + 1}나`, zh: `句子 ${index + 1}B` },
    ],
  }));
  const review = {
    lastCompletedGrammarId: 'grammar-10',
    lastCompletedCreatedAt: grammarNotes[9].createdAt,
    completedDate: '2026-07-23',
  };

  const schedule = helpers.dailyGrammarSchedule(grammarNotes, review, '2026-07-24');
  assert.equal(schedule.note.id, 'grammar-11');
  assert.deepEqual(schedule.questions.map((question) => question.zh), ['句子 11A', '句子 11B']);
  assert.ok(schedule.questions.every((question) => question.kind === 'grammar-example'));

  const wrapped = helpers.dailyGrammarSchedule(grammarNotes, {
    ...review,
    lastCompletedGrammarId: 'grammar-13',
    lastCompletedCreatedAt: grammarNotes[12].createdAt,
  }, '2026-07-24');
  assert.equal(wrapped.note.id, 'grammar-1');
});

test('daily grammar review excludes vocabulary notes', () => {
  const notes = [
    {
      id: 'vocabulary-note',
      category: 'vocabulary',
      title: '近義詞',
      createdAt: '2026-07-01T00:00:00.000Z',
      examples: [{ id: 'v-1', ko: '단어 예문', zh: '單字例句' }],
    },
    {
      id: 'grammar-note',
      category: 'grammar',
      title: '文法',
      createdAt: '2026-07-02T00:00:00.000Z',
      examples: [{ id: 'g-1', ko: '문법 예문', zh: '文法例句' }],
    },
  ];
  const schedule = helpers.dailyGrammarSchedule(notes, null, '2026-07-03');
  assert.equal(schedule.note.id, 'grammar-note');
});

test('selected grammar notes combine every complete example into one practice set', () => {
  const notes = [
    {
      id: 'grammar-a',
      title: '文法 A',
      examples: [
        { id: 'a-1', ko: '첫 문장입니다.', zh: '第一句。' },
        { id: 'a-2', ko: '둘째 문장입니다.', zh: '第二句。' },
      ],
    },
    {
      id: 'grammar-b',
      title: '文法 B',
      examples: [
        { id: 'b-1', ko: '세 번째 문장입니다.', zh: '第三句。' },
        { id: 'incomplete', ko: '한국어만', zh: '' },
      ],
    },
  ];

  const questions = helpers.grammarPracticeQuestions(notes);
  assert.deepEqual(questions.map((question) => question.id), [
    'grammar:grammar-a:a-1',
    'grammar:grammar-a:a-2',
    'grammar:grammar-b:b-1',
  ]);
  assert.ok(questions.every((question) => question.kind === 'grammar-example'));
  assert.equal(questions[2].source, notes[1]);
});

test('Korean-to-Chinese questions auto-pronounce when each prompt appears', () => {
  const base = {
    started: true,
    recognitionMode: false,
    grammarMode: false,
    recognitionWordVisible: false,
    question: { id: 'question-1', ko: '한국어' },
  };
  assert.equal(helpers.shouldAutoPronouncePracticePrompt({
    ...base,
    activeDirection: 'ko-zh',
    autoPronounce: true,
  }), true);
  assert.equal(helpers.shouldAutoPronouncePracticePrompt({
    ...base,
    activeDirection: 'ko-zh',
    autoPronounce: false,
  }), false);
  assert.equal(helpers.shouldAutoPronouncePracticePrompt({
    ...base,
    activeDirection: 'zh-ko',
    autoPronounce: true,
  }), false);
  assert.equal(helpers.shouldAutoPronouncePracticePrompt({
    ...base,
    recognitionMode: true,
    activeDirection: 'ko-zh',
    autoPronounce: false,
  }), true);
});

test('word-only search includes Korean and Chinese meanings but ignores card details', () => {
  const weather = {
    ko: '날씨',
    zh: '天氣',
    notes: ['시장附近的天氣'],
    meanings: [{
      zh: '天氣',
      examples: [{ ko: '시장에 비가 와요.', zh: '市場下雨。' }],
    }],
    related: [],
  };
  const market = {
    ko: '시장',
    zh: '市場',
    meanings: [{ zh: '市場', examples: [] }],
    related: [],
  };

  assert.equal(helpers.itemMatchesSearch(weather, '장', 'all'), true);
  assert.equal(helpers.itemMatchesSearch(weather, '장', 'word'), false);
  assert.equal(helpers.itemMatchesSearch(weather, '天氣', 'word'), true);
  assert.equal(helpers.itemMatchesSearch({ ...weather, zh: '' }, '天氣', 'word'), true);
  assert.equal(helpers.itemMatchesSearch(weather, '市場', 'word'), false);
  assert.equal(helpers.itemMatchesSearch(market, '장', 'word'), true);
  assert.equal(helpers.itemMatchesSearch(market, '장'.normalize('NFD'), 'word'), true);
});

test('Korean alphabetical sorting applies to the current filtered word set', () => {
  const filtered = [
    { id: 'three', ko: '나타나다', zh: '出現' },
    { id: 'one', ko: '가다', zh: '去' },
    { id: 'two', ko: '가르치다', zh: '教' },
  ];

  filtered.sort(helpers.compareItemsByKoreanAlphabet);

  assert.deepEqual(filtered.map((entry) => entry.ko), ['가다', '가르치다', '나타나다']);
});

test('familiarity score starts at negative three and subtracts one per wrong answer', () => {
  assert.equal(helpers.familiarityScore({}), -3);
  assert.equal(helpers.familiarityScore({ correct: 3, wrong: 1, total: 4 }), -1);
  assert.equal(helpers.familiarityScore({ correct: 1, wrong: 3, total: 4 }), -5);
  assert.equal(helpers.familiarityScore({ correct: 4, total: 5 }), 0);

  assert.equal(helpers.familiarityLevel(-1), '不熟悉');
  assert.equal(helpers.familiarityLevel(0), '學習中');
  assert.equal(helpers.familiarityLevel(2), '學習中');
  assert.equal(helpers.familiarityLevel(3), '熟悉');
  assert.equal(helpers.familiarityLevel(4), '熟悉');
  assert.equal(helpers.familiarityLevel(5), '已熟悉');
});

test('familiarity filtering supports multiple levels and precise negative scores', () => {
  const selected = ['score-negative-1', 'score-negative-3', '學習中'];
  assert.equal(helpers.matchesFamiliarityLevels('不熟悉', selected, -1), true);
  assert.equal(helpers.matchesFamiliarityLevels('不熟悉', selected, -2), false);
  assert.equal(helpers.matchesFamiliarityLevels('不熟悉', selected, -3), true);
  assert.equal(helpers.matchesFamiliarityLevels('不熟悉', selected, -4), false);
  assert.equal(helpers.matchesFamiliarityLevels('學習中', selected, 2), true);
  assert.equal(helpers.matchesFamiliarityLevels('熟悉', selected, 3), false);
  assert.equal(helpers.matchesFamiliarityLevels('已熟悉', selected, 5), false);
  assert.equal(helpers.matchesFamiliarityLevels('不熟悉', ['score-negative-4-or-less'], -4), true);
  assert.equal(helpers.matchesFamiliarityLevels('不熟悉', ['score-negative-4-or-less'], -12), true);
  assert.equal(helpers.matchesFamiliarityLevels('已熟悉', []), true);
});

test('folder filtering combines selected folders without duplicating words', () => {
  const folders = [
    { id: 'verbs', wordIds: ['one', 'shared'] },
    { id: 'topik', wordIds: ['shared', 'two'] },
    { id: 'unused', wordIds: ['three'] },
  ];

  assert.equal(helpers.folderFilterWordIds(folders, []), null);
  assert.deepEqual(
    [...helpers.folderFilterWordIds(folders, ['verbs', 'topik'])].sort(),
    ['one', 'shared', 'two'],
  );
});

test('saved speech voices resolve only within the requested language', () => {
  const voices = [
    { name: 'Natural', lang: 'en-US', voiceURI: 'english-natural' },
    { name: 'Natural', lang: 'ko-KR', voiceURI: 'korean-natural' },
    { name: 'Korean backup', lang: 'ko_KR', voiceURI: 'korean-backup' },
  ];

  assert.equal(
    helpers.findPreferredSpeechVoice(voices, { voiceURI: 'korean-natural' }, 'ko-KR'),
    voices[1],
  );
  assert.equal(
    helpers.findPreferredSpeechVoice(voices, { name: 'Korean backup', lang: 'ko-KR' }, 'ko-KR'),
    voices[2],
  );
  assert.equal(
    helpers.findPreferredSpeechVoice(voices, { name: 'Natural', lang: 'en-US' }, 'ko-KR'),
    null,
  );
  assert.equal(helpers.findPreferredSpeechVoice(voices, null, 'ko-KR'), null);
});

test('study Chinese visibility follows the global default and per-card reveal', () => {
  assert.equal(helpers.shouldShowStudyChinese(true, false), false);
  assert.equal(helpers.shouldShowStudyChinese(true, true), true);
  assert.equal(helpers.shouldShowStudyChinese(false, false), true);
  assert.equal(helpers.shouldShowStudyChinese(false, true), true);
});

test('study card double taps map its left, center, and right thirds to card actions', () => {
  assert.equal(helpers.studyCardDoubleTapAction(110, 100, 300), 'previous');
  assert.equal(helpers.studyCardDoubleTapAction(250, 100, 300), 'flip');
  assert.equal(helpers.studyCardDoubleTapAction(390, 100, 300), 'next');
  assert.equal(helpers.studyCardDoubleTapAction(250, 100, 0), '');
});

test('study autoplay follows the global Chinese visibility order', () => {
  const card = {
    ko: '날씨',
    zh: '天氣',
    meanings: [{
      zh: '天氣',
      examples: [{ ko: '오늘 날씨가 좋아요.', zh: '今天天氣很好。' }],
    }],
  };

  const hidden = helpers.buildStudyAutoPlaySpeechSequence(card, { hideChineseInitially: true });
  assert.deepEqual(hidden.map(({ text, face }) => [text, face]), [
    ['날씨', 'front'],
    ['오늘 날씨가 좋아요.', 'back'],
  ]);

  const visible = helpers.buildStudyAutoPlaySpeechSequence(card, { hideChineseInitially: false });
  assert.deepEqual(visible.map(({ text, face }) => [text, face]), [
    ['날씨', 'front'],
    ['天氣', 'back'],
    ['오늘 날씨가 좋아요.', 'back'],
    ['今天天氣很好。', 'back'],
  ]);

  const repeated = helpers.buildStudyAutoPlaySpeechSequence(card, {
    hideChineseInitially: true,
    voiceRepeatCount: 2,
  });
  assert.deepEqual(repeated.map(({ text, face }) => [text, face]), [
    ['날씨', 'front'],
    ['오늘 날씨가 좋아요.', 'back'],
    ['날씨', 'front'],
    ['오늘 날씨가 좋아요.', 'back'],
  ]);

  assert.equal(
    helpers.buildStudyAutoPlaySpeechSequence(card, { voiceRepeatCount: 99 }).length,
    hidden.length * 3,
  );
});

test('daily grammar review stays completed for the day and skips incomplete examples', () => {
  const notes = [{
    id: 'grammar-1',
    title: '測試文法',
    createdAt: '2026-07-01T00:00:00.000Z',
    examples: [
      { id: 'complete', ko: '한국어 문장', zh: '中文句子' },
      { id: 'missing-zh', ko: '한국어만', zh: '' },
    ],
  }];
  const active = helpers.dailyGrammarSchedule(notes, null, '2026-07-24');
  assert.deepEqual(active.questions.map((question) => question.id), ['grammar:grammar-1:complete']);

  const completed = helpers.dailyGrammarSchedule(notes, { completedDate: '2026-07-24' }, '2026-07-24');
  assert.equal(completed.note, null);
  assert.deepEqual(completed.questions, []);
});
