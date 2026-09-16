export function recordOrder(record) {
  if (Number.isSafeInteger(record?.order)) return record.order;
  const createdAt = Date.parse(record?.createdAt || '');
  return Number.isFinite(createdAt) ? createdAt * 1000 : 0;
}

export function sortRecords(records) {
  return records.sort((left, right) => {
    if (left.date === right.date) {
      const orderDifference = recordOrder(left) - recordOrder(right);
      if (orderDifference) return orderDifference;
      return String(left.id || '').localeCompare(String(right.id || ''));
    }
    return left.date.localeCompare(right.date);
  });
}

export function wordChineseSummary(word) {
  return (word?.meanings || []).map((meaning) => meaning.zh).filter(Boolean).join('；');
}

export function wordExamples(word) {
  return (word?.meanings || []).flatMap((meaning) => meaning.examples || []);
}

export function relatedWords(word, allWords = []) {
  const byId = new Map(allWords.map((entry) => [entry.id, entry]));
  return (word?.related || []).map((id) => byId.get(id)).filter(Boolean);
}

export function normalizeKoreanKey(value) {
  return String(value || '').trim().normalize('NFC');
}

export function buildRecordLookup(records) {
  const byId = new Map();
  const byKo = new Map();
  records.forEach((record) => {
    byId.set(record.id, record.id);
    if (record.item?.ko) byKo.set(normalizeKoreanKey(record.item.ko), record.id);
  });
  return { byId, byKo };
}

function resolveRelatedIds(related, lookup) {
  if (!Array.isArray(related)) return [];
  return [...new Set(related.map((entry) => {
    if (typeof entry === 'string') {
      return lookup.byId.get(entry) || lookup.byKo.get(normalizeKoreanKey(entry)) || entry.trim();
    }
    if (entry?.id) return lookup.byId.get(entry.id) || entry.id;
    if (entry?.ko) return lookup.byKo.get(normalizeKoreanKey(entry.ko)) || entry.ko.trim();
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

export function normalizeItemToV2(item, recordId, lookup = buildRecordLookup([])) {
  if (!Array.isArray(item.meanings) || !item.meanings.length) {
    throw new Error(`單字「${item.ko || recordId}」缺少 meanings`);
  }

  const meanings = item.meanings.map((meaning, meaningIndex) => {
    const meaningId = meaning.id || `${recordId}-${meaningIndex}`;
    const examples = (meaning.examples || []).map((example, exampleIndex) => (
      normalizeExample(example, `${meaningId}-ex-${exampleIndex}`)
    ));
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

export function normalizeRecordSet(records) {
  const lookup = buildRecordLookup(records);
  return records.map((record) => ({
    ...record,
    item: normalizeItemToV2(record.item, record.id, lookup),
  }));
}
