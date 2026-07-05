import { addDaysToDateString, todayString } from './dateUtils.js'

// Ebbinghaus-inspired spaced repetition ladder, in days.
export const INTERVALS_DAYS = [1, 3, 7, 14, 30, 90]

export function newCardSrsState(learnDate) {
  return {
    srsStage: 0,
    nextReviewDate: addDaysToDateString(learnDate, INTERVALS_DAYS[0]),
    lastReviewedDate: null,
    correctCount: 0,
    wrongCount: 0,
    totalReviews: 0,
  }
}

// Returns the fields that should be updated on a card after one review.
export function applyReviewResult(card, wasCorrect) {
  const today = todayString()
  let srsStage = wasCorrect ? Math.min(card.srsStage + 1, INTERVALS_DAYS.length - 1) : 0
  const nextReviewDate = addDaysToDateString(today, INTERVALS_DAYS[srsStage])

  return {
    srsStage,
    nextReviewDate,
    lastReviewedDate: today,
    correctCount: card.correctCount + (wasCorrect ? 1 : 0),
    wrongCount: card.wrongCount + (wasCorrect ? 0 : 1),
    totalReviews: card.totalReviews + 1,
  }
}

export function isDueToday(card) {
  return card.nextReviewDate <= todayString()
}
