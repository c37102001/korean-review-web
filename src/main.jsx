import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Dumbbell,
  Flame,
  LibraryBig,
  LogOut,
  Pencil,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
  Star,
  Target,
  Trash2,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import './styles.css';

const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 90];
const STUDY_DATE = '2026-07-05';
const CONTENT_SCHEMA_VERSION = 2;
const APP_STATE_ID = 'reviewState';
const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/gu;
const REVIEW_COMPLETION_BACKFILL_START = '2026-07-06';
const REVIEW_COMPLETION_BACKFILL_END = '2026-07-07';

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const todayString = () => toDateKey(new Date());
const addDays = (date, days) => {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return toDateKey(next);
};
const dateLabel = (date) => new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T00:00:00`));
const monthTitle = (date) => new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long' }).format(date);

function emptyStore() {
  return { stats: {}, progress: {}, learning: {}, attempts: [], customRecords: [], deletedRecordIds: [], completedReviewDates: [], starred: [] };
}

function useAuthUser() {
  const [authState, setAuthState] = useState({ loading: true, user: null });
  useEffect(() => onAuthStateChanged(auth, (user) => setAuthState({ loading: false, user })), []);
  return authState;
}

async function fetchCustomRecords(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'records'));
  return snap.docs.map((documentSnap) => documentSnap.data()).sort((a, b) => {
    if (a.date === b.date) return (a.createdAt || '').localeCompare(b.createdAt || '');
    return a.date.localeCompare(b.date);
  });
}

async function deleteCollectionDocs(uid, collectionName) {
  const snap = await getDocs(collection(db, 'users', uid, collectionName));
  await Promise.all(snap.docs.map((documentSnap) => deleteDoc(documentSnap.ref)));
}

async function cleanupObsoleteFirebaseData(uid) {
  await Promise.all([
    deleteCollectionDocs(uid, 'cards'),
    deleteDoc(doc(db, 'users', uid, 'meta', 'replaceCurrentAppData')),
    deleteDoc(doc(db, 'users', uid, 'meta', 'contentSchemaV2')),
  ]);
}

function recordHasObsoleteContent(record) {
  const item = record.item || {};
  return Boolean(
    item.schemaVersion ||
    item.zh ||
    item.examples ||
    item.senses ||
    (item.related || []).some((entry) => typeof entry !== 'string'),
  );
}

async function cleanupStoredContent(uid) {
  const records = await fetchCustomRecords(uid);
  const staleRecords = records.filter(recordHasObsoleteContent);
  if (!staleRecords.length) return;
  await Promise.all(staleRecords.map((record) => deleteQuestionsForRecord(uid, record.id)));
  await writeLearningRecords(uid, normalizeRecordSet(records));
}

function useFirestoreStore(user) {
  const [state, setState] = useState({ loading: true, error: '', store: emptyStore() });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) return;
      setState((current) => ({ ...current, loading: true, error: '' }));
      try {
        await cleanupObsoleteFirebaseData(user.uid);
        await cleanupStoredContent(user.uid);
        const snap = await getDoc(doc(db, 'users', user.uid, 'appState', APP_STATE_ID));
        const customRecords = await fetchCustomRecords(user.uid);
        const data = snap.exists() ? snap.data() : emptyStore();
        if (!cancelled) {
          setState({
            loading: false,
            error: '',
            store: {
              stats: data.stats || {},
              progress: data.progress || {},
              learning: data.learning || {},
              attempts: data.attempts || [],
              deletedRecordIds: data.deletedRecordIds || [],
              completedReviewDates: data.completedReviewDates || [],
              starred: data.starred || [],
              customRecords,
            },
          });
        }
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error.message, store: emptyStore() });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const update = async (updater) => {
    const next = updater(state.store);
    setState((current) => ({ ...current, store: next }));
    const { customRecords, ...persistedState } = next;
    await setDoc(
      doc(db, 'users', user.uid, 'appState', APP_STATE_ID),
      { ...persistedState, updatedAt: serverTimestamp() },
      { merge: true },
    );
  };

  return [state.store, update, state.loading, state.error];
}

function buildRecordLookup(records) {
  const byId = new Map();
  const byKo = new Map();
  records.forEach((record) => {
    byId.set(record.id, record.id);
    if (record.item?.ko) byKo.set(record.item.ko.trim(), record.id);
  });
  return { byId, byKo };
}

function resolveRelatedIds(related, lookup) {
  if (!Array.isArray(related)) return [];
  return [...new Set(related.map((entry) => {
    if (typeof entry === 'string') return lookup.byId.get(entry) || lookup.byKo.get(entry.trim()) || entry.trim();
    if (entry?.id) return lookup.byId.get(entry.id) || entry.id;
    if (entry?.ko) return lookup.byKo.get(entry.ko.trim()) || entry.ko.trim();
    return '';
  }).filter(Boolean))];
}

function normalizeExample(example, fallbackId) {
  return {
    id: example.id || fallbackId,
    ko: example.ko || '',
    zh: example.zh || '',
  };
}

function normalizeItemToV2(item, recordId, lookup = buildRecordLookup([])) {
  if (!Array.isArray(item.meanings) || !item.meanings.length) {
    throw new Error(`單字「${item.ko || recordId}」缺少 meanings`);
  }

  const meanings = item.meanings.map((meaning, meaningIndex) => {
    const meaningId = meaning.id || `${recordId}-${meaningIndex}`;
    const examples = (meaning.examples || []).map((example, exampleIndex) => normalizeExample(example, `${meaningId}-ex-${exampleIndex}`));
    return {
      id: meaningId,
      zh: meaning.zh || '',
      ...(meaning.pattern ? { pattern: meaning.pattern } : {}),
      examples,
    };
  });

  return {
    ko: item.ko,
    ...(item.pos ? { pos: item.pos } : {}),
    meanings,
    ...(item.notes?.length ? { notes: item.notes } : {}),
    related: resolveRelatedIds(item.related, lookup),
  };
}

function normalizeRecordSet(records) {
  const lookup = buildRecordLookup(records);
  return records.map((record) => ({
    ...record,
    item: normalizeItemToV2(record.item, record.id, lookup),
  }));
}

function itemZh(item) {
  return (item.meanings || []).map((meaning) => meaning.zh).filter(Boolean).join('；');
}

function itemExamples(item) {
  return (item.meanings || []).flatMap((meaning) => meaning.examples || []);
}

function displayRelated(item, allItems = []) {
  const byId = new Map(allItems.map((entry) => [entry.id, entry]));
  return (item.related || []).map((id) => byId.get(id)).filter(Boolean);
}

function normalizeRecords(records) {
  const normalizedRecords = normalizeRecordSet(records);
  const items = normalizedRecords.map((record, index) => ({
    ...record.item,
    id: record.id,
    date: record.date,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    index,
    zh: itemZh(record.item),
  }));

  const questions = [];
  const seenExamples = new Set();
  const addExampleQuestion = (item, example, id) => {
    const key = `${example.ko}\n${example.zh}`;
    if (seenExamples.has(key)) return;
    seenExamples.add(key);
    questions.push({
      id,
      itemId: item.id,
      date: item.date,
      kind: 'example',
      pos: '例句',
      ko: example.ko,
      zh: example.zh,
      source: item,
    });
  };
  items.forEach((item) => {
    const isComparisonCard = !!item.items?.length && !item.meanings?.length;
    if (!isComparisonCard) {
      questions.push({
        id: item.id,
        itemId: item.id,
        date: item.date,
        kind: 'term',
        pos: item.pos || '比較',
        ko: item.ko,
        zh: item.zh,
        source: item,
      });
    }
    (item.meanings || []).forEach((meaning) => {
      (meaning.examples || []).forEach((example) => {
        addExampleQuestion(item, example, example.id);
      });
    });
  });
  return { items, questions };
}

function parseJsonItems(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 格式錯誤，請確認括號、逗號和引號是否正確');
  }
  if (!Array.isArray(parsed) && parsed?.schemaVersion !== undefined && parsed.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    throw new Error(`JSON schemaVersion 需要是 ${CONTENT_SCHEMA_VERSION}`);
  }
  const data = Array.isArray(parsed) ? parsed : parsed.data;
  if (!Array.isArray(data)) throw new Error('JSON 需要是 { "data": [...] } 或陣列格式');
  data.forEach(validateImportItem);
  return data;
}

function readJsonImportDocument(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 格式錯誤，請確認括號、逗號和引號是否正確');
  }
  if (!Array.isArray(parsed) && parsed?.schemaVersion !== undefined && parsed.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    throw new Error(`JSON schemaVersion 需要是 ${CONTENT_SCHEMA_VERSION}`);
  }
  const data = Array.isArray(parsed) ? parsed : parsed.data;
  if (!Array.isArray(data)) throw new Error('JSON 需要是 { "data": [...] } 或陣列格式');
  return data;
}

function buildJsonImportDraft(text, targetDate) {
  const data = readJsonImportDocument(text);
  const entries = data.map((item, index) => {
    try {
      validateImportItem(item, index);
      return { index, action: 'add', item };
    } catch (validationError) {
      return null;
    }
  });
  const invalid = data.map((item, index) => {
    try {
      validateImportItem(item, index);
      return null;
    } catch (validationError) {
      return { index, text: JSON.stringify(item, null, 2), error: validationError.message };
    }
  }).filter(Boolean);
  return { targetDate, entries, invalid, conflict: null, message: '' };
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 需要是物件`);
}

function assertString(value, label, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw new Error(`${label} 是必填`);
    return;
  }
  if (typeof value !== 'string') throw new Error(`${label} 需要是文字`);
  if (required && !value.trim()) throw new Error(`${label} 不可以空白`);
}

function assertNoUnsupportedKeys(value, allowedKeys, label) {
  const unsupported = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unsupported.length) throw new Error(`${label} 有不支援的欄位：${unsupported.join('、')}`);
}

function assertUniqueIds(values, label) {
  const ids = values.map((value) => value.id).filter(Boolean);
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicated.length) throw new Error(`${label} 有重複 id：${[...new Set(duplicated)].join('、')}`);
}

function validateImportItem(item, itemIndex) {
  const label = `第 ${itemIndex + 1} 筆資料`;
  assertPlainObject(item, label);
  assertNoUnsupportedKeys(item, ['id', 'date', 'ko', 'pos', 'meanings', 'notes', 'related'], label);
  assertString(item.id, `${label} 的 id`);
  assertString(item.date, `${label} 的 date`);
  assertString(item.ko, `${label} 的 ko`, { required: true });
  assertString(item.pos, `${label} 的 pos`);

  if (!Array.isArray(item.meanings) || !item.meanings.length) throw new Error(`${label} 需要 meanings，而且至少要有 1 個 meaning`);
  assertUniqueIds(item.meanings, `${label} 的 meanings`);
  item.meanings.forEach((meaning, meaningIndex) => {
    const meaningLabel = `${label} 的第 ${meaningIndex + 1} 個 meaning`;
    assertPlainObject(meaning, meaningLabel);
    assertNoUnsupportedKeys(meaning, ['id', 'zh', 'pattern', 'examples'], meaningLabel);
    assertString(meaning.id, `${meaningLabel} 的 id`);
    assertString(meaning.zh, `${meaningLabel} 的 zh`, { required: true });
    assertString(meaning.pattern, `${meaningLabel} 的 pattern`);
    if (meaning.examples === undefined) return;
    if (!Array.isArray(meaning.examples)) throw new Error(`${meaningLabel} 的 examples 需要是陣列`);
    assertUniqueIds(meaning.examples, `${meaningLabel} 的 examples`);
    meaning.examples.forEach((example, exampleIndex) => {
      const exampleLabel = `${meaningLabel} 的第 ${exampleIndex + 1} 個 example`;
      assertPlainObject(example, exampleLabel);
      assertNoUnsupportedKeys(example, ['id', 'ko', 'zh'], exampleLabel);
      assertString(example.id, `${exampleLabel} 的 id`);
      assertString(example.ko, `${exampleLabel} 的 ko`, { required: true });
      assertString(example.zh, `${exampleLabel} 的 zh`, { required: true });
    });
  });

  if (item.notes !== undefined) {
    if (!Array.isArray(item.notes)) throw new Error(`${label} 的 notes 需要是文字陣列`);
    item.notes.forEach((note, noteIndex) => assertString(note, `${label} 的第 ${noteIndex + 1} 則 note`, { required: true }));
  }
  if (item.related !== undefined) {
    if (!Array.isArray(item.related)) throw new Error(`${label} 的 related 需要是文字陣列`);
    item.related.forEach((related, relatedIndex) => assertString(related, `${label} 的第 ${relatedIndex + 1} 個 related`, { required: true }));
  }
}

function linesToArray(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function parsePairLines(text) {
  return linesToArray(text).map((line) => {
    const separator = line.includes('|') ? '|' : '=';
    const [ko, ...rest] = line.split(separator);
    return { ko: ko.trim(), zh: rest.join(separator).trim() };
  }).filter((entry) => entry.ko && entry.zh);
}

function createRecordsForDate(date, rawItems, existingItems = []) {
  const now = new Date().toISOString();
  const records = rawItems.map((item) => ({
    id: item.id || `${date}-custom-${crypto.randomUUID()}`,
    date: item.date || date,
    item,
    createdAt: item.createdAt || now,
  }));
  const lookupRecords = [
    ...existingItems.map((item) => ({ id: item.id, item })),
    ...records,
  ];
  const lookup = buildRecordLookup(lookupRecords);
  const knownIds = new Set(lookupRecords.map((record) => record.id));
  const normalized = records.map((record) => ({
    ...record,
    item: normalizeItemToV2(record.item, record.id, lookup),
  }));
  const missingRelated = normalized.flatMap((record) => (record.item.related || []).filter((id) => !knownIds.has(id)));
  if (missingRelated.length) throw new Error(`找不到相關單字：${[...new Set(missingRelated)].join('、')}`);
  return normalized;
}

function createRecordsFromImportEntries(entries, date, existingItems = []) {
  const now = new Date().toISOString();
  const addRecords = entries.filter((entry) => entry.action === 'add').map((entry) => ({
    id: entry.item.id || `${date}-custom-${crypto.randomUUID()}`,
    date: entry.item.date || date,
    item: entry.item,
    createdAt: entry.item.createdAt || now,
  }));
  const updateRecords = entries.filter((entry) => entry.action === 'update').map((entry) => ({
    id: entry.existing.id,
    date: entry.existing.date,
    item: entry.item,
    createdAt: entry.existing.createdAt || now,
    updatedAt: now,
  }));
  const lookupRecords = [
    ...existingItems.map((item) => ({ id: item.id, item })),
    ...addRecords,
    ...updateRecords,
  ];
  const lookup = buildRecordLookup(lookupRecords);
  const knownIds = new Set(lookupRecords.map((record) => record.id));
  const normalize = (record) => ({
    ...record,
    item: normalizeItemToV2(record.item, record.id, lookup),
  });
  const normalizedAdds = addRecords.map(normalize);
  const normalizedUpdates = updateRecords.map(normalize);
  const missingRelated = [...normalizedAdds, ...normalizedUpdates].flatMap((record) => (record.item.related || []).filter((id) => !knownIds.has(id)));
  if (missingRelated.length) throw new Error(`找不到相關單字：${[...new Set(missingRelated)].join('、')}`);
  return { addRecords: normalizedAdds, updateRecords: normalizedUpdates };
}

function createUpdateRecordsFromEditedJson(text, date, selectedItems, allItems = []) {
  const data = readJsonImportDocument(text);
  data.forEach(validateImportItem);
  const selectedById = new Map(selectedItems.map((item) => [item.id, item]));
  const expectedIds = new Set(selectedItems.map((item) => item.id));
  const editedIds = data.map((item) => item.id).filter(Boolean);
  const duplicateIds = editedIds.filter((id, index) => editedIds.indexOf(id) !== index);
  if (duplicateIds.length) throw new Error(`JSON 中有重複 id：${[...new Set(duplicateIds)].join('、')}`);
  const missingIds = [...expectedIds].filter((id) => !editedIds.includes(id));
  const extraIds = editedIds.filter((id) => !expectedIds.has(id));
  if (missingIds.length) throw new Error(`缺少這一天原本的單字 id：${missingIds.join('、')}`);
  if (extraIds.length) throw new Error(`不能在這裡新增或修改其他日期的單字 id：${extraIds.join('、')}`);

  const koById = new Map();
  data.forEach((item) => {
    if (item.date && item.date !== date) throw new Error(`單字「${item.ko}」的 date 必須維持 ${date}`);
    const normalizedKo = item.ko.trim();
    const existingId = koById.get(normalizedKo);
    if (existingId && existingId !== item.id) throw new Error(`JSON 中有重複韓文單字：${normalizedKo}`);
    koById.set(normalizedKo, item.id);
  });
  const duplicateExisting = allItems.find((item) => !expectedIds.has(item.id) && koById.has(item.ko?.trim()));
  if (duplicateExisting) throw new Error(`韓文單字「${duplicateExisting.ko}」已存在於其他單字卡，請不要改成重複單字。`);

  const now = new Date().toISOString();
  const records = data.map((item) => {
    const original = selectedById.get(item.id);
    return {
      id: original.id,
      date,
      item: { ...item, date },
      createdAt: original.createdAt || now,
      updatedAt: now,
    };
  });
  const editedIdSet = new Set(records.map((record) => record.id));
  const lookupRecords = [
    ...allItems.filter((item) => !editedIdSet.has(item.id)).map((item) => ({ id: item.id, item })),
    ...records,
  ];
  const lookup = buildRecordLookup(lookupRecords);
  const knownIds = new Set(lookupRecords.map((record) => record.id));
  const normalized = records.map((record) => ({
    ...record,
    item: normalizeItemToV2(record.item, record.id, lookup),
  }));
  const missingRelated = normalized.flatMap((record) => (record.item.related || []).filter((id) => !knownIds.has(id)));
  if (missingRelated.length) throw new Error(`找不到相關單字：${[...new Set(missingRelated)].join('、')}`);
  return normalized;
}

function comparableItemSnapshot(item) {
  return {
    ko: item.ko || '',
    pos: item.pos || '',
    meanings: item.meanings || [],
    notes: item.notes || [],
    related: item.related || [],
  };
}

function jsonEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function summarizeEditedJsonChanges(originalItems, records) {
  const originalById = new Map(originalItems.map((item) => [item.id, item]));
  return records.map((record) => {
    const original = originalById.get(record.id);
    const next = { ...record.item, id: record.id, date: record.date };
    const fields = [];
    if (!jsonEqual(original?.ko, next.ko)) fields.push('韓文');
    if (!jsonEqual(original?.pos || '', next.pos || '')) fields.push('詞性');
    if (!jsonEqual(original?.meanings || [], next.meanings || [])) fields.push('意思/例句');
    if (!jsonEqual(original?.notes || [], next.notes || [])) fields.push('筆記');
    if (!jsonEqual(original?.related || [], next.related || [])) fields.push('相關詞');
    if (!fields.length && jsonEqual(comparableItemSnapshot(original), comparableItemSnapshot(next))) return null;
    return {
      id: record.id,
      beforeKo: original?.ko || record.id,
      afterKo: next.ko || record.id,
      fields,
    };
  }).filter(Boolean);
}

function findMissingImportRelated(entries, existingItems = []) {
  const activeEntries = entries.filter(Boolean);
  const knownIds = new Set(existingItems.map((item) => item.id).filter(Boolean));
  const knownKo = new Set(existingItems.map((item) => item.ko?.trim()).filter(Boolean));
  activeEntries.forEach((entry) => {
    const entryId = entry.action === 'update' ? entry.existing?.id : entry.item.id;
    if (entryId) knownIds.add(entryId);
    if (entry.item.ko) knownKo.add(entry.item.ko.trim());
  });
  return activeEntries.map((entry, position) => {
    const missing = (entry.item.related || [])
      .map((related) => related.trim())
      .filter((related) => related && !knownIds.has(related) && !knownKo.has(related));
    if (!missing.length) return null;
    return { position, ko: entry.item.ko, missing: [...new Set(missing)] };
  }).filter(Boolean);
}

function clearMissingImportRelated(entries, missingRelated) {
  const missingByPosition = new Map(missingRelated.map((issue) => [issue.position, new Set(issue.missing)]));
  return entries.filter(Boolean).map((entry, position) => {
    const missingSet = missingByPosition.get(position);
    if (!missingSet) return entry;
    const nextRelated = (entry.item.related || []).filter((related) => !missingSet.has(related.trim()));
    const nextItem = { ...entry.item };
    if (nextRelated.length) nextItem.related = nextRelated;
    else delete nextItem.related;
    return { ...entry, item: nextItem };
  });
}

function findImportConflict(entries, existingItems = []) {
  const activeEntries = entries.map((entry, position) => (entry ? { ...entry, position } : null)).filter(Boolean);
  for (let index = 0; index < activeEntries.length; index += 1) {
    const current = activeEntries[index];
    const duplicateIndex = activeEntries.findIndex((entry, candidateIndex) => candidateIndex < index && entry.item.ko.trim() === current.item.ko.trim());
    if (duplicateIndex >= 0) {
      const other = activeEntries[duplicateIndex];
      return {
        type: 'input',
        leftEntryIndex: other.position,
        rightEntryIndex: current.position,
        left: other.item,
        right: current.item,
        editText: JSON.stringify(mergeImportItems(other.item, current.item), null, 2),
        error: '',
      };
    }
    if (current.action === 'add') {
      const existing = existingItems.find((item) => item.ko.trim() === current.item.ko.trim());
      if (existing) {
        return {
          type: 'existing',
          entryIndex: current.position,
          existing,
          incoming: current.item,
          editText: JSON.stringify(mergeImportItems(existing, current.item), null, 2),
          error: '',
        };
      }
    }
  }
  return null;
}

function stripGeneratedIdsFromMeaning(meaning) {
  const { id, examples = [], ...content } = meaning;
  return {
    ...content,
    examples: examples.map((example) => {
      const { id: exampleId, ...exampleContent } = example;
      return exampleContent;
    }),
  };
}

function mergeImportItems(left, right) {
  const notes = [...new Set([...(left.notes || []), ...(right.notes || [])].filter(Boolean))];
  const related = [...new Set([...(left.related || []), ...(right.related || [])].filter(Boolean))];
  return {
    ko: right.ko || left.ko,
    ...(right.pos || left.pos ? { pos: right.pos || left.pos } : {}),
    meanings: [
      ...(left.meanings || []).map(stripGeneratedIdsFromMeaning),
      ...(right.meanings || []).map(stripGeneratedIdsFromMeaning),
    ],
    ...(notes.length ? { notes } : {}),
    ...(related.length ? { related } : {}),
  };
}

function parseEditedImportItem(text, label = '編輯後的單字') {
  let item;
  try {
    item = JSON.parse(text);
  } catch {
    throw new Error(`${label} JSON 格式錯誤`);
  }
  validateImportItem(item, 0);
  return item;
}

async function writeLearningRecords(uid, records) {
  const normalizedRecords = normalizeRecordSet(records);
  const { items, questions } = normalizeRecords(normalizedRecords);
  const batch = writeBatch(db);
  const byDate = normalizedRecords.reduce((acc, record) => {
    acc[record.date] = acc[record.date] || [];
    acc[record.date].push(record.item);
    return acc;
  }, {});

  Object.entries(byDate).forEach(([date, rawItems]) => {
    batch.set(
      doc(db, 'users', uid, 'days', date),
      {
        date,
        lastAddedItems: rawItems,
        itemCount: rawItems.length,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
  normalizedRecords.forEach((record) => {
    batch.set(doc(db, 'users', uid, 'records', record.id), { ...record, updatedAt: serverTimestamp() });
  });
  items.forEach((item) => {
    batch.set(doc(db, 'users', uid, 'items', item.id), { ...item, updatedAt: serverTimestamp() });
  });
  questions.forEach((question) => {
    const { source, ...questionDoc } = question;
    batch.set(doc(db, 'users', uid, 'questions', question.id), { ...questionDoc, updatedAt: serverTimestamp() });
  });
  await batch.commit();
}

async function deleteQuestionsForRecord(uid, recordId) {
  const snap = await getDocs(collection(db, 'users', uid, 'questions'));
  await Promise.all(snap.docs
    .filter((documentSnap) => documentSnap.data().itemId === recordId)
    .map((documentSnap) => deleteDoc(documentSnap.ref)));
}

async function writeLearningRecord(uid, record) {
  await deleteQuestionsForRecord(uid, record.id);
  await writeLearningRecords(uid, [record]);
}

async function deleteLearningRecord(uid, recordId) {
  await deleteQuestionsForRecord(uid, recordId);
  await Promise.all([
    deleteDoc(doc(db, 'users', uid, 'records', recordId)),
    deleteDoc(doc(db, 'users', uid, 'items', recordId)),
  ]);
}

function getStats(store, id) {
  const stats = store.stats[id] || { total: 0, correct: 0, wrong: 0 };
  const rate = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;
  let level = '學習中';
  if (stats.total >= 2 && rate < 55) level = '不熟悉';
  if (stats.total >= 3 && rate >= 75) level = '熟悉';
  if (stats.total >= 6 && rate >= 90) level = '已熟練';
  return { ...stats, rate, level };
}

function getProgress(store, question) {
  const saved = store.progress[question.id];
  if (saved) return saved;
  return {
    stage: 0,
    nextDue: addDays(question.date, REVIEW_INTERVALS[0]),
    lastResult: null,
    lastAnsweredAt: null,
  };
}

function dueQuestions(store, questions, date = todayString()) {
  return questions.filter((question) => getProgress(store, question).nextDue <= date);
}

function orderReviewQuestions(questions) {
  const kindRank = { term: 0, example: 1 };
  return [...questions].sort((a, b) => {
    const kindDiff = (kindRank[a.kind] ?? 99) - (kindRank[b.kind] ?? 99);
    if (kindDiff) return kindDiff;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const aIndex = a.source?.index ?? 0;
    const bIndex = b.source?.index ?? 0;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.id.localeCompare(b.id);
  });
}

function reviewQuestions(questions) {
  return orderReviewQuestions(questions.filter((question) => question.kind === 'term' || question.kind === 'example'));
}

function groupTasks(store, questions, date = todayString()) {
  const groups = new Map();
  dueQuestions(store, questions, date).forEach((question) => {
    const progress = getProgress(store, question);
    const key = `${question.date}-${progress.nextDue}`;
    const existing = groups.get(key) || {
      id: key,
      studyDate: question.date,
      dueDate: progress.nextDue,
      questions: [],
      overdue: progress.nextDue < date,
    };
    existing.questions.push(question);
    existing.overdue = existing.overdue || progress.nextDue < date;
    groups.set(key, existing);
  });
  return [...groups.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function markReviewDateComplete(store, date = todayString()) {
  const completedReviewDates = store.completedReviewDates || [];
  if (completedReviewDates.includes(date)) return store;
  return {
    ...store,
    completedReviewDates: [...completedReviewDates, date].sort(),
  };
}

function toggleStarredItem(updateStore, itemId) {
  updateStore((current) => {
    const starred = current.starred || [];
    const nextStarred = starred.includes(itemId)
      ? starred.filter((id) => id !== itemId)
      : [...starred, itemId];
    return { ...current, starred: nextStarred };
  });
}

function calculateReviewStreaks(completedReviewDates, today = todayString()) {
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

function recordAnswer(store, question, correct) {
  const now = new Date().toISOString();
  const previous = getProgress(store, question);
  const stage = correct ? Math.min(previous.stage + 1, REVIEW_INTERVALS.length - 1) : 0;
  return {
    ...store,
    stats: {
      ...store.stats,
      [question.id]: {
        total: (store.stats[question.id]?.total || 0) + 1,
        correct: (store.stats[question.id]?.correct || 0) + (correct ? 1 : 0),
        wrong: (store.stats[question.id]?.wrong || 0) + (correct ? 0 : 1),
        lastAnsweredAt: now,
        lastResult: correct ? 'correct' : 'wrong',
      },
    },
    progress: {
      ...store.progress,
      [question.id]: {
        stage,
        nextDue: addDays(todayString(), REVIEW_INTERVALS[stage]),
        lastAnsweredAt: now,
        lastResult: correct ? 'correct' : 'wrong',
      },
    },
    attempts: [{ id: crypto.randomUUID(), questionId: question.id, correct, time: now }, ...store.attempts].slice(0, 300),
  };
}

function normalizeAnswer(text) {
  return [...text.replace(PUNCTUATION_RE, '')];
}

function countKoreanLetters(text) {
  return [...text].filter((char) => /\p{Script=Hangul}/u.test(char)).length;
}

function compareAnswer(input, answer) {
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

function MasteryBadge({ level }) {
  return <span className={`badge mastery-${level}`}>{level}</span>;
}

function speakText(text, lang) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = lang.startsWith('ko') ? 0.9 : 1;
  window.speechSynthesis.speak(utterance);
}

function speakAnswer(question) {
  if (!('speechSynthesis' in window) || !question) return;
  const entries = [
    { text: question.ko, lang: 'ko-KR', rate: 0.9 },
    { text: question.zh, lang: 'zh-TW', rate: 1 },
  ].filter((entry) => entry.text);
  if (!entries.length) return;
  window.speechSynthesis.cancel();
  let index = 0;
  const playNext = () => {
    const entry = entries[index];
    if (!entry) return;
    const utterance = new SpeechSynthesisUtterance(entry.text);
    utterance.lang = entry.lang;
    utterance.rate = entry.rate;
    utterance.onend = () => {
      index += 1;
      playNext();
    };
    window.speechSynthesis.speak(utterance);
  };
  playNext();
}

function playResultSound(correct) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const now = context.currentTime;
  const notes = correct
    ? [
        { frequency: 660, start: 0, duration: 0.12 },
        { frequency: 880, start: 0.13, duration: 0.16 },
      ]
    : [
        { frequency: 220, start: 0, duration: 0.16 },
        { frequency: 165, start: 0.14, duration: 0.18 },
      ];
  notes.forEach(({ frequency, start, duration }) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = correct ? 'sine' : 'sawtooth';
    oscillator.frequency.setValueAtTime(frequency, now + start);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(correct ? 0.12 : 0.08, now + start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + duration + 0.02);
  });
  window.setTimeout(() => context.close(), 520);
}

function shuffleItems(items, seed) {
  const result = [...items];
  let value = seed || 1;
  for (let i = result.length - 1; i > 0; i -= 1) {
    value = (value * 9301 + 49297) % 233280;
    const j = Math.floor((value / 233280) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function shuffleReviewQuestionsByKind(questions, seed = Date.now()) {
  const terms = questions.filter((question) => question.kind === 'term');
  const examples = questions.filter((question) => question.kind === 'example');
  const others = questions.filter((question) => question.kind !== 'term' && question.kind !== 'example');
  return [
    ...shuffleItems(terms, seed),
    ...shuffleItems(examples, seed + 17),
    ...shuffleItems(others, seed + 31),
  ];
}

function App() {
  const { loading: authLoading, user } = useAuthUser();
  const [store, updateStore, storeLoading, storeError] = useFirestoreStore(user);
  const [page, setPage] = useState('home');
  const [pageStack, setPageStack] = useState([]);
  const [selectedDate, setSelectedDate] = useState(STUDY_DATE);
  const [practiceSet, setPracticeSet] = useState(null);
  const [studySet, setStudySet] = useState(null);
  const allRecords = useMemo(() => {
    const byId = new Map();
    (store.customRecords || []).forEach((record) => byId.set(record.id, record));
    (store.deletedRecordIds || []).forEach((id) => byId.delete(id));
    return [...byId.values()];
  }, [store.customRecords, store.deletedRecordIds]);
  const { items, questions } = useMemo(() => normalizeRecords(allRecords), [allRecords]);
  const dailyQuestions = useMemo(() => reviewQuestions(questions), [questions]);
  const completedAttemptDates = useMemo(
    () => [...new Set((store.attempts || []).map((attempt) => attempt.time?.slice(0, 10)).filter(Boolean))],
    [store.attempts],
  );

  useEffect(() => {
    if (!user || storeLoading) return;
    const today = todayString();
    const backfillDates = completedAttemptDates.filter(
      (date) => date >= REVIEW_COMPLETION_BACKFILL_START && date <= REVIEW_COMPLETION_BACKFILL_END && dueQuestions(store, dailyQuestions, date).length === 0,
    );
    const datesToMark = [...backfillDates];
    if (dueQuestions(store, dailyQuestions, today).length === 0) datesToMark.push(today);

    const missingDates = [...new Set(datesToMark)].filter((date) => !(store.completedReviewDates || []).includes(date));
    if (!missingDates.length) return;
    updateStore((current) => missingDates.reduce((nextStore, date) => markReviewDateComplete(nextStore, date), current));
  }, [user, storeLoading, store.completedReviewDates, store.progress, completedAttemptDates, dailyQuestions, updateStore]);

  const navTop = (next) => {
    setPageStack([]);
    setPage(next);
  };
  const navChild = (next) => {
    setPageStack((stack) => [...stack, page]);
    setPage(next);
  };
  const goUp = () => {
    if (!pageStack.length) return;
    setPage(pageStack[pageStack.length - 1]);
    setPageStack(pageStack.slice(0, -1));
  };
  const startPractice = (sourceQuestions, label, options = {}) => {
    setPracticeSet({ questions: sourceQuestions, label, dueOnly: !!options.dueOnly, recordResults: options.recordResults ?? true });
    navChild('practice');
  };
  const startStudy = (sourceItems, label) => {
    setStudySet({ items: sourceItems, label });
    navChild('study');
  };
  const addLearningRecords = async (records) => {
    await updateStore((current) => ({
      ...current,
      customRecords: [...(current.customRecords || []), ...records],
    }));
    await writeLearningRecords(user.uid, records);
  };
  const updateLearningRecord = async (record) => {
    await updateStore((current) => {
      const records = [...(current.customRecords || [])];
      const index = records.findIndex((existing) => existing.id === record.id);
      if (index >= 0) records[index] = record;
      else records.push(record);
      return { ...current, customRecords: records };
    });
    await writeLearningRecord(user.uid, record);
  };
  const deleteLearningRecordFromStore = async (recordId) => {
    await updateStore((current) => ({
      ...current,
      customRecords: (current.customRecords || []).filter((record) => record.id !== recordId),
      deletedRecordIds: [...new Set([...(current.deletedRecordIds || []), recordId])],
      stats: Object.fromEntries(Object.entries(current.stats || {}).filter(([id]) => id !== recordId && !id.startsWith(`${recordId}-`))),
      progress: Object.fromEntries(Object.entries(current.progress || {}).filter(([id]) => id !== recordId && !id.startsWith(`${recordId}-`))),
      learning: Object.fromEntries(Object.entries(current.learning || {}).filter(([id]) => id !== recordId)),
      attempts: (current.attempts || []).filter((attempt) => attempt.questionId !== recordId && !attempt.questionId?.startsWith(`${recordId}-`)),
      starred: (current.starred || []).filter((id) => id !== recordId),
    }));
    await deleteLearningRecord(user.uid, recordId);
  };

  if (authLoading) return <LoadingScreen text="正在確認登入狀態" />;
  if (!user) return <LoginPage />;
  if (storeLoading) return <LoadingScreen text="載入資料中" />;

  const views = {
    home: <HomePage store={store} items={items} questions={dailyQuestions} onPractice={startPractice} onStudy={startStudy} />,
    calendar: <CalendarPage store={store} items={items} questions={questions} selectedDate={selectedDate} setSelectedDate={setSelectedDate} onOpenNotes={() => navChild('notes')} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onDeleteRecord={deleteLearningRecordFromStore} />,
    notes: <NotesPage store={store} updateStore={updateStore} items={items.filter((item) => item.date === selectedDate)} questions={questions.filter((q) => q.date === selectedDate)} date={selectedDate} allItems={items} onPractice={startPractice} onStudy={startStudy} onUpdateRecord={updateLearningRecord} onDeleteRecord={deleteLearningRecordFromStore} />,
    study: <StudyPage store={store} updateStore={updateStore} set={studySet || { items, label: '全部內容' }} />,
    practice: <PracticePage store={store} updateStore={updateStore} set={practiceSet || { questions: dailyQuestions, label: '今日測驗', dueOnly: true }} />,
    notebook: <NotebookPage store={store} updateStore={updateStore} items={items} questions={questions} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onDeleteRecord={deleteLearningRecordFromStore} />,
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <button className={`brand brand-button ${page === 'home' ? 'active' : ''}`} onClick={() => navTop('home')}><Sparkles size={24} /> 韓文筆記</button>
        <button className={page === 'calendar' || page === 'notes' ? 'active' : ''} onClick={() => navTop('calendar')}><CalendarDays size={18} /> 日曆</button>
        <button className={page === 'notebook' ? 'active' : ''} onClick={() => navTop('notebook')}><LibraryBig size={18} /> 單字本</button>
        <button className="logout-button" onClick={() => signOut(auth)}><LogOut size={18} /> 登出</button>
      </aside>
      <main>
        {storeError && <div className="sync-error">Firebase 同步失敗：{storeError}</div>}
        {!!pageStack.length && <button className="back-button" onClick={goUp}><ChevronLeft size={18} /> 返回上一層</button>}
        {views[page]}
      </main>
    </div>
  );
}

function LoadingScreen({ text }) {
  return (
    <section className="login-page">
      <div className="panel login-card">
        <div className="brand"><Sparkles size={24} /> 韓文筆記</div>
        <p>{text}...</p>
      </div>
    </section>
  );
}

function LoginPage() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const switchMode = (next) => { setMode(next); setError(''); };

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="login-page">
      <form className="panel login-card" onSubmit={submit}>
        <div className="brand"><Sparkles size={24} /> 韓文筆記</div>
        <h1>{mode === 'login' ? '登入後開始測驗' : '建立新帳號'}</h1>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label>
          密碼
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required minLength={6} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary wide" disabled={loading}>
          {loading ? (mode === 'login' ? '登入中…' : '建立中…') : (mode === 'login' ? '登入' : '建立帳號')}
        </button>
        <button type="button" className="text-link" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '還沒有帳號？建立新帳號' : '已有帳號？返回登入'}
        </button>
      </form>
    </section>
  );
}

function HomePage({ store, items, questions, onPractice, onStudy }) {
  const today = todayString();
  const tasks = groupTasks(store, questions, today);
  const due = dueQuestions(store, questions, today);
  const answeredToday = store.attempts.filter((attempt) => attempt.time.startsWith(today));
  const correctToday = answeredToday.filter((attempt) => attempt.correct).length;
  const weak = questions.filter((question) => getStats(store, question.id).level === '不熟悉').slice(0, 6);
  const mastered = questions.filter((question) => getStats(store, question.id).level === '已熟練').length;
  const progress = due.length ? Math.max(0, Math.round((answeredToday.length / (answeredToday.length + due.length)) * 100)) : 100;

  return (
    <section className="page">
      <div className="hero">
        <div>
          <span className="eyebrow">Today · {dateLabel(today)}</span>
          <h1>今天也來練一點韓文</h1>
          <p>目前有 {due.length} 題等待主動回想，答錯會自動回到第一階段重新安排。</p>
          <div className="actions">
            <button className="primary" disabled={!due.length} onClick={() => onPractice(due, '今日測驗', { dueOnly: true })}><Dumbbell size={18} /> 開始今日測驗</button>
            <button onClick={() => onStudy(items, '全部內容')}><BookOpen size={18} /> 先用單字卡學習</button>
          </div>
        </div>
        <div className="hero-meter">
          <div className="ring" style={{ '--progress': `${progress}%` }}>{progress}%</div>
          <span>今日完成度</span>
        </div>
      </div>

      <div className="stats-grid">
        <Stat icon={<Target />} label="待測驗" value={`${due.length} 題`} />
        <Stat icon={<Check />} label="今日答對" value={`${correctToday}/${answeredToday.length || 0}`} />
        <Stat icon={<Trophy />} label="已熟練" value={`${mastered} 題`} />
        <Stat icon={<Flame />} label="不熟悉" value={`${weak.length} 題`} />
      </div>

      <div className="split">
        <div className="panel">
          <div className="panel-title"><h2>測驗任務</h2><span>{tasks.length ? '未完成任務會保留' : '目前沒有到期任務'}</span></div>
          <div className="task-list">
            {tasks.map((task) => (
              <div className="task-card" key={task.id}>
                <div>
                  <span className={task.overdue ? 'badge danger' : 'badge'}>{task.overdue ? '逾期' : '今日'}</span>
                  <h3>{dateLabel(task.studyDate)} 的內容</h3>
                  <p>到期日 {task.dueDate} · {task.questions.length} 題 · 未完成</p>
                </div>
                <button className="primary small" onClick={() => onPractice(task.questions, `${task.studyDate} 測驗`, { dueOnly: true })}>開始</button>
              </div>
            ))}
            {!tasks.length && <div className="empty">今天沒有排程到期。你可以從日曆或單字本主動測驗。</div>}
          </div>
        </div>
        <div className="panel">
          <div className="panel-title"><h2>不熟悉清單</h2><span>依答題紀錄更新</span></div>
          {weak.length ? weak.map((question) => <MiniQuestion key={question.id} question={question} store={store} />) : <div className="empty">還沒有被標記為不熟悉的內容。</div>}
          <button className="wide" disabled={!weak.length} onClick={() => onPractice(weak, '不熟悉加強')}>測驗不熟悉內容</button>
        </div>
      </div>
    </section>
  );
}

function Stat({ icon, label, value }) {
  return <div className="stat">{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function CalendarPage({ store, items, questions, selectedDate, setSelectedDate, onOpenNotes, onAddRecords, onUpdateRecord, onDeleteRecord }) {
  const [cursor, setCursor] = useState(new Date(`${selectedDate}T00:00:00`));
  const [addOpen, setAddOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [jsonEditOpen, setJsonEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const completedDates = new Set(store.completedReviewDates || []);
  const streaks = calculateReviewStreaks(store.completedReviewDates || []);
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const days = [];
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const today = todayString();
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = toDateKey(date);
    days.push({
      key,
      day: date.getDate(),
      current: date.getMonth() === cursor.getMonth(),
      hasStudy: items.some((item) => item.date === key),
      isToday: key === today,
      hasCompletedReview: completedDates.has(key),
    });
  }
  const selectedItems = items.filter((item) => item.date === selectedDate);
  const deleteSelectedDateItems = async () => {
    if (!selectedItems.length) return;
    const confirmed = window.confirm(`確定要刪除 ${selectedDate} 的 ${selectedItems.length} 筆單字嗎？這不會刪除其他日期的單字。`);
    if (!confirmed) return;
    await Promise.all(selectedItems.map((item) => onDeleteRecord(item.id)));
  };

  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Calendar</span><h1>學習日曆</h1></div>
        <div className="month-controls">
          <button className="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft /></button>
          <strong>{monthTitle(cursor)}</strong>
          <button className="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight /></button>
          <button className="today-jump" onClick={() => {
            const todayDate = todayString();
            setCursor(new Date(`${todayDate}T00:00:00`));
            setSelectedDate(todayDate);
          }}>今天</button>
        </div>
      </div>
      <div className="calendar-layout">
        <div className="calendar-grid">
          {['日', '一', '二', '三', '四', '五', '六'].map((d) => <b key={d}>{d}</b>)}
          {days.map((day) => (
            <button key={day.key} className={`day ${day.current ? '' : 'muted'} ${day.hasStudy ? 'has-study' : ''} ${day.isToday ? 'today' : ''} ${day.key === selectedDate ? 'selected' : ''}`} onClick={() => setSelectedDate(day.key)}>
              <span>{day.day}</span>
              {day.hasCompletedReview && <span className="day-flame"><Flame /></span>}
            </button>
          ))}
        </div>
        <div className="panel">
          <div className="calendar-streaks">
            <div>
              <span>目前連勝</span>
              <strong><Flame size={18} /> {streaks.current} 天</strong>
            </div>
            <div>
              <span>歷史最長</span>
              <strong><Trophy size={18} /> {streaks.best} 天</strong>
            </div>
          </div>
          <div className="panel-title"><h2>{selectedDate}</h2><span>{selectedItems.length} 筆內容</span></div>
          {selectedItems.slice(0, 5).map((item) => <NotePreview key={item.id} item={item} />)}
          <div className="calendar-day-actions">
            <button className="primary wide" disabled={!selectedItems.length} onClick={onOpenNotes}>查看單字</button>
            <button className="wide add-date-button" onClick={() => setAddOpen(true)}>新增單字</button>
            <button className="wide export-date-button" disabled={!selectedItems.length} onClick={() => setExportOpen(true)}><Download size={18} /> 匯出這天單字</button>
            <button className="wide edit-json-button" disabled={!selectedItems.length} onClick={() => setJsonEditOpen(true)}><Pencil size={18} /> 修改 JSON 內容</button>
            <button className="wide danger-soft" disabled={!selectedItems.length} onClick={deleteSelectedDateItems}>刪除這天所有單字</button>
          </div>
        </div>
      </div>
      {exportOpen && <ExportJsonModal items={selectedItems} title={`匯出 ${selectedDate} JSON`} onClose={() => setExportOpen(false)} />}
      {jsonEditOpen && (
        <EditJsonModal
          items={selectedItems}
          allItems={items}
          date={selectedDate}
          onSave={async (records) => {
            await Promise.all(records.map((record) => onUpdateRecord(record)));
            setJsonEditOpen(false);
          }}
          onClose={() => setJsonEditOpen(false)}
        />
      )}
      {addOpen && (
        <AddItemsModal
          title="新增這一天的單字"
          date={selectedDate}
          lockedDate
          allItems={items}
          onAddRecords={onAddRecords}
          onUpdateRecord={onUpdateRecord}
          onEditExisting={(item) => {
            setAddOpen(false);
            setEditingItem(item);
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
      {editingItem && (
        <AddItemsModal
          title="編輯單字"
          date={editingItem.date}
          lockedDate
          editItem={editingItem}
          allItems={items}
          onUpdateRecord={onUpdateRecord}
          onClose={() => setEditingItem(null)}
        />
      )}
    </section>
  );
}

function NotesPage({ store, updateStore, items, questions, date, allItems, onPractice, onStudy, onUpdateRecord, onDeleteRecord }) {
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);
  const starredSet = new Set(store.starred || []);
  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Notes · {dateLabel(date)}</span><h1>日期筆記</h1></div>
        <div className="actions">
          <button onClick={() => onStudy(items, `${date} 學習`)}><BookOpen size={18} /> 開始學習</button>
          <button className="primary" onClick={() => onPractice(questions, `${date} 測驗`)}><Dumbbell size={18} /> 開始測驗</button>
        </div>
      </div>
      {editingItem && (
        <AddItemsModal
          title="編輯單字"
          date={editingItem.date}
          lockedDate
          editItem={editingItem}
          allItems={allItems}
          onUpdateRecord={onUpdateRecord}
          onDeleteRecord={onDeleteRecord}
          onClose={() => setEditingItem(null)}
        />
      )}
      {viewingItem && (
        <ItemDetailModal
          item={viewingItem}
          allItems={allItems}
          isStarred={starredSet.has(viewingItem.id)}
          onToggleStar={() => toggleStarredItem(updateStore, viewingItem.id)}
          onOpenItem={setViewingItem}
          onEdit={(item) => {
            setViewingItem(null);
            setEditingItem(item);
          }}
          onDelete={onDeleteRecord}
          onClose={() => setViewingItem(null)}
        />
      )}
      <div className="notes-grid">{items.map((item) => (
        <NoteCard
          key={item.id}
          item={item}
          allItems={allItems}
          compact
          onOpen={setViewingItem}
          onEdit={setEditingItem}
          onDelete={onDeleteRecord}
          isStarred={starredSet.has(item.id)}
          onToggleStar={() => toggleStarredItem(updateStore, item.id)}
        />
      ))}</div>
    </section>
  );
}

function NotePreview({ item }) {
  return <div className="mini"><strong>{item.ko}</strong><span>{item.zh}</span></div>;
}

function AddItemsPanel({ title, date, lockedDate = false, onAddRecords, allItems = [] }) {
  return <AddItemsForm title={title} date={date} lockedDate={lockedDate} onAddRecords={onAddRecords} allItems={allItems} />;
}

function AddItemsModal({ title, date, lockedDate = false, onAddRecords, onUpdateRecord, onEditExisting, editItem, allItems = [], onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <AddItemsForm
          title={title}
          date={date}
          lockedDate={lockedDate}
          onAddRecords={onAddRecords}
          onUpdateRecord={onUpdateRecord}
          onEditExisting={onEditExisting}
          editItem={editItem}
          allItems={allItems}
          onSaved={onClose}
          compactPanel
        />
      </div>
    </div>
  );
}

function AddItemsForm({ title, date, lockedDate = false, onAddRecords, onUpdateRecord, onEditExisting, editItem, allItems = [], onSaved, compactPanel = false }) {
  const isEditing = Boolean(editItem);
  const [mode, setMode] = useState('manual');
  const [formDate, setFormDate] = useState(date);
  const [jsonText, setJsonText] = useState('');
  const [importDraft, setImportDraft] = useState(null);
  const [manual, setManual] = useState(() => itemToManual(editItem));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFormDate(date);
    setManual(itemToManual(editItem));
    setMode('manual');
    setImportDraft(null);
  }, [date, editItem]);

  const commitImportEntries = async (entries, targetDate) => {
    const activeEntries = entries.filter(Boolean);
    if (!activeEntries.length) {
      setMessage('沒有需要匯入或更新的資料');
      return;
    }
    if (activeEntries.some((entry) => entry.action === 'update') && !onUpdateRecord) {
      throw new Error('這裡無法更新既有單字，請從單字本重新匯入');
    }
    const { addRecords, updateRecords } = createRecordsFromImportEntries(activeEntries, targetDate, allItems);
    if (addRecords.length) await onAddRecords(addRecords);
    await Promise.all(updateRecords.map((record) => onUpdateRecord(record)));
    setMessage(`已匯入 ${addRecords.length} 筆，更新 ${updateRecords.length} 筆`);
    setJsonText('');
    setImportDraft(null);
  };

  const continueImportDraft = async (draft) => {
    const activeEntries = draft.entries.filter(Boolean);
    const conflict = findImportConflict(activeEntries, allItems);
    if (conflict) {
      setImportDraft({ ...draft, entries: activeEntries, conflict, missingRelated: null, message: '' });
      setError('');
      return;
    }
    const missingRelated = findMissingImportRelated(activeEntries, allItems);
    if (missingRelated.length) {
      setImportDraft({ ...draft, entries: activeEntries, conflict: null, missingRelated, message: '' });
      setError('');
      return;
    }
    await commitImportEntries(activeEntries, draft.targetDate);
    if (onSaved) setTimeout(onSaved, 450);
  };

  const handleContinueImportDraft = async () => {
    setSaving(true);
    setError('');
    try {
      await continueImportDraft(importDraft);
    } catch (continueError) {
      setError(continueError.message);
    } finally {
      setSaving(false);
    }
  };

  const updateInvalidText = (issueIndex, text) => {
    setImportDraft((draft) => ({
      ...draft,
      invalid: draft.invalid.map((issue) => (issue.index === issueIndex ? { ...issue, text } : issue)),
    }));
  };

  const applyInvalidFix = (issueIndex) => {
    setImportDraft((draft) => {
      const issue = draft.invalid.find((entry) => entry.index === issueIndex);
      try {
        const item = parseEditedImportItem(issue.text);
        const nextEntries = [...draft.entries];
        nextEntries[issueIndex] = { index: issueIndex, action: 'add', item };
        const nextInvalid = draft.invalid.filter((entry) => entry.index !== issueIndex);
        const nextConflict = nextInvalid.length ? null : findImportConflict(nextEntries.filter(Boolean), allItems);
        const nextMissingRelated = !nextInvalid.length && !nextConflict ? findMissingImportRelated(nextEntries.filter(Boolean), allItems) : [];
        return {
          ...draft,
          entries: nextEntries,
          invalid: nextInvalid,
          conflict: nextConflict,
          missingRelated: nextMissingRelated.length ? nextMissingRelated : null,
          message: nextConflict ? '格式問題已修正，請繼續處理重複單字' : nextMissingRelated.length ? '格式問題已修正，請處理找不到的關聯詞' : '已套用修正',
        };
      } catch (validationError) {
        return {
          ...draft,
          invalid: draft.invalid.map((entry) => (entry.index === issueIndex ? { ...entry, error: validationError.message } : entry)),
        };
      }
    });
  };

  const updateConflictText = (text) => {
    setImportDraft((draft) => ({ ...draft, conflict: { ...draft.conflict, editText: text, error: '' } }));
  };

  const resolveConflict = (choice) => {
    setImportDraft((draft) => {
      try {
        const conflict = draft.conflict;
        const nextEntries = [...draft.entries];
        const editedItem = choice === 'edit' ? parseEditedImportItem(conflict.editText, '最終結果') : null;
        if (conflict.type === 'existing') {
          if (choice === 'existing') {
            nextEntries[conflict.entryIndex] = null;
          } else {
            const item = choice === 'incoming' ? conflict.incoming : choice === 'merge' ? mergeImportItems(conflict.existing, conflict.incoming) : editedItem;
            nextEntries[conflict.entryIndex] = { index: conflict.entryIndex, action: 'update', existing: conflict.existing, item };
          }
        } else {
          if (choice === 'left') {
            nextEntries[conflict.rightEntryIndex] = null;
          } else if (choice === 'right') {
            nextEntries[conflict.leftEntryIndex] = { ...nextEntries[conflict.rightEntryIndex], index: conflict.leftEntryIndex };
            nextEntries[conflict.rightEntryIndex] = null;
          } else {
            const item = choice === 'merge' ? mergeImportItems(conflict.left, conflict.right) : editedItem;
            nextEntries[conflict.leftEntryIndex] = { ...nextEntries[conflict.leftEntryIndex], item };
            nextEntries[conflict.rightEntryIndex] = null;
          }
        }
        const activeEntries = nextEntries.filter(Boolean);
        const nextConflict = findImportConflict(activeEntries, allItems);
        const nextMissingRelated = nextConflict ? [] : findMissingImportRelated(activeEntries, allItems);
        return {
          ...draft,
          entries: activeEntries,
          conflict: nextConflict,
          missingRelated: nextMissingRelated.length ? nextMissingRelated : null,
          message: nextConflict ? '已處理一組重複單字，請繼續處理下一組' : nextMissingRelated.length ? '重複單字已處理，請處理找不到的關聯詞' : '所有問題都已處理，可以匯入',
        };
      } catch (validationError) {
        return { ...draft, conflict: { ...draft.conflict, error: validationError.message } };
      }
    });
  };

  const clearMissingRelatedAndContinue = () => {
    setImportDraft((draft) => ({
      ...draft,
      entries: clearMissingImportRelated(draft.entries, draft.missingRelated || []),
      missingRelated: null,
      message: '已清空找不到的關聯詞，可以繼續匯入',
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    setDuplicates([]);
    setSaving(true);
    try {
      const targetDate = lockedDate ? date : formDate;
      if (isEditing) {
        const record = {
          id: editItem.id,
          date: editItem.date,
          item: mergeEditedItem(editItem, manual, allItems),
          createdAt: editItem.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await onUpdateRecord(record);
        setMessage('已更新單字');
      } else {
        if (mode === 'json') {
          const draft = buildJsonImportDraft(jsonText, targetDate);
          if (draft.invalid.length) {
            setImportDraft(draft);
            setError('有資料不符合匯入格式，請先修正。修正完成前不會匯入任何資料。');
            return;
          }
          const conflict = findImportConflict(draft.entries, allItems);
          if (conflict) {
            setImportDraft({ ...draft, conflict });
            setError('發現重複韓文單字，請先選擇處理方式。處理完成前不會匯入任何資料。');
            return;
          }
          await continueImportDraft(draft);
          return;
        }
        const rawItems = [manualToItem(manual, allItems)];
        const repeatedInInput = rawItems.map((item) => item.ko.trim()).filter((ko, index, list) => list.indexOf(ko) !== index);
        if (repeatedInInput.length) {
          setError(`這次新增內容中有重複韓文：${[...new Set(repeatedInInput)].join('、')}`);
          return;
        }
        const existing = rawItems
          .map((rawItem) => allItems.find((item) => item.ko.trim() === rawItem.ko.trim()))
          .filter(Boolean);
        if (existing.length) {
          setDuplicates(existing);
          setError('不能新增重複韓文單字。請直接編輯既有單字卡。');
          return;
        }
        const records = createRecordsForDate(targetDate, rawItems, allItems);
        await onAddRecords(records);
        setMessage(`已新增 ${records.length} 筆到 ${targetDate}`);
        setManual(itemToManual());
      }
      if (onSaved) setTimeout(onSaved, 450);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={`${compactPanel ? '' : 'panel'} add-panel`} onSubmit={submit}>
      <div className="panel-title">
        <div><h2>{title}</h2><span>{isEditing ? '修改後會覆蓋這筆單字資料' : '可貼上整份 JSON，或手動新增一筆'}</span></div>
        {!isEditing && <div className="segmented compact">
          <button type="button" className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>手動填寫</button>
          <button type="button" className={mode === 'json' ? 'active' : ''} onClick={() => setMode('json')}>貼上 JSON</button>
        </div>}
      </div>

      {importDraft ? (
        <ImportReviewPanel
          draft={importDraft}
          onUpdateInvalidText={updateInvalidText}
          onApplyInvalidFix={applyInvalidFix}
          onContinue={handleContinueImportDraft}
          onUpdateConflictText={updateConflictText}
          onResolveConflict={resolveConflict}
          onClearMissingRelated={clearMissingRelatedAndContinue}
          onCancel={() => {
            setImportDraft(null);
            setError('');
            setMessage('已放棄這次匯入，沒有寫入任何資料');
          }}
        />
      ) : <div className="form-grid">
        <label>
          日期
          <input type="date" value={isEditing ? editItem.date : lockedDate ? date : formDate} onChange={(event) => setFormDate(event.target.value)} disabled={lockedDate || isEditing} required />
        </label>
        {mode === 'manual' ? (
          <>
            <label>
              韓文 *
              <input value={manual.ko} onChange={(event) => setManual({ ...manual, ko: event.target.value })} required />
            </label>
            <label>
              中文 *
              <input value={manual.zh} onChange={(event) => setManual({ ...manual, zh: event.target.value })} required />
            </label>
            <label>
              詞性 / 類型
              <select value={manual.pos} onChange={(event) => setManual({ ...manual, pos: event.target.value })}>
                <option value="">不指定</option>
                {['名詞', '動詞', '形容詞', '副詞', '片語', '動詞片語', '句子', '文法', '比較'].map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label>
              常見句型 / 搭配
              <input value={manual.pattern} onChange={(event) => setManual({ ...manual, pattern: event.target.value })} />
            </label>
            <label className="wide-field">
              例句
              <textarea value={manual.examples} onChange={(event) => setManual({ ...manual, examples: event.target.value })} placeholder="每行一筆：韓文 | 中文" />
            </label>
            <label className="wide-field">
              補充說明
              <textarea value={manual.notes} onChange={(event) => setManual({ ...manual, notes: event.target.value })} placeholder="每行一筆說明" />
            </label>
            <RelatedSelector manual={manual} setManual={setManual} allItems={allItems} editItem={editItem} />
          </>
        ) : (
          <label className="wide-field">
            JSON 內容
            <textarea className="json-input" value={jsonText} onChange={(event) => setJsonText(event.target.value)} placeholder='{ "data": [{ "ko": "뉴스", "pos": "名詞", "meanings": [{ "zh": "新聞", "examples": [] }] }] }' required />
          </label>
        )}
      </div>}

      {message && <div className="form-success">{message}</div>}
      {error && <div className="form-error">{error}</div>}
      {!!duplicates.length && (
        <div className="duplicate-list">
          {duplicates.map((item) => (
            <button type="button" key={item.id} onClick={() => onEditExisting?.(item)}>
              <strong>{item.ko}</strong><span>{item.zh}</span><small>{item.date}</small>
            </button>
          ))}
        </div>
      )}
      {!importDraft && <div className="form-actions">
        <button className="primary" disabled={saving}>{saving ? '儲存中' : isEditing ? '儲存修改' : '新增到單字庫'}</button>
      </div>}
    </form>
  );
}

function ImportReviewPanel({ draft, onUpdateInvalidText, onApplyInvalidFix, onContinue, onUpdateConflictText, onResolveConflict, onClearMissingRelated, onCancel }) {
  const pendingCount = draft.entries.filter(Boolean).length;
  return (
    <div className="import-review">
      <div className="import-review-head">
        <div>
          <strong>匯入預檢</strong>
          <span>{pendingCount} 筆待匯入 / {draft.invalid.length} 筆需要修正</span>
        </div>
        <button type="button" className="danger-soft" onClick={onCancel}>放棄匯入</button>
      </div>

      {!!draft.invalid.length && (
        <div className="import-section">
          <h3>不符合規定的資料</h3>
          <p>請逐筆修正後按「套用修正」。全部修正完成前，不會匯入任何資料。</p>
          {draft.invalid.map((issue) => (
            <div className="import-fix-card" key={issue.index}>
              <div className="import-fix-title">
                <strong>第 {issue.index + 1} 筆</strong>
                <span>{issue.error}</span>
              </div>
              <textarea value={issue.text} onChange={(event) => onUpdateInvalidText(issue.index, event.target.value)} spellCheck="false" />
              <button type="button" onClick={() => onApplyInvalidFix(issue.index)}>套用修正</button>
            </div>
          ))}
        </div>
      )}

      {!draft.invalid.length && draft.conflict && (
        <ImportConflictResolver conflict={draft.conflict} onUpdateText={onUpdateConflictText} onResolve={onResolveConflict} />
      )}

      {!draft.invalid.length && !draft.conflict && !!draft.missingRelated?.length && (
        <ImportMissingRelatedPanel issues={draft.missingRelated} onClear={onClearMissingRelated} />
      )}

      {!draft.invalid.length && !draft.conflict && !draft.missingRelated?.length && (
        <div className="import-ready">
          <strong>所有問題都已處理</strong>
          <p>確認後會一次匯入新增資料，並更新你選擇合併或覆蓋的既有單字。</p>
          <button type="button" className="primary" onClick={onContinue}>全部匯入</button>
        </div>
      )}

      {!!draft.invalid.length && (
        <div className="form-actions">
          <button type="button" className="primary" disabled={!!draft.invalid.length} onClick={onContinue}>繼續檢查重複單字</button>
        </div>
      )}
    </div>
  );
}

function ImportMissingRelatedPanel({ issues, onClear }) {
  const missingCount = issues.reduce((sum, issue) => sum + issue.missing.length, 0);
  return (
    <div className="import-section missing-related-section">
      <h3>找不到 {missingCount} 個關聯詞</h3>
      <p>這些 related 沒有對應到既有單字，也沒有對應到這次匯入的單字。你可以清空這些無效關聯詞後繼續匯入，其他有效關聯詞會保留。</p>
      <div className="missing-related-list">
        {issues.map((issue) => (
          <div key={`${issue.position}-${issue.ko}`}>
            <strong>{issue.ko}</strong>
            <span>{issue.missing.join('、')}</span>
          </div>
        ))}
      </div>
      <div className="conflict-actions">
        <button type="button" className="primary" onClick={onClear}>清空這些關聯詞並繼續</button>
      </div>
    </div>
  );
}

function ImportConflictResolver({ conflict, onUpdateText, onResolve }) {
  const isExisting = conflict.type === 'existing';
  const leftLabel = isExisting ? '既有單字' : '匯入資料 A';
  const rightLabel = isExisting ? '匯入資料' : '匯入資料 B';
  const leftItem = isExisting ? conflict.existing : conflict.left;
  const rightItem = isExisting ? conflict.incoming : conflict.right;
  return (
    <div className="import-section">
      <h3>重複韓文單字：{rightItem.ko}</h3>
      <p>請選擇保留其中一邊、直接合併，或編輯最終結果。處理完成前不會匯入任何資料。</p>
      <div className="import-compare-grid">
        <ImportCompareCard label={leftLabel} item={leftItem} />
        <ImportCompareCard label={rightLabel} item={rightItem} />
      </div>
      <div className="conflict-actions">
        {isExisting ? (
          <>
            <button type="button" onClick={() => onResolve('existing')}>保留既有單字</button>
            <button type="button" onClick={() => onResolve('incoming')}>使用匯入資料取代</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onResolve('left')}>保留 A</button>
            <button type="button" onClick={() => onResolve('right')}>保留 B</button>
          </>
        )}
        <button type="button" onClick={() => onResolve('merge')}>直接合併</button>
      </div>
      <label className="import-final-editor">
        編輯最終結果
        <textarea value={conflict.editText} onChange={(event) => onUpdateText(event.target.value)} spellCheck="false" />
      </label>
      {conflict.error && <div className="form-error">{conflict.error}</div>}
      <button type="button" className="primary" onClick={() => onResolve('edit')}>使用編輯後結果</button>
    </div>
  );
}

function ImportCompareCard({ label, item }) {
  return (
    <div className="import-compare-card">
      <span>{label}</span>
      <strong>{item.ko}</strong>
      {item.pos && <small>{item.pos}</small>}
      <p>{itemZh(item)}</p>
      {!!item.meanings?.length && (
        <div className="import-meaning-list">
          {item.meanings.map((meaning, index) => (
            <div key={meaning.id || `${meaning.zh}-${index}`}>
              <b>{meaning.zh}</b>
              {!!meaning.examples?.length && <em>{meaning.examples.length} 個例句</em>}
            </div>
          ))}
        </div>
      )}
      {!!item.notes?.length && <p className="import-note">{item.notes.join(' / ')}</p>}
    </div>
  );
}

function RelatedSelector({ manual, setManual, allItems, editItem }) {
  const query = manual.relatedQuery || '';
  const selected = manual.relatedSelected || [];
  const selectedSet = new Set(selected);
  const results = allItems
    .filter((item) => item.id !== editItem?.id)
    .filter((item) => !selectedSet.has(item.id))
    .filter((item) => !query.trim() || `${item.ko} ${item.zh}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);
  return (
    <div className="wide-field related-selector">
      <label>
        相關詞
        <input value={query} onChange={(event) => setManual({ ...manual, relatedQuery: event.target.value })} placeholder="搜尋已有單字" />
      </label>
      {!!selected.length && (
        <div className="selected-related">
          {selected.map((id) => {
            const item = allItems.find((candidate) => candidate.id === id);
            return (
              <button type="button" key={id} onClick={() => setManual({ ...manual, relatedSelected: selected.filter((entry) => entry !== id) })}>
                {item?.ko || id}{item?.zh ? ` · ${item.zh}` : ''} ×
              </button>
            );
          })}
        </div>
      )}
      <div className="related-results">
        {results.map((item) => (
          <button type="button" key={item.id} onClick={() => setManual({ ...manual, relatedSelected: [...selected, item.id], relatedQuery: '' })}>
            <strong>{item.ko}</strong><span>{item.zh}</span>
          </button>
        ))}
        {query.trim() && !results.length && <div className="empty small-empty">找不到符合的既有單字</div>}
      </div>
    </div>
  );
}

function manualToItem(manual, allItems = []) {
  if (!manual.ko.trim() || !manual.zh.trim()) throw new Error('韓文和中文是必填');
  const item = {
    ko: manual.ko.trim(),
    meanings: [{
      ...(manual.meaningId ? { id: manual.meaningId } : {}),
      zh: manual.zh.trim(),
      ...(manual.pattern.trim() ? { pattern: manual.pattern.trim() } : {}),
      examples: parsePairLines(manual.examples),
    }],
  };
  if (manual.pos) item.pos = manual.pos;
  const notesList = linesToArray(manual.notes);
  if (notesList.length) item.notes = notesList;
  const related = (manual.relatedSelected || []).filter((id) => allItems.some((candidate) => candidate.id === id));
  if (related.length) item.related = related;
  return item;
}

function itemToManual(item) {
  if (!item) {
    return { ko: '', zh: '', pos: '', pattern: '', examples: '', notes: '', relatedSelected: [], relatedQuery: '', meaningId: '' };
  }
  const primaryMeaning = item.meanings?.[0] || { zh: '', pattern: '', examples: [] };
  return {
    ko: item.ko || '',
    zh: primaryMeaning.zh || '',
    pos: item.pos || '',
    pattern: primaryMeaning.pattern || '',
    examples: (primaryMeaning.examples || []).map((example) => `${example.ko || ''} | ${example.zh || ''}`).join('\n'),
    notes: (item.notes || []).join('\n'),
    relatedSelected: (item.related || []).filter(Boolean),
    relatedQuery: '',
    meaningId: primaryMeaning.id || '',
  };
}

function mergeEditedItem(original, manual, allItems = []) {
  const edited = manualToItem(manual, allItems);
  const {
    id,
    date,
    index,
    createdAt,
    updatedAt,
    total,
    rate,
    level,
    ...content
  } = original;
  const next = { ...content, ...edited };
  ['pos', 'meanings', 'notes', 'related'].forEach((key) => {
    if (edited[key] === undefined) delete next[key];
  });
  return next;
}

function buildNotebookExport(items) {
  const cleanItems = items.map((item) => {
    const {
      date,
      index,
      createdAt,
      updatedAt,
      total,
      rate,
      level,
      zh,
      ...content
    } = item;
    return { date, ...content };
  });
  return JSON.stringify({ schemaVersion: CONTENT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: cleanItems }, null, 2);
}

function downloadNotebookJson(jsonText) {
  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `korean-notes-backup-${todayString()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function itemSearchText(item) {
  return [
    item.ko,
    item.zh,
    item.pos,
    item.date,
    ...(item.notes || []),
    ...(item.meanings || []).flatMap((meaning) => [meaning.zh, meaning.pattern, ...(meaning.examples || []).flatMap((example) => [example.ko, example.zh])]),
    ...(item.related || []),
    ...(item.components || []).flatMap((entry) => [entry.ko, entry.zh]),
    ...(item.items || []).flatMap((entry) => [entry.ko, entry.zh]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function EditIconButton({ onClick, label = '編輯' }) {
  return (
    <button
      className="edit-icon-button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
    >
      <Pencil size={15} />
    </button>
  );
}

function DeleteIconButton({ item, onDelete }) {
  if (!onDelete) return null;
  return (
    <button
      className="edit-icon-button delete-icon-button"
      onClick={async (event) => {
        event.stopPropagation();
        if (!window.confirm(`確定要刪除「${item.ko}」嗎？`)) return;
        await onDelete(item.id);
      }}
      aria-label="刪除"
      title="刪除"
    >
      <Trash2 size={15} />
    </button>
  );
}

function ItemDetailModal({ item, allItems = [], onEdit, onDelete, onOpenItem, onClose, isStarred = false, onToggleStar }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel detail-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <NoteCard item={item} allItems={allItems} onEdit={onEdit} onDelete={onDelete} onOpenItem={onOpenItem} isStarred={isStarred} onToggleStar={onToggleStar} />
      </div>
    </div>
  );
}

function StarButton({ active, onClick }) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      className={`star-button ${active ? 'active' : ''}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      aria-label={active ? '取消星號' : '打星號'}
      title={active ? '取消星號' : '打星號'}
    >
      <Star size={17} />
    </button>
  );
}

function NoteCard({ item, allItems = [], onEdit, onDelete, compact = false, onOpen, onOpenItem, isStarred = false, onToggleStar }) {
  const examplesCount = itemExamples(item).length;
  const relatedItems = displayRelated(item, allItems);
  return (
    <article className={`note-card ${compact ? 'compact-card clickable-card' : ''}`} onClick={compact ? () => onOpen(item) : undefined}>
      <div className="card-head">
        <h3>{item.ko}</h3>
        <div className="card-actions">
          <StarButton active={isStarred} onClick={onToggleStar} />
          {onEdit && <EditIconButton onClick={() => onEdit(item)} />}
          <DeleteIconButton item={item} onDelete={onDelete} />
          {item.pos && <span className="badge">{item.pos}</span>}
        </div>
      </div>
      <p className="zh">{item.zh}</p>
      {compact && (
        <div className="compact-meta">
          <span>{item.date}</span>
          {!!examplesCount && <span>{examplesCount} 個例句</span>}
          {!!item.notes?.length && <span>{item.notes.length} 則筆記</span>}
        </div>
      )}
      {!compact && <>
      <CardRichDetails item={item} relatedItems={relatedItems} onOpenItem={onOpenItem} />
      {!!item.components?.length && <div className="tags">{item.components.map((entry) => <span key={entry.ko}>{entry.ko} · {entry.zh}</span>)}</div>}
      {!!item.items?.length && <div className="subblock">{item.items.map((entry) => <p key={entry.ko}>{entry.ko}<br /><span>{entry.zh}</span></p>)}</div>}
      </>}
    </article>
  );
}

function CardRichDetails({ item, relatedItems = [], onOpenItem }) {
  return (
    <div className="rich-details">
      {!!item.meanings?.length && (
        <section className="detail-section meanings-section">
          <div className="detail-section-title"><span>意思</span><small>{item.meanings.length} 個</small></div>
          <div className="meaning-list">
            {item.meanings.map((meaning, index) => (
              <article key={meaning.id} className="meaning-block">
                <div className="meaning-head">
                  <span>{index + 1}</span>
                  <strong>{meaning.zh}</strong>
                </div>
                {meaning.pattern && <div className="meaning-pattern">{meaning.pattern}</div>}
                {!!meaning.examples?.length && (
                  <div className="example-list">
                    {meaning.examples.map((ex) => (
                      <div key={ex.id || ex.ko} className="example-row">
                        <p className="example-ko">{ex.ko}</p>
                        <p className="example-zh">{ex.zh}</p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {!!item.notes?.length && (
        <section className="detail-section note-section">
          <div className="detail-section-title"><span>筆記</span></div>
          <div className="note-list">
            {item.notes.map((note) => <p key={note}>{note}</p>)}
          </div>
        </section>
      )}
      {!!relatedItems.length && (
        <section className="detail-section related-section">
          <div className="detail-section-title"><span>相關詞</span></div>
          <div className="tags rich-tags">
            {relatedItems.map((entry) => <RelatedWordTag key={entry.id} item={entry} onOpenItem={onOpenItem} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function RelatedWordTag({ item, onOpenItem }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(null);
  const wrapRef = useRef(null);
  const touchPreviewRef = useRef(false);
  const label = `${item.ko}${item.zh ? ` · ${item.zh}` : ''}`;
  const Tag = onOpenItem ? 'button' : 'span';
  const updatePreviewPosition = () => {
    if (!wrapRef.current || window.matchMedia('(max-width: 920px)').matches) {
      setPreviewPosition(null);
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    const cardWidth = Math.min(360, window.innerWidth - 32);
    const edgePadding = 18;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, cardWidth / 2 + edgePadding),
      window.innerWidth - cardWidth / 2 - edgePadding,
    );
    const placeAbove = rect.top > 300;
    setPreviewPosition({
      left,
      top: placeAbove ? rect.top - 12 : rect.bottom + 12,
      transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      placement: placeAbove ? 'top' : 'bottom',
    });
  };
  const openPreview = () => {
    updatePreviewPosition();
    setPreviewOpen(true);
  };

  useEffect(() => {
    if (!previewOpen) return undefined;
    const reposition = () => updatePreviewPosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [previewOpen]);

  return (
    <span
      ref={wrapRef}
      className="related-tag-wrap"
      onMouseEnter={openPreview}
      onMouseLeave={() => setPreviewOpen(false)}
      onTouchStart={(event) => {
        event.preventDefault();
        touchPreviewRef.current = true;
        openPreview();
      }}
      onTouchEnd={() => {
        setPreviewOpen(false);
        setTimeout(() => {
          touchPreviewRef.current = false;
        }, 250);
      }}
      onTouchCancel={() => {
        setPreviewOpen(false);
        touchPreviewRef.current = false;
      }}
    >
      <Tag
        type={onOpenItem ? 'button' : undefined}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (touchPreviewRef.current) return;
          onOpenItem?.(item);
        }}
      >
        {label}
      </Tag>
      {previewOpen && createPortal(<RelatedPreviewCard item={item} position={previewPosition} />, document.body)}
    </span>
  );
}

function RelatedPreviewCard({ item, position }) {
  const firstExamples = itemExamples(item).slice(0, 2);
  const style = position ? { left: position.left, top: position.top, transform: position.transform } : undefined;
  return (
    <div className="related-preview-card" style={style} data-placement={position?.placement || 'mobile'} role="tooltip">
      <div className="preview-head">
        <strong>{item.ko}</strong>
        {item.pos && <span>{item.pos}</span>}
      </div>
      <p className="preview-zh">{item.zh}</p>
      {!!item.notes?.length && <p className="preview-note">{item.notes[0]}</p>}
      {!!firstExamples.length && (
        <div className="preview-examples">
          {firstExamples.map((example) => (
            <p key={example.id || example.ko}>{example.ko}<br /><span>{example.zh}</span></p>
          ))}
        </div>
      )}
    </div>
  );
}

function StudyPage({ store, updateStore, set }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [filter, setFilter] = useState('全部');
  const [frontSide, setFrontSide] = useState('ko');
  const [random, setRandom] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(Date.now());
  const [autoPlay, setAutoPlay] = useState(false);
  const [playVoice, setPlayVoice] = useState(true);
  const [starredOnly, setStarredOnly] = useState(false);
  const types = ['全部', ...new Set(set.items.map((item) => item.pos || '比較'))];
  const filtered = useMemo(() => {
    const starredSet = new Set(store.starred || []);
    return set.items
      .filter((item) => filter === '全部' || item.pos === filter)
      .filter((item) => !starredOnly || starredSet.has(item.id));
  }, [set.items, filter, store.starred, starredOnly]);
  const ordered = useMemo(() => (random ? shuffleItems(filtered, shuffleSeed) : filtered), [filtered, random, shuffleSeed]);
  const item = ordered[index % Math.max(ordered.length, 1)];
  const isStarred = !!item && (store.starred || []).includes(item.id);
  const frontText = frontSide === 'ko' ? item?.ko : item?.zh;
  const backText = frontSide === 'ko' ? item?.zh : item?.ko;
  const frontLang = frontSide === 'ko' ? 'ko-KR' : 'zh-TW';
  const backLang = frontSide === 'ko' ? 'zh-TW' : 'ko-KR';
  const goPrev = () => {
    setIndex((index - 1 + ordered.length) % ordered.length);
    setFlipped(false);
  };
  const goNext = () => {
    setIndex((index + 1) % ordered.length);
    setFlipped(false);
  };
  const jumpToItem = (targetItem) => {
    const targetIndex = set.items.findIndex((entry) => entry.id === targetItem.id);
    if (targetIndex < 0) return;
    setAutoPlay(false);
    setRandom(false);
    setFilter('全部');
    setIndex(targetIndex);
    setFlipped(true);
  };

  useLayoutEffect(() => {
    setFlipped(false);
  }, [item?.id]);

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
  }, [filter, random, shuffleSeed, frontSide, starredOnly]);

  useEffect(() => {
    if (autoPlay || !playVoice || !item) return;
    speakText(frontText, frontLang);
  }, [autoPlay, playVoice, item?.id, frontSide]);

  useEffect(() => {
    if (!autoPlay || !item) return undefined;
    setFlipped(false);
    if (playVoice) speakText(frontText, frontLang);
    const flipTimer = window.setTimeout(() => {
      setFlipped(true);
      if (playVoice) speakText(backText, backLang);
    }, 1800);
    const nextTimer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % ordered.length);
      setFlipped(false);
    }, 3900);
    return () => {
      window.clearTimeout(flipTimer);
      window.clearTimeout(nextTimer);
    };
  }, [autoPlay, item?.id, frontSide, playVoice, ordered.length]);

  if (!filtered.length) return <section className="page"><div className="empty">沒有可學習的卡片。</div></section>;
  return (
    <section className="page study-page">
      <div className="topbar">
        <div><span className="eyebrow">Flashcards · {set.label}</span><h1>學習模式</h1></div>
        <select value={filter} onChange={(e) => { setFilter(e.target.value); setIndex(0); }}>{types.map((type) => <option key={type}>{type}</option>)}</select>
      </div>
      <div className="study-toolstrip">
        <button className={frontSide === 'ko' ? 'selected-soft' : ''} onClick={() => setFrontSide('ko')}>韓文正面</button>
        <button className={frontSide === 'zh' ? 'selected-soft' : ''} onClick={() => setFrontSide('zh')}>中文正面</button>
        <button className={random ? 'selected-soft' : ''} onClick={() => { setRandom(!random); setShuffleSeed(Date.now()); }}><Shuffle size={16} /> 隨機</button>
        <button className={autoPlay ? 'selected-soft' : ''} onClick={() => setAutoPlay(!autoPlay)}>{autoPlay ? <Pause size={16} /> : <Play size={16} />} 自動</button>
        <button className={playVoice ? 'selected-soft' : ''} onClick={() => setPlayVoice(!playVoice)}>{playVoice ? <Volume2 size={16} /> : <VolumeX size={16} />} 語音</button>
        <button className={starredOnly ? 'selected-soft' : ''} onClick={() => setStarredOnly((current) => !current)}><Star size={16} /> 有星號</button>
      </div>
      <div className="flashcard-wrap">
        <button className="card-arrow left" onClick={goPrev} aria-label="上一張"><ChevronLeft size={26} /></button>
        <div className={`flashcard ${flipped ? 'flipped' : ''}`} role="button" tabIndex={0}
          onClick={() => { const next = !flipped; setFlipped(next); if (playVoice) speakText(next ? backText : frontText, next ? backLang : frontLang); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { const next = !flipped; setFlipped(next); if (playVoice) speakText(next ? backText : frontText, next ? backLang : frontLang); } }}
        >
          <div className="flashcard-star">
            <StarButton active={isStarred} onClick={() => toggleStarredItem(updateStore, item.id)} />
          </div>
          <div className="flash-face front">
            <span>{index + 1} / {ordered.length}</span>
            <strong>{frontText}</strong>
            <small>{frontSide === 'ko' ? item.pos || '比較' : '點擊看韓文'}</small>
            <button className="card-speak-btn" onClick={(e) => { e.stopPropagation(); speakText(frontText, frontLang); }} aria-label="播放發音"><Volume2 size={18} /></button>
          </div>
          <div className="flash-face back">
            <strong>{backText}</strong>
            <button className="card-speak-btn" onClick={(e) => { e.stopPropagation(); speakText(backText, backLang); }} aria-label="播放發音"><Volume2 size={18} /></button>
          </div>
        </div>
        <button className="card-arrow right" onClick={goNext} aria-label="下一張"><ChevronRight size={26} /></button>
      </div>
      {flipped && <div className="card-details"><StudyDetails item={item} allItems={set.items} onOpenItem={jumpToItem} /></div>}
    </section>
  );
}

function StudyDetails({ item, allItems, onOpenItem }) {
  const relatedItems = displayRelated(item, allItems);
  const hasDetails = item.meanings?.length || item.notes?.length || relatedItems.length || item.components?.length || item.items?.length;
  if (!hasDetails) return <div className="empty">這張卡片沒有額外例句或補充說明。</div>;
  return (
    <div className="study-details">
      <CardRichDetails item={item} relatedItems={relatedItems} onOpenItem={onOpenItem} />
      {!!item.components?.length && <div className="tags">{item.components.map((entry) => <span key={entry.ko}>{entry.ko} · {entry.zh}</span>)}</div>}
      {!!item.items?.length && <div className="subblock">{item.items.map((entry) => <p key={entry.ko}>{entry.ko}<br /><span>{entry.zh}</span></p>)}</div>}
    </div>
  );
}

function PracticePage({ store, updateStore, set }) {
  const [direction, setDirection] = useState('zh-ko');
  const [source, setSource] = useState('term');
  const [starredOnly, setStarredOnly] = useState(false);
  const [recordResults, setRecordResults] = useState(set.recordResults ?? true);
  const fixedSource = set.termOnly || set.dueOnly;
  const activeDirection = set.dueOnly ? 'zh-ko' : direction;
  const shouldRecordResults = set.dueOnly || recordResults;
  const [started, setStarted] = useState(!!set.dueOnly);
  const [questionQueue, setQuestionQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState(false);
  const [lastCorrect, setLastCorrect] = useState(null);
  const [typedAttempts, setTypedAttempts] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoPronounce, setAutoPronounce] = useState(true);
  const sourceQuestions = useMemo(() => {
    const starredSet = new Set(store.starred || []);
    const applyStarFilter = (list) => (starredOnly ? list.filter((q) => starredSet.has(q.itemId)) : list);
    if (set.dueOnly) return orderReviewQuestions(dueQuestions(store, reviewQuestions(set.questions)));
    if (direction === 'ko-zh') return applyStarFilter(set.questions.filter((q) => q.kind === 'term'));
    const activeSource = set.termOnly ? 'term' : source;
    const filtered = set.questions.filter((q) => activeSource === 'all' || q.kind === activeSource);
    const orderedFiltered = activeSource === 'all' ? orderReviewQuestions(filtered) : filtered;
    return applyStarFilter(orderedFiltered);
  }, [set.questions, source, direction, set.termOnly, set.dueOnly, store, starredOnly]);
  const queue = started ? questionQueue : sourceQuestions;
  const question = queue[index];
  const resetSession = () => {
    setStarted(false);
    setQuestionQueue([]);
    setIndex(0);
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
    setTypedAttempts(0);
  };
  const startSession = () => {
    const nextQuestions = set.dueOnly ? shuffleReviewQuestionsByKind(sourceQuestions) : shuffleItems(sourceQuestions, Date.now());
    if (!nextQuestions.length) {
      resetSession();
      return;
    }
    setQuestionQueue(nextQuestions);
    setStarted(true);
    setIndex(0);
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
    setTypedAttempts(0);
  };

  useEffect(() => {
    if (!set.dueOnly) return;
    if (questionQueue.length) return;
    const nextQuestions = shuffleReviewQuestionsByKind(sourceQuestions);
    setQuestionQueue(nextQuestions);
    setStarted(!!nextQuestions.length);
    setIndex(0);
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
    setTypedAttempts(0);
  }, [set.dueOnly, sourceQuestions, questionQueue.length]);

  useEffect(() => {
    if (direction === 'ko-zh') setSource('term');
  }, [direction]);

  useEffect(() => {
    setRecordResults(set.recordResults ?? true);
  }, [set.label, set.recordResults]);

  const goNext = () => {
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
    setTypedAttempts(0);
    if (index + 1 < queue.length) setIndex(index + 1);
    else resetSession();
  };
  // Korean-to-Chinese correct answers are intentionally lightweight: they do
  // not improve long-term accuracy, while wrong answers still mark the card.
  const submit = (correct) => {
    if (shouldRecordResults && (!correct || activeDirection !== 'ko-zh')) {
      updateStore((current) => recordAnswer(current, question, correct));
    }
    if (soundEnabled) playResultSound(correct);
    goNext();
  };
  // Used when 確認/Enter auto-grades a typed answer: records the result right
  // away (no manual 答對/答錯 choice) but keeps the question on screen so the
  // outcome is visible until the user presses Enter for the next one.
  const gradeAndRecord = (correct) => {
    if (shouldRecordResults) {
      updateStore((current) => recordAnswer(current, question, correct));
    }
    setGraded(true);
    setLastCorrect(correct);
    if (soundEnabled) playResultSound(correct);
    if (autoPronounce) window.setTimeout(() => speakAnswer(question), soundEnabled ? 320 : 0);
  };
  const handleConfirm = () => {
    if (graded || !input.trim()) return;
    const submittedInput = input.trim();
    setInput(submittedInput);
    const checkResult = compareAnswer(submittedInput, question.ko);
    setResult(checkResult);
    const nextAttempt = typedAttempts + 1;
    setTypedAttempts(nextAttempt);
    if (checkResult.isCorrect) {
      gradeAndRecord(true);
    } else if (question.kind === 'example' && nextAttempt < 2) {
      setRevealed(false);
      if (soundEnabled) playResultSound(false);
    } else {
      setRevealed(true);
      gradeAndRecord(false);
    }
  };
  const revealTypedAnswerAsWrong = () => {
    if (graded) return;
    setInput((current) => current.trim());
    setRevealed(true);
    setResult(null);
    setTypedAttempts(2);
    gradeAndRecord(false);
  };
  const revealAnswerForSelfGrade = () => {
    setRevealed(true);
    if (autoPronounce) speakAnswer(question);
  };

  useEffect(() => {
    if (!started) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Enter' && graded && !event.isComposing) {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [started, graded, index, queue.length]);

  if (!started && !set.dueOnly) {
    return (
      <section className="page practice-start">
        <div className="panel start-panel">
          <span className="eyebrow">Test · {set.label}</span>
          <h1>{set.dueOnly ? '今日測驗' : '選擇測驗方向'}</h1>
          <div className="segmented">
            <button className={direction === 'zh-ko' ? 'active' : ''} onClick={() => setDirection('zh-ko')}>中翻韓</button>
            <button className={direction === 'ko-zh' ? 'active' : ''} onClick={() => setDirection('ko-zh')}>韓翻中</button>
          </div>
          {fixedSource ? (
            <div className="fixed-source-note">每日測驗會先完成單字，再接著測驗例句。</div>
          ) : direction === 'ko-zh' ? (
            <div className="fixed-source-note">韓翻中只測驗單字。答對不會寫入長期正確率，答錯仍會記錄為不熟悉。</div>
          ) : (
            <div className="segmented">
              <button className={source === 'term' ? 'active' : ''} onClick={() => setSource('term')}>單字 / 片語</button>
              <button className={source === 'example' ? 'active' : ''} onClick={() => setSource('example')}>例句</button>
              <button className={source === 'all' ? 'active' : ''} onClick={() => setSource('all')}>全部</button>
            </div>
          )}
          <div className="segmented compact">
            <button className={!starredOnly ? 'active' : ''} onClick={() => setStarredOnly(false)}>全部卡片</button>
            <button className={starredOnly ? 'active' : ''} onClick={() => setStarredOnly(true)}><Star size={16} /> 有星號</button>
          </div>
          <div className="segmented compact">
            <button className={recordResults ? 'active' : ''} onClick={() => setRecordResults(true)}>紀錄結果</button>
            <button className={!recordResults ? 'active' : ''} onClick={() => setRecordResults(false)}>不紀錄</button>
          </div>
          {!recordResults && <div className="fixed-source-note muted-note">這次測驗不會改變答對率、間隔排程或今日紀錄。</div>}
          <p>{sourceQuestions.length} 題可測驗。{set.dueOnly ? '請看中文提示輸入韓文答案。' : '中翻韓只會出打字題，韓翻中會先思考再公佈答案。'}</p>
          <button className="primary wide" disabled={!sourceQuestions.length} onClick={startSession}>開始</button>
        </div>
      </section>
    );
  }

  if (!question) {
    return (
      <section className="page practice-start">
        <div className="panel start-panel">
          <span className="eyebrow">Test · {set.label}</span>
          <h1>目前沒有待測驗題目</h1>
          <p>單字和例句都已經清完，今天的測驗任務已完成。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="page practice-page">
      <div className="practice-layout">
        <div className="practice-shell">
          <div className="progress-line"><span style={{ width: `${((index + 1) / queue.length) * 100}%` }} /></div>
          <div className="quiz-meta quiz-meta-row">
            <span>{index + 1} / {queue.length} · {activeDirection === 'zh-ko' ? '中翻韓' : '韓翻中'}</span>
            <div className="quiz-options">
              <button className={soundEnabled ? 'selected-soft' : ''} onClick={() => setSoundEnabled((enabled) => !enabled)}>{soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />} 音效</button>
              <button className={autoPronounce ? 'selected-soft' : ''} onClick={() => setAutoPronounce((enabled) => !enabled)}>{autoPronounce ? <Volume2 size={16} /> : <VolumeX size={16} />} 自動發音</button>
            </div>
          </div>
          {activeDirection === 'zh-ko' ? (
            <>
              <div className="prompt">
                <span>請輸入韓文</span>
                <div className="prompt-title">
                  <h1>{question.zh}</h1>
                  <QuestionKindBadge kind={question.kind} />
                </div>
                <small className="answer-length-hint">答案 {countKoreanLetters(question.ko)} 個韓文字</small>
              </div>
              <div className="typed-answer-area">
                <textarea
                  key={question.id}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      e.stopPropagation();
                      handleConfirm();
                    }
                  }}
                  placeholder="여기에 한국어를 입력하세요 (Enter 送出)"
                  autoFocus
                  disabled={graded}
                />
                <span className="input-korean-count">{countKoreanLetters(input)}</span>
                <div className="actions answer-actions">
                  {!graded && !revealed ? (
                    <>
                      <button className="primary" onClick={handleConfirm}><Check size={18} /> 確認</button>
                      <button onClick={revealTypedAnswerAsWrong}><RotateCcw size={18} /> 公佈答案</button>
                    </>
                  ) : (
                    graded && <>
                      {lastCorrect ? <CorrectFireworks /> : <span className="answer-inline-wrong"><X size={16} /> 答錯</span>}
                      <button className="primary" onClick={goNext}><ChevronRight size={18} /> 下一題</button>
                    </>
                  )}
                </div>
              </div>
              {result && <DiffResult result={result} />}
            </>
          ) : (
            <>
              <div className="prompt ko">
                <span>請在心中想中文意思</span>
                <div className="prompt-title">
                  <h1>{question.ko}</h1>
                  <QuestionKindBadge kind={question.kind} />
                </div>
              </div>
              {!revealed ? <button className="primary wide" onClick={revealAnswerForSelfGrade}>公佈答案</button> : (
                <div className="answer-panel grade-banner">
                  <strong><Check size={18} /> 請看右側單字卡後自評</strong>
                </div>
              )}
            </>
          )}
        </div>
        <PracticeAnswerPanel
          question={question}
          visible={revealed || graded}
          graded={graded}
          correct={lastCorrect}
          onCorrect={() => submit(true)}
          onWrong={() => submit(false)}
          onNext={goNext}
          isStarred={(store.starred || []).includes(question.source?.id)}
          onToggleStar={() => toggleStarredItem(updateStore, question.source.id)}
        />
      </div>
    </section>
  );
}

function QuestionKindBadge({ kind }) {
  return <small className={`question-kind-badge ${kind === 'example' ? 'example' : 'term'}`}>{kind === 'example' ? '例句' : '單字'}</small>;
}

function PracticeAnswerPanel({ question, visible, graded, correct, onCorrect, onWrong, onNext, isStarred = false, onToggleStar }) {
  return (
    <aside className={`practice-answer-panel ${visible ? 'visible' : ''}`}>
      <div className="answer-panel-inner">
        {!visible ? (
          <div className="answer-placeholder">
            <span>答案卡片</span>
            <strong>答題後會顯示完整單字卡</strong>
          </div>
        ) : (
          <>
            <div className="answer-review-head">
              <span>{graded ? (correct ? '答對' : '答錯') : '公布答案'}</span>
              {question.kind === 'example' && <strong>例句來自這張卡片</strong>}
              {graded && <small>再按 Enter 進入下一題</small>}
            </div>
            <div className="answer-card-stage">
              <NoteCard item={question.source} isStarred={isStarred} onToggleStar={onToggleStar} />
            </div>
            {!graded && (
              <div className="answer-review-actions">
                <>
                  <button className="success" onClick={onCorrect}><Check size={18} /> 答對</button>
                  <button className="danger-button" onClick={onWrong}><X size={18} /> 答錯</button>
                </>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function CorrectFireworks() {
  return (
    <div className="answer-inline-celebration" aria-label="答對了">
      <span aria-hidden="true">🎉</span>
      <strong>答對！</strong>
    </div>
  );
}

function DiffResult({ result }) {
  if (result.isCorrect) return null;

  return (
    <div className="diff-box wrong-shake" role="status">
      <div className="wrong-feedback"><span aria-hidden="true">✕</span><strong>答錯了</strong></div>
      <div className="diff-line">
        {result.parts.map((part, index) => {
          if (part.type === 'missing') return <span className="missing" key={index}>□</span>;
          if (part.type === 'missing-space') return <span className="missing-space" key={index}>_</span>;
          if (part.type === 'extra-space') return <span className="bad space" key={index}>␠</span>;
          if (part.type === 'extra') return <span className="bad" key={index}>{part.text}</span>;
          if (part.type === 'replace') return <span className="bad replace" key={index} title={`應改成 ${part.expected}`}>{part.text === ' ' ? '␠' : part.text}</span>;
          return <span key={index}>{part.text}</span>;
        })}
      </div>
    </div>
  );
}

function AnswerPanel({ question, revealed, onCorrect, onWrong }) {
  return (
    <div className="answer-panel">
      {revealed && <div><span>正確答案</span><strong>{question.ko}</strong><p>{question.zh}</p></div>}
      <div className="actions">
        <button className="success" onClick={onCorrect}><Check size={18} /> 答對</button>
        <button className="danger-button" onClick={onWrong}><X size={18} /> 答錯</button>
      </div>
    </div>
  );
}

function ExportJsonModal({ items, title = '匯出 JSON', onClose }) {
  const [copied, setCopied] = useState(false);
  const jsonText = useMemo(() => buildNotebookExport(items), [items]);
  const copyJson = async () => {
    await navigator.clipboard.writeText(jsonText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel export-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="export-head">
          <div>
            <span className="eyebrow">Backup</span>
            <h2>{title}</h2>
          </div>
          <div className="actions">
            <button onClick={copyJson}><Copy size={17} /> {copied ? '已複製' : '複製'}</button>
            <button className="primary" onClick={() => downloadNotebookJson(jsonText)}><Download size={17} /> 下載</button>
          </div>
        </div>
        <pre className="json-code"><code>{jsonText}</code></pre>
      </div>
    </div>
  );
}

function EditJsonModal({ items, allItems, date, onSave, onClose }) {
  const initialJson = useMemo(() => buildNotebookExport(items), [items]);
  const [jsonText, setJsonText] = useState(initialJson);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [pendingReview, setPendingReview] = useState(null);
  const [saving, setSaving] = useState(false);
  const copyJson = async () => {
    await navigator.clipboard.writeText(jsonText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const reviewJson = () => {
    setError('');
    setPendingReview(null);
    try {
      const records = createUpdateRecordsFromEditedJson(jsonText, date, items, allItems);
      const changes = summarizeEditedJsonChanges(items, records);
      setPendingReview({ records, changes });
    } catch (saveError) {
      setError(saveError.message || 'JSON 內容無法儲存');
    }
  };
  const confirmSave = async () => {
    if (!pendingReview) return;
    setError('');
    setSaving(true);
    try {
      const records = createUpdateRecordsFromEditedJson(jsonText, date, items, allItems);
      await onSave(records);
    } catch (saveError) {
      setError(saveError.message || 'JSON 內容無法儲存');
      setSaving(false);
      setPendingReview(null);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel export-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="export-head">
          <div>
            <span className="eyebrow">Edit JSON · {date}</span>
            <h2>修改 JSON 內容</h2>
          </div>
          <div className="actions">
            <button onClick={copyJson}><Copy size={17} /> {copied ? '已複製' : '複製'}</button>
            <button className="primary" disabled={saving} onClick={reviewJson}><Check size={17} /> 檢查變更</button>
          </div>
        </div>
        <textarea
          className="json-editor"
          value={jsonText}
          onChange={(event) => {
            setJsonText(event.target.value);
            setPendingReview(null);
            setError('');
          }}
          spellCheck={false}
        />
        {error && <div className="json-edit-error">{error}</div>}
        {pendingReview && (
          <div className="json-change-review">
            <div>
              <strong>即將修改 {pendingReview.changes.length} 張單字卡</strong>
              <span>{pendingReview.changes.length ? '請確認以下變更後再送出。' : 'JSON 內容和目前資料相同，沒有需要送出的變更。'}</span>
            </div>
            {!!pendingReview.changes.length && (
              <div className="json-change-list">
                {pendingReview.changes.map((change) => (
                  <div className="json-change-row" key={change.id}>
                    <strong>{change.beforeKo === change.afterKo ? change.afterKo : `${change.beforeKo} → ${change.afterKo}`}</strong>
                    <span>{change.fields.join('、')}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="actions json-review-actions">
              <button onClick={() => setPendingReview(null)}>返回編輯</button>
              <button className="danger-button" onClick={onClose}>放棄</button>
              <button className="primary" disabled={saving || !pendingReview.changes.length} onClick={confirmSave}>
                <Check size={17} /> {saving ? '送出中' : '確認送出'}
              </button>
            </div>
          </div>
        )}
        <p className="json-edit-note">請保留每張卡片的 id 和 date。這裡只修改 {date} 既有單字，不新增或刪除卡片。</p>
      </div>
    </div>
  );
}

function NotebookPage({ store, updateStore, items, questions, onPractice, onStudy, onAddRecords, onUpdateRecord, onDeleteRecord }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('全部');
  const [level, setLevel] = useState('全部');
  const [sort, setSort] = useState('default');
  const [pageNumber, setPageNumber] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);
  const starredSet = new Set(store.starred || []);
  const types = ['全部', ...new Set(items.map((item) => item.pos || '比較'))];
  const itemQuestionIds = new Map(items.map((item) => [item.id, questions.filter((q) => q.itemId === item.id).map((q) => q.id)]));
  const enriched = items.map((item) => {
    const ids = itemQuestionIds.get(item.id) || [item.id];
    const itemStats = ids.map((id) => getStats(store, id));
    const total = itemStats.reduce((sum, stat) => sum + stat.total, 0);
    const correct = itemStats.reduce((sum, stat) => sum + stat.correct, 0);
    const rate = total ? Math.round((correct / total) * 100) : 0;
    const levelValue = itemStats.some((stat) => stat.level === '不熟悉') ? '不熟悉' : itemStats.some((stat) => stat.level === '已熟練') ? '已熟練' : itemStats.some((stat) => stat.level === '熟悉') ? '熟悉' : '學習中';
    return { ...item, total, rate, level: levelValue };
  }).filter((item) => {
    const matchesQuery = !query || itemSearchText(item).includes(query.toLowerCase());
    const matchesType = type === '全部' || item.pos === type;
    const matchesLevel = level === '全部' || item.level === level;
    return matchesQuery && matchesType && matchesLevel;
  }).sort((a, b) => {
    if (sort === 'rate') return a.rate - b.rate;
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    const aTime = a.createdAt || `${a.date}T00:00:00.000Z`;
    const bTime = b.createdAt || `${b.date}T00:00:00.000Z`;
    if (aTime !== bTime) return bTime.localeCompare(aTime);
    return b.index - a.index;
  });
  const pageSize = 30;
  const pageCount = Math.max(1, Math.ceil(enriched.length / pageSize));
  const pagedItems = enriched.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  const practiceQuestions = questions.filter((question) => enriched.some((item) => item.id === question.itemId));

  useEffect(() => {
    setPageNumber(1);
  }, [query, type, level, sort]);

  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Notebook</span><h1>單字本</h1></div>
        <div className="actions notebook-actions">
          <button onClick={() => setExportOpen(true)}><Download size={18} /> 匯出 JSON</button>
          <button className="add-date-button" onClick={() => setAddOpen(true)}><Plus size={18} /> 新增單字</button>
          <button onClick={() => onStudy(enriched, '篩選結果')}><BookOpen size={18} /> 學習篩選結果</button>
          <button className="primary" onClick={() => onPractice(practiceQuestions, '篩選結果測驗')}><Dumbbell size={18} /> 測驗篩選結果</button>
        </div>
      </div>
      {exportOpen && <ExportJsonModal items={items} onClose={() => setExportOpen(false)} />}
      <div className="filters">
        <label className="search"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋單字、例句、筆記或相關詞" /></label>
        <select value={type} onChange={(e) => setType(e.target.value)}>{types.map((option) => <option key={option}>{option}</option>)}</select>
        <select value={level} onChange={(e) => setLevel(e.target.value)}>{['全部', '不熟悉', '學習中', '熟悉', '已熟練'].map((option) => <option key={option}>{option}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="default">最新加入優先</option><option value="rate">答對率低優先</option></select>
      </div>
      {addOpen && (
        <AddItemsModal
          title="新增單字"
          date={todayString()}
          allItems={items}
          onAddRecords={onAddRecords}
          onUpdateRecord={onUpdateRecord}
          onEditExisting={(item) => {
            setAddOpen(false);
            setEditingItem(item);
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
      {editingItem && (
        <AddItemsModal
          title="編輯單字"
          date={editingItem.date}
          lockedDate
          editItem={editingItem}
          allItems={items}
          onUpdateRecord={onUpdateRecord}
          onClose={() => setEditingItem(null)}
        />
      )}
      {viewingItem && (
        <ItemDetailModal
          item={viewingItem}
          allItems={items}
          isStarred={starredSet.has(viewingItem.id)}
          onToggleStar={() => toggleStarredItem(updateStore, viewingItem.id)}
          onOpenItem={setViewingItem}
          onEdit={(item) => {
            setViewingItem(null);
            setEditingItem(item);
          }}
          onDelete={onDeleteRecord}
          onClose={() => setViewingItem(null)}
        />
      )}
      <div className="word-grid">
        {pagedItems.map((item) => (
          <WordCard
            key={item.id}
            item={item}
            onEdit={setEditingItem}
            onDelete={onDeleteRecord}
            onOpen={setViewingItem}
            isStarred={starredSet.has(item.id)}
            onToggleStar={() => toggleStarredItem(updateStore, item.id)}
          />
        ))}
      </div>
      <div className="pagination">
        <button disabled={pageNumber <= 1} onClick={() => setPageNumber(pageNumber - 1)}><ChevronLeft size={18} /> 上一頁</button>
        <span>{pageNumber} / {pageCount} · 共 {enriched.length} 筆</span>
        <button disabled={pageNumber >= pageCount} onClick={() => setPageNumber(pageNumber + 1)}>下一頁 <ChevronRight size={18} /></button>
      </div>
    </section>
  );
}

function MiniQuestion({ question, store }) {
  const stats = getStats(store, question.id);
  return <div className="mini"><strong>{question.ko}</strong><span>{question.zh}</span><MasteryBadge level={stats.level} /></div>;
}

function WordCard({ item, onEdit, onDelete, onOpen, isStarred = false, onToggleStar }) {
  return (
    <article className="word-card clickable-card" onClick={() => onOpen(item)}>
      <div className="card-head">
        <h3>{item.ko}</h3>
        <div className="card-actions">
          <StarButton active={isStarred} onClick={onToggleStar} />
          <EditIconButton onClick={() => onEdit(item)} />
          <DeleteIconButton item={item} onDelete={onDelete} />
          <MasteryBadge level={item.level} />
        </div>
      </div>
      <p>{item.zh}</p>
      <div className="word-meta"><span>{item.pos || '比較'}</span><span>{item.date}</span><span>{item.total} 次</span><span>{item.rate}%</span></div>
    </article>
  );
}

createRoot(document.getElementById('root')).render(<App />);
