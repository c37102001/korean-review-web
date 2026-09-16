export const REVIEW_INTERVALS = Object.freeze([1, 3, 7, 14, 30, 90]);

export function reviewFamiliarityScore(stats = {}) {
  const correct = Number(stats.correct) || 0;
  const wrong = Number.isFinite(Number(stats.wrong))
    ? Number(stats.wrong)
    : Math.max(0, (Number(stats.total) || 0) - correct);
  return correct - wrong;
}

export function nextReviewTransition({ previousStage = 0, previousStats = {}, nextStats = {}, correct }, intervals = REVIEW_INTERVALS) {
  const previousScore = reviewFamiliarityScore(previousStats);
  const nextScore = reviewFamiliarityScore(nextStats);
  const remainsUnfamiliar = nextScore < 0;
  const stage = remainsUnfamiliar
    ? 0
    : correct
      ? Math.min((previousScore < 0 ? 0 : previousStage) + 1, intervals.length - 1)
      : 0;
  return {
    stage,
    intervalDays: remainsUnfamiliar && correct ? 2 : intervals[stage],
  };
}

export function wrongQuestionIds(events = []) {
  const wrong = new Set();
  events.forEach((event) => {
    if (!event?.questionId) return;
    if (event.correct === true) wrong.delete(event.questionId);
    else if (event.correct === false) wrong.add(event.questionId);
  });
  return [...wrong].sort();
}

export function excludeLearnedWordIds(questionWordIds = [], learnedWordIds = []) {
  const learned = new Set(learnedWordIds);
  return questionWordIds.filter((wordId) => !learned.has(wordId));
}
