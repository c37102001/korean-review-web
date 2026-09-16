import { createId } from '../../shared/id.js';
import {
  buildRecordLookup,
  normalizeItemToV2,
  normalizeKoreanKey,
  recordOrder,
} from '../../words/records.js';
const CONTENT_SCHEMA_VERSION = 2;

export function readJsonImportDocument(text) {
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

export function buildJsonImportDraft(text, targetDate) {
  const data = readJsonImportDocument(text);
  if (!data.length) throw new Error('JSON 至少需要包含 1 筆單字');
  const entries = data.map((item, index) => {
    try {
      validateImportItem(item, index);
      return { index, action: 'add', recordId: item.id || `${targetDate}-custom-${createId()}`, item };
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

export function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 需要是物件`);
}

export function assertString(value, label, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw new Error(`${label} 是必填`);
    return;
  }
  if (typeof value !== 'string') throw new Error(`${label} 需要是文字`);
  if (required && !value.trim()) throw new Error(`${label} 不可以空白`);
}

export function assertSafeInteger(value, label) {
  if (value !== undefined && !Number.isSafeInteger(value)) throw new Error(`${label} 需要是安全整數`);
}

export function assertNoUnsupportedKeys(value, allowedKeys, label) {
  const unsupported = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unsupported.length) throw new Error(`${label} 有不支援的欄位：${unsupported.join('、')}`);
}

export function assertUniqueIds(values, label) {
  const ids = values.map((value) => value.id).filter(Boolean);
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicated.length) throw new Error(`${label} 有重複 id：${[...new Set(duplicated)].join('、')}`);
}

export function validateImportItem(item, itemIndex) {
  const label = `第 ${itemIndex + 1} 筆資料`;
  assertPlainObject(item, label);
  assertNoUnsupportedKeys(item, ['id', 'date', 'order', 'ko', 'pos', 'meanings', 'notes', 'related'], label);
  assertString(item.id, `${label} 的 id`);
  assertString(item.date, `${label} 的 date`);
  assertSafeInteger(item.order, `${label} 的 order`);
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

export function createRecordsForDate(date, rawItems, existingItems = []) {
  const now = new Date().toISOString();
  const orderBase = Date.now() * 1000;
  const records = rawItems.map((item, index) => ({
    id: item.id || `${date}-custom-${createId()}`,
    date: item.date || date,
    order: Number.isSafeInteger(item.order) ? item.order : orderBase + index,
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

export function createRecordsFromImportEntries(entries, date, existingItems = [], forceDate = false) {
  const now = new Date().toISOString();
  const orderBase = Date.now() * 1000;
  const addRecords = entries.filter((entry) => entry.action === 'add').map((entry) => ({
    id: entry.recordId || entry.item.id,
    date: forceDate ? date : entry.item.date || date,
    order: Number.isSafeInteger(entry.item.order) ? entry.item.order : orderBase + entry.index,
    item: entry.item,
    createdAt: entry.item.createdAt || now,
  }));
  const updateRecords = entries.filter((entry) => entry.action === 'update').map((entry) => ({
    id: entry.existing.id,
    date: entry.existing.date,
    order: Number.isSafeInteger(entry.item.order) ? entry.item.order : orderBase + entry.index,
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

export function createUpdateRecordsFromEditedJson(text, date, selectedItems, allItems = []) {
  const data = readJsonImportDocument(text);
  data.forEach(validateImportItem);
  const scopeLabel = date ? '這一天' : '目前匯出的';
  const selectedById = new Map(selectedItems.map((item) => [item.id, item]));
  const expectedIds = new Set(selectedItems.map((item) => item.id));
  const editedIds = data.map((item) => item.id).filter(Boolean);
  const duplicateIds = editedIds.filter((id, index) => editedIds.indexOf(id) !== index);
  if (duplicateIds.length) throw new Error(`JSON 中有重複 id：${[...new Set(duplicateIds)].join('、')}`);
  const missingIds = [...expectedIds].filter((id) => !editedIds.includes(id));
  const extraIds = editedIds.filter((id) => !expectedIds.has(id));
  if (missingIds.length) throw new Error(`缺少${scopeLabel}原本的單字 id：${missingIds.join('、')}`);
  if (extraIds.length) throw new Error(`不能在這裡新增或修改${scopeLabel}範圍外的單字 id：${extraIds.join('、')}`);

  const koById = new Map();
  data.forEach((item) => {
    const original = selectedById.get(item.id);
    const expectedDate = date || original?.date;
    if (!item.date) throw new Error(`單字「${item.ko}」需要保留 date`);
    if (item.date !== expectedDate) throw new Error(`單字「${item.ko}」的 date 必須維持 ${expectedDate}`);
    const normalizedKo = normalizeKoreanKey(item.ko);
    const existingId = koById.get(normalizedKo);
    if (existingId && existingId !== item.id) throw new Error(`JSON 中有重複韓文單字：${normalizedKo}`);
    koById.set(normalizedKo, item.id);
  });
  const duplicateExisting = allItems.find((item) => !expectedIds.has(item.id) && koById.has(normalizeKoreanKey(item.ko)));
  if (duplicateExisting) throw new Error(`韓文單字「${duplicateExisting.ko}」已存在於其他單字卡，請不要改成重複單字。`);

  const now = new Date().toISOString();
  const records = data.map((item) => {
    const original = selectedById.get(item.id);
    const recordDate = date || original.date;
    return {
      id: original.id,
      date: recordDate,
      order: Number.isSafeInteger(item.order) ? item.order : recordOrder(original),
      item: { ...item, date: recordDate },
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

export function comparableItemSnapshot(item) {
  return {
    order: item.order,
    ko: item.ko || '',
    pos: item.pos || '',
    meanings: item.meanings || [],
    notes: item.notes || [],
    related: item.related || [],
  };
}

export function jsonEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function summarizeEditedJsonChanges(originalItems, records) {
  const originalById = new Map(originalItems.map((item) => [item.id, item]));
  return records.map((record) => {
    const original = originalById.get(record.id);
    const next = { ...record.item, id: record.id, date: record.date, order: record.order };
    const fields = [];
    if (!jsonEqual(original?.order, next.order)) fields.push('排序');
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

export function findMissingImportRelated(entries, existingItems = []) {
  const activeEntries = entries.filter(Boolean);
  const knownIds = new Set(existingItems.map((item) => item.id).filter(Boolean));
  const knownKo = new Set(existingItems.map((item) => normalizeKoreanKey(item.ko)).filter(Boolean));
  activeEntries.forEach((entry) => {
    const entryId = entry.action === 'update' ? entry.existing?.id : entry.recordId;
    if (entryId) knownIds.add(entryId);
    if (entry.item.ko) knownKo.add(normalizeKoreanKey(entry.item.ko));
  });
  return activeEntries.map((entry, position) => {
    const missing = (entry.item.related || [])
      .map((related) => related.trim())
      .filter((related) => related && !knownIds.has(related) && !knownKo.has(normalizeKoreanKey(related)));
    if (!missing.length) return null;
    return { position, ko: entry.item.ko, missing: [...new Set(missing)] };
  }).filter(Boolean);
}

export function clearMissingImportRelated(entries, missingRelated) {
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

export function findImportConflict(entries, existingItems = []) {
  const activeEntries = entries.map((entry, position) => (entry ? { ...entry, position } : null)).filter(Boolean);
  for (let index = 0; index < activeEntries.length; index += 1) {
    const current = activeEntries[index];
    const currentKo = normalizeKoreanKey(current.item.ko);
    const duplicateIndex = activeEntries.findIndex((entry, candidateIndex) => candidateIndex < index && (
      entry.recordId === current.recordId || normalizeKoreanKey(entry.item.ko) === currentKo
    ));
    if (duplicateIndex >= 0) {
      const other = activeEntries[duplicateIndex];
      return {
        type: 'input',
        reason: other.recordId === current.recordId ? 'id' : 'ko',
        leftRecordId: other.recordId,
        rightRecordId: current.recordId,
        leftEntryIndex: other.position,
        rightEntryIndex: current.position,
        left: other.item,
        right: current.item,
        editText: JSON.stringify(mergeImportItems(other.item, current.item), null, 2),
        error: '',
      };
    }
    if (current.action === 'add') {
      const existing = existingItems.find((item) => item.id === current.recordId || normalizeKoreanKey(item.ko) === currentKo);
      if (existing) {
        return {
          type: 'existing',
          reason: existing.id === current.recordId ? 'id' : 'ko',
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

export function findUpdateKoreanCollision(entries, existingItems = []) {
  for (const entry of entries.filter(Boolean)) {
    if (entry.action !== 'update') continue;
    const collision = existingItems.find((item) => (
      item.id !== entry.existing.id && normalizeKoreanKey(item.ko) === normalizeKoreanKey(entry.item.ko)
    ));
    if (collision) return { entry, collision };
  }
  return null;
}

export function stripGeneratedIdsFromMeaning(meaning) {
  const { id, examples = [], ...content } = meaning;
  return {
    ...content,
    examples: examples.map((example) => {
      const { id: exampleId, ...exampleContent } = example;
      return exampleContent;
    }),
  };
}

export function mergeImportItems(left, right) {
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

export function parseEditedImportItem(text, label = '編輯後的單字') {
  let item;
  try {
    item = JSON.parse(text);
  } catch {
    throw new Error(`${label} JSON 格式錯誤`);
  }
  validateImportItem(item, 0);
  return item;
}

export function formatSingleWordJson(item) {
  const content = {
    ko: item.ko,
    ...(item.pos ? { pos: item.pos } : {}),
    meanings: (item.meanings || []).map((meaning) => ({
      zh: meaning.zh,
      ...(meaning.pattern ? { pattern: meaning.pattern } : {}),
      examples: (meaning.examples || []).map(({ ko, zh }) => ({ ko, zh })),
    })),
    notes: item.notes || [],
    ...(item.related?.length ? { related: item.related } : {}),
  };
  return JSON.stringify({ schemaVersion: CONTENT_SCHEMA_VERSION, data: [content] }, null, 2);
}

export function parseSingleWordEditJson(text, original, allItems = []) {
  const data = readJsonImportDocument(text);
  if (data.length !== 1) throw new Error('編輯單字的 data 必須只包含 1 筆單字');
  const input = data[0];
  validateImportItem(input, 0);
  if (input.id && input.id !== original.id) throw new Error('不能修改這張單字卡的 ID');
  if (input.date && input.date !== original.date) throw new Error('請使用日期欄位修改日期');
  const collision = allItems.find((item) => item.id !== original.id && normalizeKoreanKey(item.ko) === normalizeKoreanKey(input.ko));
  if (collision) throw new Error(`韓文「${input.ko}」與既有單字重複，請編輯既有單字卡`);
  const usedMeaningIds = new Set();
  const meanings = input.meanings.map((meaning, index) => {
    const previous = (original.meanings || []).find((entry) => (
      !usedMeaningIds.has(entry.id) && (meaning.id ? entry.id === meaning.id : entry.zh === meaning.zh)
    )) || (!usedMeaningIds.has(original.meanings?.[index]?.id) ? original.meanings?.[index] : null);
    const id = previous?.id || `${original.id}-meaning-${createId()}`;
    usedMeaningIds.add(id);
    const usedExampleIds = new Set();
    return {
      ...meaning,
      id,
      examples: (meaning.examples || []).map((example) => {
        const existing = (previous?.examples || []).find((entry) => (
          !usedExampleIds.has(entry.id) && (example.id ? entry.id === example.id : entry.ko === example.ko && entry.zh === example.zh)
        ));
        const exampleId = existing?.id || `${id}-ex-${createId()}`;
        usedExampleIds.add(exampleId);
        return { ...example, id: exampleId };
      }),
    };
  });
  const lookup = buildRecordLookup(allItems.map((item) => ({ id: item.id, item })));
  const item = normalizeItemToV2({ ...input, ko: input.ko.trim(), meanings }, original.id, lookup);
  if (item.related.some((id) => id === original.id || !allItems.some((entry) => entry.id === id))) {
    throw new Error('相關詞必須是其他已存在的單字卡');
  }
  return item;
}

export function resolveImportConflictDraft(draft, choice, allItems = []) {
  const conflict = draft.conflict;
  if (!conflict) throw new Error('目前沒有需要處理的衝突');
  const nextEntries = [...draft.entries];
  const keptExistingIds = [...new Set(draft.keptExistingIds || [])];
  const editedItem = choice === 'edit' ? parseEditedImportItem(conflict.editText, '最終結果') : null;
  if (conflict.type === 'existing') {
    if (choice === 'existing') {
      keptExistingIds.push(conflict.existing.id);
      nextEntries[conflict.entryIndex] = null;
    } else {
      const item = choice === 'incoming' ? conflict.incoming : choice === 'merge' ? mergeImportItems(conflict.existing, conflict.incoming) : editedItem;
      nextEntries[conflict.entryIndex] = { index: conflict.entryIndex, action: 'update', recordId: conflict.existing.id, existing: conflict.existing, item };
    }
  } else if (choice === 'left') {
    nextEntries[conflict.rightEntryIndex] = null;
  } else if (choice === 'right') {
    nextEntries[conflict.leftEntryIndex] = { ...nextEntries[conflict.rightEntryIndex], index: conflict.leftEntryIndex };
    nextEntries[conflict.rightEntryIndex] = null;
  } else {
    const item = choice === 'merge' ? mergeImportItems(conflict.left, conflict.right) : editedItem;
    nextEntries[conflict.leftEntryIndex] = {
      ...nextEntries[conflict.leftEntryIndex],
      recordId: choice === 'edit' && editedItem.id ? editedItem.id : nextEntries[conflict.leftEntryIndex].recordId,
      item,
    };
    nextEntries[conflict.rightEntryIndex] = null;
  }
  const activeEntries = nextEntries.filter(Boolean);
  const updateCollision = findUpdateKoreanCollision(activeEntries, allItems);
  if (updateCollision) throw new Error(`最終結果「${updateCollision.entry.item.ko}」會和既有單字重複`);
  const nextConflict = findImportConflict(activeEntries, allItems);
  const nextMissingRelated = nextConflict ? [] : findMissingImportRelated(activeEntries, allItems);
  return {
    ...draft,
    entries: activeEntries,
    keptExistingIds: [...new Set(keptExistingIds)],
    conflict: nextConflict,
    missingRelated: nextMissingRelated.length ? nextMissingRelated : null,
    message: nextConflict ? '已處理一組重複單字，請繼續處理下一組' : nextMissingRelated.length ? '重複單字已處理，請處理找不到的關聯詞' : '所有問題都已處理，可以匯入',
  };
}
