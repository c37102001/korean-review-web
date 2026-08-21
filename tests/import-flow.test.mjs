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

function item(ko, zh, extra = {}) {
  return {
    ko,
    meanings: [{ zh, examples: [] }],
    related: [],
    ...extra,
  };
}

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

test('a fifth correct daily term answer offers the learned folder', () => {
  const question = {
    id: 'term-known',
    itemId: 'card-known',
    kind: 'term',
    ko: '신문',
    zh: '新聞',
  };
  const store = {
    attempts: [],
    stats: { [question.id]: { total: 6, correct: 4, wrong: 2 } },
    progress: { [question.id]: { stage: 2, nextDue: '2026-08-12' } },
  };
  assert.equal(helpers.shouldOfferLearnedFolder(store, question, true, true), true);
  assert.equal(helpers.shouldOfferLearnedFolder(store, question, true, false), false);
  assert.equal(helpers.shouldOfferLearnedFolder(store, question, false, true), false);
  assert.equal(helpers.shouldOfferLearnedFolder({
    ...store,
    stats: { [question.id]: { ...store.stats[question.id], learnedFolderPrompted: true } },
  }, question, true, true), false);
});

test('answer updates preserve the learned-folder prompt decision', () => {
  const question = { id: 'term-prompted', kind: 'term', date: '2026-08-20' };
  const store = {
    attempts: [],
    stats: { [question.id]: { total: 5, correct: 5, wrong: 0, learnedFolderPrompted: true } },
    progress: { [question.id]: { stage: 2, nextDue: '2026-08-21' } },
  };
  const next = helpers.recordAnswer(store, question, true);
  assert.equal(next.stats[question.id].learnedFolderPrompted, true);
});

test('only explicit daily review tests record accuracy results', () => {
  assert.equal(helpers.shouldRecordPracticeResults({ dailyReview: true, dueOnly: true }), true);
  assert.equal(helpers.shouldRecordPracticeResults({ dueOnly: true }), false);
  assert.equal(helpers.shouldRecordPracticeResults({ recordResults: true }), false);
  assert.equal(helpers.shouldRecordPracticeResults({}), false);
});

test('today wrong review contains only unique term questions failed on that date', () => {
  const source = { index: 0 };
  const questions = [
    { id: 'term-a', itemId: 'card-a', date: '2026-08-19', kind: 'term', source },
    { id: 'term-b', itemId: 'card-b', date: '2026-08-19', kind: 'term', source: { index: 1 } },
    { id: 'example-a', itemId: 'card-a', date: '2026-08-19', kind: 'example', source },
  ];
  const store = {
    attempts: [
      { questionId: 'term-a', correct: false, date: '2026-08-19' },
      { questionId: 'term-a', correct: false, date: '2026-08-19' },
      { questionId: 'term-b', correct: true, date: '2026-08-19' },
      { questionId: 'example-a', correct: false, date: '2026-08-19' },
      { questionId: 'term-b', correct: false, date: '2026-08-18' },
    ],
  };

  assert.deepEqual(
    helpers.dailyWrongTermQuestions(store, questions, '2026-08-19').map((question) => question.id),
    ['term-a'],
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

test('declining the learned-folder offer keeps the original review progression', () => {
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
    createdAt: '2026-07-23T01:00:00.000Z',
    updatedAt: '',
  });
  assert.equal('stats' in note, false);
  assert.equal('progress' in note, false);
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
      wordIds: ['word-1', 'word-2'],
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '',
      systemKey: '',
    },
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

test('word-only search ignores matches that appear only inside card details', () => {
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
  assert.equal(helpers.itemMatchesSearch(market, '장', 'word'), true);
  assert.equal(helpers.itemMatchesSearch(market, '장'.normalize('NFD'), 'word'), true);
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

test('study card swipes change cards only for deliberate horizontal gestures', () => {
  assert.equal(helpers.horizontalSwipeDirection({ x: 220, y: 100 }, { x: 120, y: 108 }), 'next');
  assert.equal(helpers.horizontalSwipeDirection({ x: 100, y: 100 }, { x: 180, y: 92 }), 'previous');
  assert.equal(helpers.horizontalSwipeDirection({ x: 100, y: 100 }, { x: 125, y: 220 }), '');
  assert.equal(helpers.horizontalSwipeDirection({ x: 100, y: 100 }, { x: 140, y: 102 }), '');
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

test('selected folders combine word references in folder order without duplicates', () => {
  const folders = [
    { id: 'folder-a', wordIds: ['word-1', 'word-2'] },
    { id: 'folder-b', wordIds: ['word-2', 'word-3'] },
    { id: 'folder-c', wordIds: ['word-4'] },
  ];

  assert.deepEqual(
    helpers.selectedFolderWordIds(folders, ['folder-a', 'folder-b']),
    ['word-1', 'word-2', 'word-3'],
  );
  assert.deepEqual(helpers.selectedFolderWordIds(folders, ['folder-c']), ['word-4']);
  assert.deepEqual(helpers.selectedFolderWordIds(folders, []), []);
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
