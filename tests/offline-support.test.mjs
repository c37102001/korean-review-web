import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearOfflinePendingWrites,
  markOfflineReady,
  manualOfflineEnabled,
  offlinePendingWrites,
  offlineStatusLabel,
  offlineReadyState,
  queueOfflineWrite,
  setManualOfflineEnabled,
  trackOfflineWrite,
} from '../src/offlineSupport.js';

function installBrowserStorage() {
  const values = new Map();
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    dispatchEvent: () => true,
  };
  return () => {
    delete globalThis.window;
    delete globalThis.CustomEvent;
  };
}

test('offline writes return immediately and remain pending until Firestore confirms them', async () => {
  const cleanup = installBrowserStorage();
  clearOfflinePendingWrites();
  let confirmWrite;
  const remoteWrite = new Promise((resolve) => { confirmWrite = resolve; });

  const result = await queueOfflineWrite(() => remoteWrite, '測驗結果');
  assert.deepEqual(result, { queuedOffline: true });
  assert.equal(offlinePendingWrites(), 1);

  confirmWrite();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(offlinePendingWrites(), 0);
  cleanup();
});

test('an already-started Firestore write can be released to finish in the background', async () => {
  const cleanup = installBrowserStorage();
  clearOfflinePendingWrites();
  let confirmWrite;
  const remoteWrite = new Promise((resolve) => { confirmWrite = resolve; });

  const result = await trackOfflineWrite(remoteWrite, '新增單字');
  assert.deepEqual(result, { queuedOffline: true });
  assert.equal(offlinePendingWrites(), 1);

  confirmWrite();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(offlinePendingWrites(), 0);
  cleanup();
});

test('a pending write overrides stale progress and eventually warns without claiming success', () => {
  const state = {
    online: true,
    manual: false,
    pendingWrites: 1,
    progress: '離線資料已就緒',
    error: '',
    syncDelayed: false,
  };
  assert.equal(offlineStatusLabel(state), '正在同步 1 筆離線操作...');
  assert.match(offlineStatusLabel({ ...state, syncDelayed: true }), /尚未收到 Firebase 確認/);
  assert.match(offlineStatusLabel({ ...state, online: false }), /等待同步/);
  assert.equal(offlineStatusLabel({ ...state, pendingWrites: 0 }), '離線資料已就緒');
});

test('offline readiness belongs to the signed-in user', () => {
  const cleanup = installBrowserStorage();
  const ready = markOfflineReady('user-a', { documentCount: 12 });
  assert.deepEqual(offlineReadyState('user-a'), ready);
  assert.equal(offlineReadyState('user-b'), null);
  cleanup();
});

test('manual offline mode persists on the device and counts as offline', async () => {
  const cleanup = installBrowserStorage();
  assert.equal(manualOfflineEnabled(), false);

  setManualOfflineEnabled(true);
  assert.equal(manualOfflineEnabled(), true);
  const { isBrowserOffline } = await import('../src/offlineSupport.js');
  assert.equal(isBrowserOffline(), true);

  setManualOfflineEnabled(false);
  assert.equal(manualOfflineEnabled(), false);
  cleanup();
});

test('offline data coverage tracks independently loaded sections', async () => {
  const cleanup = installBrowserStorage();
  const { clearOfflineDataCoverage, markOfflineSectionReady, offlineDataCoverage } = await import('../src/offlineSupport.js');
  markOfflineSectionReady('user-a', 'records');
  markOfflineSectionReady('user-a', 'folders');
  assert.deepEqual(Object.keys(offlineDataCoverage('user-a')).sort(), ['folders', 'records']);
  assert.deepEqual(offlineDataCoverage('user-b'), {});
  clearOfflineDataCoverage('user-a');
  assert.deepEqual(offlineDataCoverage('user-a'), {});
  cleanup();
});
