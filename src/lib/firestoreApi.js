import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  query,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { planImport } from './cardParser.js'
import { newCardSrsState, applyReviewResult } from './srs.js'
import { todayString } from './dateUtils.js'

function cardsCol(uid) {
  return collection(db, 'users', uid, 'cards')
}

function daysCol(uid) {
  return collection(db, 'users', uid, 'days')
}

// Flattens a Firestore card doc (id + content fields + srs/stat fields) into
// the shape quizGenerator/mastery/etc. expect: a single flat object.
function flattenCard(id, data) {
  return { id, ...data }
}

export async function fetchAllCards(uid) {
  const snap = await getDocs(cardsCol(uid))
  return snap.docs.map((d) => flattenCard(d.id, d.data()))
}

export async function fetchCardsForDate(uid, date) {
  const q = query(cardsCol(uid), where('sourceDates', 'array-contains', date))
  const snap = await getDocs(q)
  return snap.docs.map((d) => flattenCard(d.id, d.data()))
}

export async function fetchDayDoc(uid, date) {
  const snap = await getDoc(doc(daysCol(uid), date))
  return snap.exists() ? snap.data() : null
}

export async function fetchDaysInRange(uid, startDate, endDate) {
  const q = query(daysCol(uid), where('date', '>=', startDate), where('date', '<=', endDate))
  const snap = await getDocs(q)
  const result = {}
  snap.docs.forEach((d) => {
    result[d.id] = d.data()
  })
  return result
}

function dedupRawItems(existingItems, incomingItems) {
  const seen = new Set((existingItems || []).map((i) => JSON.stringify(i)))
  const additions = incomingItems.filter((i) => {
    const key = JSON.stringify(i)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...(existingItems || []), ...additions]
}

// Imports one day's worth of raw JSON items: merges them into that day's
// document, and creates/updates the normalized `cards` for spaced repetition.
// Returns the same plan the preview UI showed, so callers can report back
// how many cards were new vs. updated.
export async function importDayItems(uid, date, rawItems) {
  const existingCards = await fetchAllCards(uid)
  const existingCardsById = Object.fromEntries(existingCards.map((c) => [c.id, c]))
  const { entries, skipped } = planImport(rawItems, existingCardsById)

  const existingDay = await fetchDayDoc(uid, date)
  const mergedRawItems = dedupRawItems(existingDay?.rawItems, rawItems)

  const batch = writeBatch(db)

  batch.set(
    doc(daysCol(uid), date),
    {
      date,
      rawItems: mergedRawItems,
      updatedAt: serverTimestamp(),
      createdAt: existingDay ? existingDay.createdAt ?? serverTimestamp() : serverTimestamp(),
    },
    { merge: true }
  )

  for (const entry of entries) {
    const cardRef = doc(cardsCol(uid), entry.id)
    if (entry.isNew) {
      batch.set(cardRef, {
        kind: entry.kind,
        ...entry.mergedContent,
        sourceDates: [date],
        firstLearnedDate: date,
        ...newCardSrsState(date),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    } else {
      const existing = existingCardsById[entry.id]
      const sourceDates = existing.sourceDates?.includes(date)
        ? existing.sourceDates
        : [...(existing.sourceDates || []), date]
      batch.set(
        cardRef,
        {
          kind: entry.kind,
          ...entry.mergedContent,
          sourceDates,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    }
  }

  await batch.commit()
  return { newCount: entries.filter((e) => e.isNew).length, updatedCount: entries.filter((e) => !e.isNew).length, skipped }
}

// Pure preview (no writes): shows what an import would do.
export async function previewImport(uid, rawItems) {
  const existingCards = await fetchAllCards(uid)
  const existingCardsById = Object.fromEntries(existingCards.map((c) => [c.id, c]))
  return planImport(rawItems, existingCardsById)
}

export async function fetchDueCards(uid) {
  const all = await fetchAllCards(uid)
  const today = todayString()
  return all.filter((c) => c.nextReviewDate && c.nextReviewDate <= today)
}

export async function recordReview(uid, cardId, wasCorrect) {
  const cardRef = doc(cardsCol(uid), cardId)
  const snap = await getDoc(cardRef)
  if (!snap.exists()) return
  const card = flattenCard(cardId, snap.data())
  const patch = applyReviewResult(card, wasCorrect)
  await updateDoc(cardRef, { ...patch, updatedAt: serverTimestamp() })
}
