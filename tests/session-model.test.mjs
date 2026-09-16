import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCollectionPracticeSession,
  createDailyReviewSession,
  createFixedWordPracticeSession,
  createGrammarPracticeSession,
  createOptionalPracticeSession,
  createStudySession,
  createWrongAnswerSession,
  PRACTICE_ORDER_POLICY,
  PRACTICE_RESULT_POLICY,
  PRACTICE_RETRY_POLICY,
  PRACTICE_SESSION_KIND,
} from '../src/features/sessions/core/sessionDefinitions.js';
import {
  buildPracticeQueue,
  practiceResultEffect,
  practiceSessionView,
  selectPracticeQuestions,
  shouldRecordPracticeResults,
} from '../src/features/sessions/practice/model.js';

const words = [
  { id: 'word-b', ko: '나무', zh: '樹', index: 1 },
  { id: 'word-a', ko: '가다', zh: '去', index: 0 },
];
const questions = [
  { id: 'example-b', itemId: 'word-b', kind: 'example', ko: '나무예요.', zh: '是樹。', date: '2026-09-16', source: words[0] },
  { id: 'term-b', itemId: 'word-b', kind: 'term', ko: '나무', zh: '樹', date: '2026-09-16', source: words[0] },
  { id: 'term-a', itemId: 'word-a', kind: 'term', ko: '가다', zh: '去', date: '2026-09-15', source: words[1] },
];

test('named session factories define persistence, ordering and retry without boolean combinations', () => {
  const daily = createDailyReviewSession(questions);
  assert.equal(daily.kind, PRACTICE_SESSION_KIND.DAILY_REVIEW);
  assert.equal(daily.policy.result, PRACTICE_RESULT_POLICY.DAILY_REVIEW);
  assert.equal(daily.policy.order, PRACTICE_ORDER_POLICY.REVIEW_SHUFFLE);
  assert.equal(daily.policy.retry, PRACTICE_RETRY_POLICY.NONE);
  assert.equal(practiceSessionView(daily).dailyWordMode, true);

  const collection = createCollectionPracticeSession(questions, '資料夾', { allowResultRecording: true });
  assert.equal(collection.policy.result, PRACTICE_RESULT_POLICY.CHOICE);
  assert.equal(collection.policy.retry, PRACTICE_RETRY_POLICY.MISTAKES);
  assert.equal(practiceSessionView(collection).canChooseResultRecording, true);

  const wrong = createWrongAnswerSession(questions);
  assert.equal(wrong.kind, PRACTICE_SESSION_KIND.DAILY_WRONG_REVIEW);
  assert.equal(wrong.policy.result, PRACTICE_RESULT_POLICY.DAILY_WRONG_REVIEW);
  assert.equal(wrong.policy.order, PRACTICE_ORDER_POLICY.ALPHABETICAL_OPTION);

  const fixed = createFixedWordPracticeSession(questions, '不熟悉');
  assert.equal(practiceSessionView(fixed).startsImmediately, true);
  assert.equal(fixed.policy.result, PRACTICE_RESULT_POLICY.NONE);
});

test('optional and grammar sessions keep their specialized reveal and completion callbacks', () => {
  const onComplete = () => {};
  const onOptionalAnswer = () => {};
  const listening = createOptionalPracticeSession(questions, '聽力', {
    optionalKind: 'listening', onComplete, onOptionalAnswer,
  });
  assert.equal(listening.kind, PRACTICE_SESSION_KIND.OPTIONAL_LISTENING);
  assert.equal(listening.policy.result, PRACTICE_RESULT_POLICY.OPTIONAL_POOL);
  assert.equal(listening.policy.reveal, 'example-listening');
  assert.equal(listening.onComplete, onComplete);
  assert.equal(listening.onOptionalAnswer, onOptionalAnswer);

  const grammar = createGrammarPracticeSession(questions, '文法');
  assert.equal(grammar.kind, PRACTICE_SESSION_KIND.GRAMMAR_EXAMPLES);
  assert.equal(grammar.policy.reveal, 'grammar-note');
  assert.equal(grammar.policy.result, PRACTICE_RESULT_POLICY.NONE);

  const study = createStudySession(words, '資料夾學習');
  assert.equal(study.kind, 'word-study');
  assert.equal(study.policy.classification, true);
});

test('question selection follows session policy and current user filters', () => {
  const collection = createCollectionPracticeSession(questions, '全部');
  assert.deepEqual(
    selectPracticeQuestions(collection, { direction: 'ko-zh' }).map((question) => question.id),
    ['term-b', 'term-a'],
  );
  assert.deepEqual(
    selectPracticeQuestions(collection, { direction: 'zh-ko', source: 'all' }).map((question) => question.id),
    ['term-a', 'term-b', 'example-b'],
  );
  assert.deepEqual(
    selectPracticeQuestions(collection, {
      direction: 'ko-zh', starredOnly: true, starredIds: ['word-a'],
    }).map((question) => question.id),
    ['term-a'],
  );

  const wrong = createWrongAnswerSession(questions);
  assert.deepEqual(
    selectPracticeQuestions(wrong).map((question) => question.id),
    ['term-a', 'example-b', 'term-b'],
  );
});

test('queue and result policies keep daily, optional and collection writes isolated', () => {
  const daily = createDailyReviewSession(questions);
  const dailyQueue = buildPracticeQueue(daily, questions, { randomOrder: false, seed: 7 });
  assert.deepEqual(dailyQueue.map((question) => question.kind), ['term', 'term', 'example']);
  assert.equal(practiceResultEffect(daily), 'daily-review');
  assert.equal(shouldRecordPracticeResults(daily), true);

  const collection = createCollectionPracticeSession(questions, '資料夾', { allowResultRecording: true });
  assert.equal(practiceResultEffect(collection, { recordResults: false }), 'none');
  assert.equal(practiceResultEffect(collection, { recordResults: true }), 'record-answer');
  assert.equal(practiceResultEffect(collection, { recordResults: true, typed: true }), 'record-answer');

  const optional = createOptionalPracticeSession(questions, '閱讀', { optionalKind: 'reading' });
  assert.equal(practiceResultEffect(optional), 'optional-pool');
  assert.equal(shouldRecordPracticeResults(optional), false);

  const wrong = createWrongAnswerSession(questions);
  assert.equal(practiceResultEffect(wrong), 'daily-wrong-review');
});
