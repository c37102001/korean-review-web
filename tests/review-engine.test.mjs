import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareAnswer,
  dailyRoundSchedule,
  dailyWrongTermQuestions,
  dueQuestions,
  excludeLearnedQuestions,
  recordAnswer,
} from '../src/review-engine/index.js';

const question = (id, date = '2026-09-01') => ({
  id, itemId: id, kind: 'term', ko: id, zh: id, date,
});

test('review selectors and reducers load without React or Firebase', () => {
  const store = { stats: {}, progress: {}, attempts: [] };
  assert.deepEqual(dueQuestions(store, [question('가')], '2026-09-02').map(({ id }) => id), ['가']);
  const next = recordAnswer(store, question('가'), false);
  assert.equal(next.stats['가'].wrong, 1);
  assert.ok(next.progress['가'].nextDue > new Date().toISOString().slice(0, 10));
});

test('learned exclusion and daily wrong review remain independent selectors', () => {
  const questions = [question('가'), question('나')];
  assert.deepEqual(excludeLearnedQuestions(questions, ['가']).map(({ id }) => id), ['나']);
  const store = {
    attempts: [
      { questionId: '가', correct: false, date: '2026-09-16', time: '2026-09-16T01:00:00Z' },
      { questionId: '나', correct: true, date: '2026-09-16', time: '2026-09-16T02:00:00Z' },
    ],
  };
  assert.deepEqual(dailyWrongTermQuestions(store, questions, '2026-09-16').map(({ id }) => id), ['가']);
});

test('daily rounds retain wrong questions and text comparison exposes a diff', () => {
  const questions = [question('가'), question('나')];
  const schedule = dailyRoundSchedule({ attempts: [] }, questions, {
    stateKey: 'recognition', mode: 'recognition', date: '2026-09-16', limit: 2,
  });
  assert.equal(schedule.questions.length, 2);
  assert.equal(compareAnswer('안녕하새요', '안녕하세요').isCorrect, false);
  assert.ok(compareAnswer('안녕하새요', '안녕하세요').parts.some(({ type }) => type === 'replace'));
});
