import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeRecordDocuments,
  firestoreTimestampMillis,
  mergeRecordDocuments,
  recordSyncCheckpoint,
  updateRecordSyncCheckpoint,
} from '../src/firestoreSync.js';

function installStorage() {
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  return () => { delete globalThis.window; };
}

const document = (id, data) => ({ id, data: () => data });

test('record deltas replace changed cards and remove tombstones', () => {
  const current = [{ id: 'a', item: { ko: '가' } }, { id: 'b', item: { ko: '나' } }];
  const result = mergeRecordDocuments(current, [
    document('a', { id: 'a', item: { ko: '각' } }),
    document('b', { id: 'b', deletedAt: '2026-09-14T00:00:00Z' }),
    document('c', { id: 'c', item: { ko: '다' } }),
  ]);
  assert.deepEqual(result.map((record) => [record.id, record.item.ko]), [['a', '각'], ['c', '다']]);
  assert.deepEqual(activeRecordDocuments([document('b', { deletedAt: 'now' })]), []);
});

test('record checkpoint only advances to the latest server timestamp', () => {
  const cleanup = installStorage();
  updateRecordSyncCheckpoint('uid', [
    { updatedAt: '2026-09-14T01:00:00.000Z' },
    { updatedAt: { seconds: 1789349400, nanoseconds: 0 } },
  ]);
  const first = recordSyncCheckpoint('uid');
  assert.equal(first.updatedAtMillis, 1789349400000);
  updateRecordSyncCheckpoint('uid', [{ updatedAt: '2026-09-13T00:00:00.000Z' }]);
  assert.equal(recordSyncCheckpoint('uid').updatedAtMillis, first.updatedAtMillis);
  assert.equal(firestoreTimestampMillis({ toMillis: () => 1234 }), 1234);
  cleanup();
});
