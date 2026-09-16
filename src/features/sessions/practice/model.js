import { compareItemsByKoreanAlphabet } from '../../word-library/collection/model.js';
import {
  PRACTICE_ORDER_POLICY,
  PRACTICE_RESULT_POLICY,
  PRACTICE_RETRY_POLICY,
  PRACTICE_SESSION_KIND,
} from '../core/sessionDefinitions.js';

export function shuffleItems(items, seed) {
  const result = [...items];
  let value = seed || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    value = (value * 9301 + 49297) % 233280;
    const swapIndex = Math.floor((value / 233280) * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function shuffleReviewQuestionsByKind(questions, seed = Date.now()) {
  const terms = questions.filter((question) => question.kind === 'term');
  const examples = questions.filter((question) => question.kind === 'example');
  const others = questions.filter((question) => question.kind !== 'term' && question.kind !== 'example');
  return [
    ...shuffleItems(terms, seed),
    ...shuffleItems(examples, seed + 17),
    ...shuffleItems(others, seed + 31),
  ];
}

export function orderReviewQuestions(questions) {
  const kindRank = { term: 0, example: 1 };
  return [...questions].sort((left, right) => {
    const kindDiff = (kindRank[left.kind] ?? 99) - (kindRank[right.kind] ?? 99);
    if (kindDiff) return kindDiff;
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    const leftIndex = left.source?.index ?? 0;
    const rightIndex = right.source?.index ?? 0;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.id.localeCompare(right.id);
  });
}

export function compareQuestionsByKoreanAlphabet(left, right) {
  return compareItemsByKoreanAlphabet(left?.source || left, right?.source || right)
    || String(left?.id || '').localeCompare(String(right?.id || ''));
}

export function practiceSessionView(session) {
  const kind = session?.kind;
  const optionalMode = [
    PRACTICE_SESSION_KIND.OPTIONAL_GRAMMAR,
    PRACTICE_SESSION_KIND.OPTIONAL_LISTENING,
    PRACTICE_SESSION_KIND.OPTIONAL_READING,
    PRACTICE_SESSION_KIND.OPTIONAL_WORDS,
  ].includes(kind);
  const recognitionMode = [
    PRACTICE_SESSION_KIND.DAILY_RECOGNITION,
    PRACTICE_SESSION_KIND.OPTIONAL_LISTENING,
  ].includes(kind);
  const grammarMode = [
    PRACTICE_SESSION_KIND.DAILY_GRAMMAR,
    PRACTICE_SESSION_KIND.OPTIONAL_GRAMMAR,
  ].includes(kind);
  return {
    optionalMode,
    recognitionMode,
    grammarMode,
    readingMode: kind === PRACTICE_SESSION_KIND.OPTIONAL_READING,
    grammarPracticeMode: kind === PRACTICE_SESSION_KIND.GRAMMAR_EXAMPLES,
    dailyWordMode: kind === PRACTICE_SESSION_KIND.DAILY_REVIEW,
    wrongReviewMode: kind === PRACTICE_SESSION_KIND.DAILY_WRONG_REVIEW,
    configurableWordMode: Boolean(session?.policy?.configureBeforeStart),
    fixedSource: Boolean(session?.policy?.fixedSource),
    canChooseResultRecording: session?.policy?.result === PRACTICE_RESULT_POLICY.CHOICE,
    canRetryMistakes: session?.policy?.retry === PRACTICE_RETRY_POLICY.MISTAKES,
    canRepeatSession: session?.policy?.retry === PRACTICE_RETRY_POLICY.REPEATABLE,
    startsImmediately: !session?.policy?.configureBeforeStart,
  };
}

export function initialPracticeDirection(session = {}) {
  return session.direction || 'ko-zh';
}

export function activePracticeDirection(session, selectedDirection) {
  return session?.policy?.direction === 'ko-zh' ? 'ko-zh' : selectedDirection;
}

export function shouldRecordPracticeResults(session, recordResults = session?.recordResults) {
  return session?.policy?.result === PRACTICE_RESULT_POLICY.DAILY_REVIEW
    || (session?.policy?.result === PRACTICE_RESULT_POLICY.CHOICE && Boolean(recordResults));
}

export function practiceResultEffect(session, { mistakeRetryRound = false, recordResults = false } = {}) {
  const policy = session?.policy?.result || PRACTICE_RESULT_POLICY.NONE;
  if (policy === PRACTICE_RESULT_POLICY.DAILY_WRONG_REVIEW) return 'daily-wrong-review';
  if (mistakeRetryRound) return shouldRecordPracticeResults(session, recordResults)
    ? policy === PRACTICE_RESULT_POLICY.DAILY_REVIEW ? 'daily-review' : 'record-answer'
    : 'none';
  if (policy === PRACTICE_RESULT_POLICY.OPTIONAL_POOL) return 'optional-pool';
  if (policy === PRACTICE_RESULT_POLICY.RECOGNITION_ROUND) return 'recognition-round';
  if (policy === PRACTICE_RESULT_POLICY.DAILY_REVIEW) return 'daily-review';
  if (policy === PRACTICE_RESULT_POLICY.CHOICE && recordResults) return 'record-answer';
  return 'none';
}

export function selectPracticeQuestions(session, {
  direction = initialPracticeDirection(session),
  source = 'term',
  starredIds = [],
  starredOnly = false,
} = {}) {
  const questions = session?.questions || [];
  const view = practiceSessionView(session);
  const applyStarFilter = (list) => {
    if (!starredOnly) return list;
    const starredSet = starredIds instanceof Set ? starredIds : new Set(starredIds);
    return list.filter((question) => starredSet.has(question.itemId));
  };
  if (view.optionalMode || view.recognitionMode || view.grammarMode) return questions;
  if (view.grammarPracticeMode) return questions.filter((question) => question.kind === 'grammar-example');
  if (session.policy.order === PRACTICE_ORDER_POLICY.ALPHABETICAL_OPTION) {
    return [...questions].sort(compareQuestionsByKoreanAlphabet);
  }
  if (session.policy.order === PRACTICE_ORDER_POLICY.REVIEW_SHUFFLE || view.dailyWordMode) {
    return orderReviewQuestions(questions);
  }
  if (direction === 'ko-zh') return applyStarFilter(questions.filter((question) => question.kind === 'term'));
  const filtered = questions.filter((question) => source === 'all' || question.kind === source);
  return applyStarFilter(source === 'all' ? orderReviewQuestions(filtered) : filtered);
}

export function buildPracticeQueue(session, questions, { randomOrder = true, seed = Date.now() } = {}) {
  const policy = session?.policy?.order;
  if (policy === PRACTICE_ORDER_POLICY.FIXED) return [...questions];
  if (policy === PRACTICE_ORDER_POLICY.REVIEW_SHUFFLE) return shuffleReviewQuestionsByKind(questions, seed);
  if (!randomOrder) return [...questions];
  return shuffleItems(questions, seed);
}

export function isSelfGradeAnswerMode(direction, answerMode = 'typing') {
  return direction === 'ko-zh' || answerMode === 'self-grade';
}

export function practiceMistakeReviewQuestions(questions = [], wrongQuestionIds = []) {
  const wrongIds = new Set(wrongQuestionIds);
  const seen = new Set();
  return questions.filter((question) => {
    if (!wrongIds.has(question.id)) return false;
    const reviewKey = question.kind === 'grammar-example'
      ? `grammar:${question.id}`
      : `word:${question.itemId || question.source?.id || question.id}`;
    if (seen.has(reviewKey)) return false;
    seen.add(reviewKey);
    return true;
  });
}

export function shouldAutoPronouncePracticePrompt({ started, recognitionMode, grammarMode, activeDirection, autoPronounce, recognitionWordVisible, revealed, graded, question }) {
  if (!started || !question || revealed || graded) return false;
  if (recognitionMode || grammarMode) return !recognitionWordVisible;
  return activeDirection === 'ko-zh' && autoPronounce;
}
