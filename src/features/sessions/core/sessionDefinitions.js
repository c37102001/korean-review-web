export const PRACTICE_SESSION_KIND = Object.freeze({
  COLLECTION: 'collection-practice',
  DAILY_REVIEW: 'daily-word-review',
  DAILY_RECOGNITION: 'daily-recognition',
  DAILY_GRAMMAR: 'daily-grammar',
  DAILY_WRONG_REVIEW: 'daily-wrong-review',
  FIXED_WORDS: 'fixed-word-practice',
  GRAMMAR_EXAMPLES: 'grammar-example-practice',
  OPTIONAL_GRAMMAR: 'optional-grammar-practice',
  OPTIONAL_LISTENING: 'optional-listening-practice',
  OPTIONAL_READING: 'optional-reading-practice',
  OPTIONAL_WORDS: 'optional-word-practice',
});

export const PRACTICE_RESULT_POLICY = Object.freeze({
  CHOICE: 'record-if-enabled',
  DAILY_REVIEW: 'record-daily-review',
  DAILY_WRONG_REVIEW: 'record-daily-wrong-review',
  NONE: 'do-not-record',
  OPTIONAL_POOL: 'update-optional-pool',
  RECOGNITION_ROUND: 'update-recognition-round',
});

export const PRACTICE_ORDER_POLICY = Object.freeze({
  ALPHABETICAL_OPTION: 'alphabetical-option',
  FIXED: 'fixed',
  REVIEW_SHUFFLE: 'review-kind-shuffle',
  USER_CHOICE: 'user-choice',
});

export const PRACTICE_RETRY_POLICY = Object.freeze({
  MISTAKES: 'retry-mistakes',
  NONE: 'no-retry',
  REPEATABLE: 'repeat-session',
});

function sessionBase(questions, label, kind, policy, options = {}) {
  return {
    kind,
    questions: questions || [],
    label,
    policy,
    direction: options.direction || 'ko-zh',
    grammarNote: options.grammarNote || null,
    noteCategory: options.noteCategory || 'grammar',
    onComplete: options.onComplete || null,
    onOptionalAnswer: options.onOptionalAnswer || null,
  };
}

export function createDailyReviewSession(questions, label = '今日測驗', options = {}) {
  return sessionBase(questions, label, PRACTICE_SESSION_KIND.DAILY_REVIEW, {
    answer: 'configurable',
    configureBeforeStart: true,
    direction: 'configurable',
    fixedSource: true,
    order: PRACTICE_ORDER_POLICY.REVIEW_SHUFFLE,
    result: PRACTICE_RESULT_POLICY.DAILY_REVIEW,
    retry: PRACTICE_RETRY_POLICY.NONE,
    reveal: 'word-details',
  }, options);
}

export function createWrongAnswerSession(questions, label = '今日答錯題目', options = {}) {
  return sessionBase(questions, label, PRACTICE_SESSION_KIND.DAILY_WRONG_REVIEW, {
    answer: 'configurable',
    configureBeforeStart: true,
    direction: 'configurable',
    fixedSource: true,
    order: PRACTICE_ORDER_POLICY.ALPHABETICAL_OPTION,
    result: PRACTICE_RESULT_POLICY.DAILY_WRONG_REVIEW,
    retry: PRACTICE_RETRY_POLICY.MISTAKES,
    reveal: 'word-details',
  }, options);
}

export function createOptionalPracticeSession(questions, label, options = {}) {
  const kindByOptionalKind = {
    grammar: PRACTICE_SESSION_KIND.OPTIONAL_GRAMMAR,
    listening: PRACTICE_SESSION_KIND.OPTIONAL_LISTENING,
    reading: PRACTICE_SESSION_KIND.OPTIONAL_READING,
    words: PRACTICE_SESSION_KIND.OPTIONAL_WORDS,
  };
  const kind = kindByOptionalKind[options.optionalKind] || PRACTICE_SESSION_KIND.OPTIONAL_WORDS;
  const listening = kind === PRACTICE_SESSION_KIND.OPTIONAL_LISTENING;
  const grammar = kind === PRACTICE_SESSION_KIND.OPTIONAL_GRAMMAR;
  const reading = kind === PRACTICE_SESSION_KIND.OPTIONAL_READING;
  return sessionBase(questions, label, kind, {
    answer: 'self-grade',
    configureBeforeStart: false,
    direction: listening || grammar || reading ? 'ko-zh' : 'fixed',
    fixedSource: true,
    order: PRACTICE_ORDER_POLICY.FIXED,
    result: PRACTICE_RESULT_POLICY.OPTIONAL_POOL,
    retry: PRACTICE_RETRY_POLICY.MISTAKES,
    reveal: grammar ? 'grammar-listening' : listening ? 'example-listening' : 'word-details',
  }, options);
}

export function createGrammarPracticeSession(questions, label, options = {}) {
  return sessionBase(questions, label, PRACTICE_SESSION_KIND.GRAMMAR_EXAMPLES, {
    answer: 'configurable',
    configureBeforeStart: true,
    direction: 'configurable',
    fixedSource: true,
    order: PRACTICE_ORDER_POLICY.USER_CHOICE,
    result: PRACTICE_RESULT_POLICY.NONE,
    retry: PRACTICE_RETRY_POLICY.MISTAKES,
    reveal: 'grammar-note',
  }, options);
}

export function createCollectionPracticeSession(questions, label, options = {}) {
  return sessionBase(questions, label, PRACTICE_SESSION_KIND.COLLECTION, {
    answer: 'configurable',
    configureBeforeStart: true,
    direction: 'configurable',
    fixedSource: false,
    order: PRACTICE_ORDER_POLICY.USER_CHOICE,
    result: options.allowResultRecording ? PRACTICE_RESULT_POLICY.CHOICE : PRACTICE_RESULT_POLICY.NONE,
    retry: PRACTICE_RETRY_POLICY.MISTAKES,
    reveal: 'word-details',
  }, options);
}

export function createFixedWordPracticeSession(questions, label, options = {}) {
  return sessionBase(questions, label, PRACTICE_SESSION_KIND.FIXED_WORDS, {
    answer: 'self-grade',
    configureBeforeStart: false,
    direction: 'fixed',
    fixedSource: true,
    order: PRACTICE_ORDER_POLICY.REVIEW_SHUFFLE,
    result: PRACTICE_RESULT_POLICY.NONE,
    retry: PRACTICE_RETRY_POLICY.MISTAKES,
    reveal: 'word-details',
  }, options);
}

function createLegacyDailyModeSession(questions, label, options) {
  if (options.mode === PRACTICE_SESSION_KIND.DAILY_RECOGNITION) {
    return sessionBase(questions, label, PRACTICE_SESSION_KIND.DAILY_RECOGNITION, {
      answer: 'self-grade', configureBeforeStart: false, direction: 'ko-zh', fixedSource: true,
      order: PRACTICE_ORDER_POLICY.FIXED, result: PRACTICE_RESULT_POLICY.RECOGNITION_ROUND,
      retry: PRACTICE_RETRY_POLICY.NONE, reveal: 'example-listening',
    }, options);
  }
  return sessionBase(questions, label, PRACTICE_SESSION_KIND.DAILY_GRAMMAR, {
    answer: 'self-grade', configureBeforeStart: false, direction: 'ko-zh', fixedSource: true,
    order: PRACTICE_ORDER_POLICY.FIXED, result: PRACTICE_RESULT_POLICY.NONE,
    retry: PRACTICE_RETRY_POLICY.NONE, reveal: 'grammar-listening',
  }, options);
}

export function createPracticeSession(questions, label, options = {}) {
  if (options.kind && options.policy) return options;
  if (options.optionalKind) return createOptionalPracticeSession(questions, label, options);
  if ([PRACTICE_SESSION_KIND.DAILY_RECOGNITION, PRACTICE_SESSION_KIND.DAILY_GRAMMAR].includes(options.mode)) {
    return createLegacyDailyModeSession(questions, label, options);
  }
  if (options.grammarOnly) return createGrammarPracticeSession(questions, label, options);
  if (options.wrongReview) return createWrongAnswerSession(questions, label, options);
  if (options.dailyReview) return createDailyReviewSession(questions, label, options);
  if (options.dueOnly) return createFixedWordPracticeSession(questions, label, options);
  return createCollectionPracticeSession(questions, label, options);
}

export function createStudySession(items, label) {
  return {
    kind: 'word-study',
    items: items || [],
    label,
    policy: {
      classification: true,
      edit: true,
      order: 'user-choice',
      speech: 'word-and-examples',
    },
  };
}
