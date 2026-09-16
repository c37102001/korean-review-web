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
