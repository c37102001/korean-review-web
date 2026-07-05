export const MASTERY = {
  LEARNING: 'learning',
  NORMAL: 'normal',
  MASTERED: 'mastered',
  WEAK: 'weak',
}

export const MASTERY_LABEL = {
  [MASTERY.LEARNING]: '學習中',
  [MASTERY.NORMAL]: '普通',
  [MASTERY.MASTERED]: '熟練',
  [MASTERY.WEAK]: '不熟悉',
}

// Thresholds are deliberately simple constants, not user-configurable.
const MIN_REVIEWS_FOR_JUDGEMENT = 3
const MASTERED_ACCURACY = 0.85
const MASTERED_MIN_STAGE = 3 // reached the 14-day interval or beyond
const WEAK_ACCURACY = 0.5

export function accuracyOf(card) {
  if (!card.totalReviews) return null
  return card.correctCount / card.totalReviews
}

export function masteryOf(card) {
  if (card.totalReviews < MIN_REVIEWS_FOR_JUDGEMENT) return MASTERY.LEARNING
  const acc = accuracyOf(card)
  if (acc >= MASTERED_ACCURACY && card.srsStage >= MASTERED_MIN_STAGE) return MASTERY.MASTERED
  if (acc < WEAK_ACCURACY) return MASTERY.WEAK
  return MASTERY.NORMAL
}
