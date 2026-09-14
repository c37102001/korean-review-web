const PENDING_WRITES_KEY = 'korean-review-offline-pending-writes-v1';
const OFFLINE_READY_KEY = 'korean-review-offline-ready-v1';
const OFFLINE_COVERAGE_KEY = 'korean-review-offline-coverage-v1';
export const MANUAL_OFFLINE_STORAGE_KEY = 'korean-review-manual-offline-v1';
export const OFFLINE_STATUS_EVENT = 'korean-review-offline-status';

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson(key, fallback) {
  try {
    return JSON.parse(storage()?.getItem(key) || '') || fallback;
  } catch {
    return fallback;
  }
}

function emitStatus(detail = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OFFLINE_STATUS_EVENT, { detail }));
}

export function isBrowserOffline() {
  return (typeof navigator !== 'undefined' && navigator.onLine === false) || manualOfflineEnabled();
}

export function manualOfflineEnabled() {
  return storage()?.getItem(MANUAL_OFFLINE_STORAGE_KEY) === 'true';
}

export function setManualOfflineEnabled(enabled) {
  const active = enabled === true;
  storage()?.setItem(MANUAL_OFFLINE_STORAGE_KEY, String(active));
  emitStatus({ manualOffline: active });
  return active;
}

export function offlinePendingWrites() {
  return Math.max(0, Number(readJson(PENDING_WRITES_KEY, { count: 0 }).count) || 0);
}

function setPendingWrites(count, detail = {}) {
  const next = Math.max(0, Number(count) || 0);
  storage()?.setItem(PENDING_WRITES_KEY, JSON.stringify({ count: next, updatedAt: new Date().toISOString() }));
  emitStatus({ pendingWrites: next, ...detail });
}

export function clearOfflinePendingWrites() {
  setPendingWrites(0, { syncError: '' });
}

export function trackOfflineWrite(pending, label = '離線操作') {
  setPendingWrites(offlinePendingWrites() + 1, { queuedLabel: label });
  Promise.resolve(pending).then(
    () => setPendingWrites(offlinePendingWrites() - 1, { syncedLabel: label, syncError: '' }),
    (error) => setPendingWrites(offlinePendingWrites() - 1, {
      syncError: `${label}同步失敗：${error?.message || '未知錯誤'}`,
    }),
  );
  return Promise.resolve({ queuedOffline: true });
}

export function queueOfflineWrite(operation, label = '離線操作') {
  try {
    return trackOfflineWrite(operation(), label);
  } catch (error) {
    return Promise.reject(error);
  }
}

export function offlineReadyState(uid = '') {
  const value = readJson(OFFLINE_READY_KEY, null);
  return value?.uid === uid ? value : null;
}

export function markOfflineReady(uid, details = {}) {
  const value = { uid, completedAt: new Date().toISOString(), ...details };
  storage()?.setItem(OFFLINE_READY_KEY, JSON.stringify(value));
  emitStatus({ offlineReady: value });
  return value;
}

export function offlineDataCoverage(uid = '') {
  const value = readJson(OFFLINE_COVERAGE_KEY, null);
  return value?.uid === uid ? value.sections || {} : {};
}

export function markOfflineSectionReady(uid, section) {
  if (!uid || !section) return;
  const sections = { ...offlineDataCoverage(uid), [section]: new Date().toISOString() };
  storage()?.setItem(OFFLINE_COVERAGE_KEY, JSON.stringify({ uid, sections }));
}

export function clearOfflineDataCoverage(uid = '') {
  const value = readJson(OFFLINE_COVERAGE_KEY, null);
  if (!uid || value?.uid === uid) storage()?.removeItem(OFFLINE_COVERAGE_KEY);
}
