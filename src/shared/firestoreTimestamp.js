export function firestoreTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'object' && Number.isFinite(value.seconds)) {
    return (value.seconds * 1000) + Math.floor((Number(value.nanoseconds) || 0) / 1_000_000);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function firestoreTimestampIso(value) {
  if (!value) return '';
  const milliseconds = firestoreTimestampMillis(value);
  const validEpoch = milliseconds === 0 && (
    typeof value?.toMillis === 'function'
    || (typeof value === 'object' && Number(value.seconds) === 0)
    || Date.parse(value) === 0
  );
  if (!milliseconds && !validEpoch) return typeof value === 'string' ? value : '';
  return new Date(milliseconds).toISOString();
}
