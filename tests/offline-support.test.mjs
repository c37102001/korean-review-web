import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearOfflinePendingWrites,
  markOfflineReady,
  offlinePendingWrites,
  offlineReadyState,
  queueOfflineWrite,
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

test('offline readiness belongs to the signed-in user', () => {
  const cleanup = installBrowserStorage();
  const ready = markOfflineReady('user-a', { documentCount: 12 });
  assert.deepEqual(offlineReadyState('user-a'), ready);
  assert.equal(offlineReadyState('user-b'), null);
  cleanup();
});
