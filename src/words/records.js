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
