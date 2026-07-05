// All dates are stored/compared as local "YYYY-MM-DD" strings, not Firestore
// Timestamps, so day-level comparisons ("is this due today") stay simple and
// timezone-stable for a single-user app.

export function toDateString(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayString() {
  return toDateString(new Date())
}

export function addDaysToDateString(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return toDateString(date)
}

export function compareDateStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

export function isOnOrBeforeToday(dateString) {
  return compareDateStrings(dateString, todayString()) <= 0
}
