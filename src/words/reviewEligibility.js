export function reviewExcludedWordIds(items = [], learnedWordIds = []) {
  const excluded = new Set(learnedWordIds);
  items.forEach((item) => {
    if (item.noReview === true) excluded.add(item.id);
  });
  return excluded;
}

export function eligibleWordItems(items = [], excludedWordIds = new Set()) {
  return items.filter((item) => !excludedWordIds.has(item.id));
}

export function eligibleQuestions(questions = [], excludedWordIds = new Set()) {
  return questions.filter((question) => question.kind === 'grammar-example' || !excludedWordIds.has(question.itemId));
}
