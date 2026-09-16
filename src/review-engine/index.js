import {
  aggregateItemStats,
  compareItemsByKoreanAlphabet,
  familiarityLevel,
  familiarityScore,
} from '../features/word-library/collection/model.js';
import { PRACTICE_SESSION_KIND } from '../features/sessions/core/sessionDefinitions.js';
import { orderReviewQuestions, shuffleItems } from '../features/sessions/practice/model.js';
import { grammarPracticeQuestions, NOTE_CATEGORY_VOCABULARY } from '../notes/model.js';
import { addDays, todayString } from '../shared/date.js';
import { createId } from '../shared/id.js';
import { nextReviewTransition, REVIEW_INTERVALS } from './rules.js';
import { attemptDate } from './store.js';

const DAILY_RECOGNITION_LIMIT = 50;
const DAILY_RECOGNITION_MODE = PRACTICE_SESSION_KIND.DAILY_RECOGNITION;
const DAILY_WRONG_REVIEW_MODE = 'daily-wrong-review';
const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/gu;

export function compareQuestionsByKoreanAlphabet(left, right) {
  return compareItemsByKoreanAlphabet(
    left?.source || left,
    right?.source || right,
  ) || String(left?.id || '').localeCompare(String(right?.id || ''));
}
export function getStats(store, id) {
  const stats = store.stats[id] || { total: 0, correct: 0, wrong: 0 };
  const score = familiarityScore(stats);
  return { ...stats, score, level: familiarityLevel(score) };
}

export function rankTermQuestionsByFamiliarity(store, questions = []) {
  const questionIdsByItem = new Map();
  questions.forEach((question) => {
    if (!question?.itemId) return;
    const ids = questionIdsByItem.get(question.itemId) || [];
    ids.push(question.id);
    questionIdsByItem.set(question.itemId, ids);
  });
  const seenItems = new Set();
  return questions
    .filter((question) => {
      if (question.kind !== 'term' || seenItems.has(question.itemId)) return false;
      seenItems.add(question.itemId);
      return true;
    })
    .map((question) => ({
      question,
      score: aggregateItemStats(store, questionIdsByItem.get(question.itemId) || [question.id]).score,
    }))
    .sort((left, right) => (
      left.score - right.score
      || compareQuestionsByKoreanAlphabet(left.question, right.question)
    ));
}

export function lowestFamiliarityTermQuestions(store, questions = [], limit = 30) {
  return rankTermQuestionsByFamiliarity(store, questions)
    .slice(0, Math.max(0, limit))
    .map(({ question }) => question);
}

export function unfamiliarTermQuestionCount(store, questions = []) {
  return rankTermQuestionsByFamiliarity(store, questions)
    .filter(({ score }) => score < 0)
    .length;
}

export function getProgress(store, question) {
  const saved = store.progress[question.id];
  if (saved) return saved;
  return {
    stage: 0,
    nextDue: addDays(question.date, REVIEW_INTERVALS[0]),
    lastResult: null,
    lastAnsweredAt: null,
  };
}

export function dueQuestions(store, questions, date = todayString()) {
  return questions.filter((question) => getProgress(store, question).nextDue <= date);
}

export function reviewQuestions(questions) {
  return orderReviewQuestions(questions.filter((question) => question.kind === 'term' || question.kind === 'example'));
}

export function folderWordIdsInclude(wordIds, itemId) {
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) return false;
  if (wordIds instanceof Set) return wordIds.has(normalizedItemId);
  return Array.isArray(wordIds) && wordIds.some((wordId) => String(wordId || '').trim() === normalizedItemId);
}

export function excludeLearnedQuestions(questions, learnedWordIds = []) {
  return questions.filter((question) => !folderWordIdsInclude(learnedWordIds, question.itemId));
}

export function dailyReviewQuestions(store, questions, date = todayString()) {
  const terms = questions.filter((question) => question.kind === 'term');
  return orderReviewQuestions(dueQuestions(store, terms, date));
}

export function dailyWrongTermQuestions(store, questions, date = todayString()) {
  const termById = new Map(
    questions
      .filter((question) => question.kind === 'term')
      .map((question) => [question.id, question]),
  );
  const wrongIds = new Set();
  [...(store.attempts || [])]
    .filter((attempt) => attemptDate(attempt) === date)
    .sort((left, right) => String(left.time || '').localeCompare(String(right.time || '')))
    .forEach((attempt) => {
      const questionId = String(attempt.questionId || '');
      if (!questionId) return;
      if (attempt.mode === DAILY_WRONG_REVIEW_MODE) {
        if (attempt.correct) wrongIds.delete(questionId);
        else wrongIds.add(questionId);
        return;
      }
      if (attempt.correct === false) wrongIds.add(questionId);
    });
  return [...wrongIds]
    .map((questionId) => termById.get(questionId))
    .filter(Boolean)
    .sort(compareQuestionsByKoreanAlphabet);
}

export function seedFromString(text) {
  return [...text].reduce((seed, char) => ((seed * 31) + char.charCodeAt(0)) % 233280, 17);
}

export function replayRoundAttempts(attempts, questionIds) {
  const correctIds = new Set();
  const pendingWrongIds = new Set();
  let roundCompletedOn = '';
  [...attempts].sort((a, b) => (a.time || '').localeCompare(b.time || '')).forEach((attempt) => {
    if (!questionIds.has(attempt.questionId)) return;
    if (attempt.correct) {
      correctIds.add(attempt.questionId);
      pendingWrongIds.delete(attempt.questionId);
    } else {
      correctIds.delete(attempt.questionId);
      pendingWrongIds.add(attempt.questionId);
    }
    if (correctIds.size === questionIds.size) roundCompletedOn = attemptDate(attempt);
  });
  return { correctIds, pendingWrongIds, roundCompletedOn };
}

export function dailyRoundSchedule(store, questions, {
  stateKey,
  mode,
  date = todayString(),
  limit,
}) {
  if (!questions.length) return { state: null, questions: [] };
  const questionIds = new Set(questions.map((question) => question.id));
  const roundAttempts = (store.attempts || [])
    .filter((attempt) => attempt.mode === mode && questionIds.has(attempt.questionId));
  let state = store[stateKey];
  if (!state) {
    const previous = replayRoundAttempts(
      roundAttempts.filter((attempt) => attemptDate(attempt) < date),
      questionIds,
    );
    state = {
      correctIds: [...previous.correctIds],
      pendingWrongIds: [...previous.pendingWrongIds],
      roundCompletedOn: previous.roundCompletedOn,
      dailyDate: '',
      assignmentIds: [],
      answeredIds: [],
    };
  }

  let correctIds = new Set((state.correctIds || []).filter((id) => questionIds.has(id)));
  let pendingWrongIds = new Set((state.pendingWrongIds || []).filter((id) => questionIds.has(id)));
  let roundCompletedOn = state.roundCompletedOn || '';
  if (correctIds.size === questionIds.size && !roundCompletedOn) roundCompletedOn = state.dailyDate || date;
  if (state.dailyDate !== date && roundCompletedOn && roundCompletedOn < date) {
    correctIds = new Set();
    pendingWrongIds = new Set();
    roundCompletedOn = '';
  }

  const attemptsToday = roundAttempts
    .filter((attempt) => attemptDate(attempt) === date)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const attemptedIds = [...new Set(attemptsToday.map((attempt) => attempt.questionId))];
  let assignmentIds = (state.assignmentIds || []).filter((id) => questionIds.has(id));
  if (state.dailyDate !== date || (!assignmentIds.length && !attemptedIds.length)) {
    const wrong = shuffleItems(
      questions.filter((question) => pendingWrongIds.has(question.id)),
      seedFromString(`${date}-${mode}-wrong`),
    ).slice(0, limit);
    const wrongIds = new Set(wrong.map((question) => question.id));
    const unseen = questions.filter((question) => !correctIds.has(question.id) && !wrongIds.has(question.id));
    assignmentIds = shuffleItems([
      ...wrong,
      ...shuffleItems(unseen, seedFromString(`${date}-${mode}-unseen`)).slice(0, Math.max(0, limit - wrong.length)),
    ], seedFromString(`${date}-${mode}-assignment`)).map((question) => question.id);
  }
  // Today's attempt log is authoritative. It prevents a stale settings
  // snapshot from replacing the assignment and creating more than the daily limit.
  const assignmentLimit = Math.max(limit, attemptedIds.length);
  assignmentIds = [
    ...attemptedIds,
    ...assignmentIds.filter((id) => !attemptedIds.includes(id)),
  ].slice(0, assignmentLimit);
  const answeredIds = new Set(attemptedIds);
  attemptsToday.forEach((attempt) => {
    if (attempt.correct) {
      correctIds.add(attempt.questionId);
      pendingWrongIds.delete(attempt.questionId);
    } else {
      correctIds.delete(attempt.questionId);
      pendingWrongIds.add(attempt.questionId);
    }
  });
  if (correctIds.size === questionIds.size) roundCompletedOn = date;

  const nextState = {
    correctIds: [...correctIds].sort(),
    pendingWrongIds: [...pendingWrongIds].sort(),
    roundCompletedOn,
    dailyDate: date,
    assignmentIds,
    answeredIds: [...answeredIds],
  };
  const byId = new Map(questions.map((question) => [question.id, question]));
  return {
    state: nextState,
    questions: assignmentIds.filter((id) => !answeredIds.has(id)).map((id) => byId.get(id)).filter(Boolean),
  };
}

export function dailyRecognitionSchedule(store, questions, date = todayString(), limit = DAILY_RECOGNITION_LIMIT) {
  const examples = orderReviewQuestions(questions.filter((question) => question.kind === 'example'));
  return dailyRoundSchedule(store, examples, {
    stateKey: 'recognition',
    mode: DAILY_RECOGNITION_MODE,
    date,
    limit,
  });
}

export function shouldInitializeDailyRecognition(recognition, date = todayString()) {
  return !recognition || recognition.dailyDate !== date;
}

export function nextRecognitionRevealState(listeningMode, wordVisible, revealed) {
  if (revealed) return { wordVisible: true, revealed: true };
  if (listeningMode && !wordVisible) return { wordVisible: true, revealed: false };
  return { wordVisible: true, revealed: true };
}

export function dailyGrammarSchedule(notes, review, date = todayString()) {
  if (review?.completedDate === date) return { note: null, questions: [] };
  const eligible = notes
    .filter((note) => note.category !== NOTE_CATEGORY_VOCABULARY)
    .map((note) => ({
      ...note,
      examples: (note.examples || []).filter((example) => example.ko && example.zh),
    }))
    .filter((note) => note.examples.length)
    .sort((a, b) => (
      (a.createdAt || '').localeCompare(b.createdAt || '')
      || a.id.localeCompare(b.id)
    ));
  if (!eligible.length) return { note: null, questions: [] };

  const lastIndex = eligible.findIndex((note) => note.id === review?.lastCompletedGrammarId);
  let note;
  if (lastIndex >= 0) {
    note = eligible[(lastIndex + 1) % eligible.length];
  } else if (review?.lastCompletedCreatedAt) {
    note = eligible.find((candidate) => candidate.createdAt > review.lastCompletedCreatedAt) || eligible[0];
  } else {
    note = eligible[0];
  }

  return {
    note,
    questions: grammarPracticeQuestions([note]),
  };
}

export function groupTasks(store, questions, date = todayString()) {
  const groups = new Map();
  questions.forEach((question) => {
    const progress = getProgress(store, question);
    const dueDate = progress.nextDue;
    const key = `${question.date}-${dueDate}`;
    const existing = groups.get(key) || {
      id: key,
      studyDate: question.date,
      dueDate,
      questions: [],
      overdue: dueDate < date,
    };
    existing.questions.push(question);
    existing.overdue = existing.overdue || dueDate < date;
    groups.set(key, existing);
  });
  return [...groups.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function markReviewDateComplete(store, date = todayString()) {
  const completedReviewDates = store.completedReviewDates || [];
  if (completedReviewDates.includes(date)) return store;
  return {
    ...store,
    completedReviewDates: [...completedReviewDates, date].sort(),
  };
}

export function isDailyWordReviewComplete(dueWordQuestions = []) {
  return dueWordQuestions.length === 0;
}

export function toggleStarredItem(updateStore, itemId) {
  updateStore((current) => {
    const starred = current.starred || [];
    const nextStarred = starred.includes(itemId)
      ? starred.filter((id) => id !== itemId)
      : [...starred, itemId];
    return { ...current, starred: nextStarred };
  });
}

export function calculateReviewStreaks(completedReviewDates, today = todayString()) {
  const completed = new Set(completedReviewDates || []);
  const countBackFrom = (startDate) => {
    let count = 0;
    let cursor = startDate;
    while (completed.has(cursor)) {
      count += 1;
      cursor = addDays(cursor, -1);
    }
    return count;
  };

  const current = completed.has(today) ? countBackFrom(today) : countBackFrom(addDays(today, -1));
  const sortedDates = [...completed].sort();
  let best = 0;
  let run = 0;
  let previous = '';
  sortedDates.forEach((date) => {
    run = previous && addDays(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  });
  return { current, best };
}

export function recordAnswer(store, question, correct) {
  const now = new Date().toISOString();
  const answerDate = todayString();
  const previous = getProgress(store, question);
  const previousStats = store.stats[question.id] || {};
  const nextStats = {
    ...previousStats,
    total: (previousStats.total || 0) + 1,
    correct: (previousStats.correct || 0) + (correct ? 1 : 0),
    wrong: (previousStats.wrong || 0) + (correct ? 0 : 1),
    lastAnsweredAt: now,
    lastResult: correct ? 'correct' : 'wrong',
  };
  const { stage, intervalDays } = nextReviewTransition({
    previousStage: previous.stage,
    previousStats,
    nextStats,
    correct,
  });
  return {
    ...store,
    stats: {
      ...store.stats,
      [question.id]: nextStats,
    },
    progress: {
      ...store.progress,
      [question.id]: {
        stage,
        nextDue: addDays(answerDate, intervalDays),
        lastAnsweredAt: now,
        lastResult: correct ? 'correct' : 'wrong',
      },
    },
    attempts: [{ id: createId(), questionId: question.id, correct, date: answerDate, time: now }, ...store.attempts].slice(0, 5000),
  };
}

export function recordDailyReviewAnswer(store, question, correct, direction = 'zh-ko') {
  return recordAnswer(store, question, correct);
}

export function recordDailyWrongReviewAnswer(store, question, correct) {
  const now = new Date().toISOString();
  return {
    ...store,
    attempts: [{
      id: createId(),
      questionId: question.id,
      correct,
      date: todayString(),
      time: now,
      mode: DAILY_WRONG_REVIEW_MODE,
    }, ...(store.attempts || [])].slice(0, 5000),
  };
}

export function recordDailyRoundAnswer(store, question, correct, {
  stateKey,
  mode,
  recordWrongStats = false,
}) {
  const round = store[stateKey] || {
    correctIds: [], pendingWrongIds: [], roundCompletedOn: '', dailyDate: todayString(), assignmentIds: [], answeredIds: [],
  };
  const correctIds = new Set(round.correctIds || []);
  const pendingWrongIds = new Set(round.pendingWrongIds || []);
  if (correct) {
    correctIds.add(question.id);
    pendingWrongIds.delete(question.id);
  } else {
    correctIds.delete(question.id);
    pendingWrongIds.add(question.id);
  }
  const nextRound = {
    ...round,
    correctIds: [...correctIds].sort(),
    pendingWrongIds: [...pendingWrongIds].sort(),
    answeredIds: [...new Set([...(round.answeredIds || []), question.id])],
  };
  if (!correct && recordWrongStats) {
    const next = recordAnswer(store, question, false);
    return {
      ...next,
      [stateKey]: nextRound,
      attempts: next.attempts.map((attempt, index) => (
        index === 0 ? { ...attempt, mode } : attempt
      )),
    };
  }
  const now = new Date().toISOString();
  return {
    ...store,
    [stateKey]: nextRound,
    attempts: [{
      id: createId(),
      questionId: question.id,
      correct,
      date: todayString(),
      time: now,
      mode,
    }, ...store.attempts].slice(0, 5000),
  };
}

export function recordDailyRecognitionAnswer(store, question, correct) {
  return recordDailyRoundAnswer(store, question, correct, {
    stateKey: 'recognition',
    mode: DAILY_RECOGNITION_MODE,
  });
}

export function normalizeAnswer(text) {
  return [...text.replace(PUNCTUATION_RE, '')];
}

export function countKoreanLetters(text) {
  return [...text].filter((char) => /\p{Script=Hangul}/u.test(char)).length;
}

export function compareAnswer(input, answer) {
  const user = normalizeAnswer(input.trim());
  const correct = normalizeAnswer(answer.trim());
  const dp = Array.from({ length: correct.length + 1 }, () => Array(user.length + 1).fill(0));
  for (let i = correct.length; i >= 0; i -= 1) {
    for (let j = user.length; j >= 0; j -= 1) {
      if (i === correct.length) {
        dp[i][j] = user.length - j;
      } else if (j === user.length) {
        dp[i][j] = correct.length - i;
      } else if (correct[i] === user[j]) {
        dp[i][j] = dp[i + 1][j + 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i + 1][j + 1],
          dp[i][j + 1],
          dp[i + 1][j],
        );
      }
    }
  }
  const parts = [];
  let i = 0;
  let j = 0;
  while (i < correct.length || j < user.length) {
    if (i < correct.length && j < user.length && correct[i] === user[j]) {
      parts.push({ type: 'ok', text: correct[i] });
      i += 1;
      j += 1;
    } else if (i < correct.length && j < user.length && dp[i][j] === 1 + dp[i + 1][j + 1]) {
      parts.push({ type: 'replace', text: user[j], expected: correct[i] });
      i += 1;
      j += 1;
    } else if (j < user.length && (i === correct.length || dp[i][j] === 1 + dp[i][j + 1])) {
      parts.push({ type: user[j] === ' ' ? 'extra-space' : 'extra', text: user[j] });
      j += 1;
    } else if (i < correct.length) {
      parts.push({ type: correct[i] === ' ' ? 'missing-space' : 'missing', text: correct[i] });
      i += 1;
    }
  }
  return {
    isCorrect: correct.join('') === user.join(''),
    parts,
  };
}

