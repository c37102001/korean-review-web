import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeRecordDocuments,
  clearCollectionSyncCheckpoints,
  collectionSyncCheckpoint,
  firestoreTimestampMillis,
  mergeRecordDocuments,
  recordSyncCheckpoint,
  updateCollectionSyncCheckpoint,
  updateRecordSyncCheckpoint,
} from '../src/firestoreSync.js';
import { firestoreTimestampIso } from '../src/shared/firestoreTimestamp.js';

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

test('collection checkpoints are isolated and can be cleared together', () => {
  const cleanup = installStorage();
  updateCollectionSyncCheckpoint('uid', 'folders', [{ updatedAt: '2026-09-14T01:00:00.000Z' }]);
  updateCollectionSyncCheckpoint('uid', 'grammarNotes', [{ updatedAt: '2026-09-14T02:00:00.000Z' }]);
  assert.equal(collectionSyncCheckpoint('uid', 'folders').updatedAtMillis, Date.parse('2026-09-14T01:00:00.000Z'));
  assert.equal(collectionSyncCheckpoint('uid', 'grammarNotes').updatedAtMillis, Date.parse('2026-09-14T02:00:00.000Z'));
  assert.equal(collectionSyncCheckpoint('other-user', 'folders'), null);
  clearCollectionSyncCheckpoints('uid', ['folders', 'grammarNotes']);
  assert.equal(collectionSyncCheckpoint('uid', 'folders'), null);
  assert.equal(collectionSyncCheckpoint('uid', 'grammarNotes'), null);
  cleanup();
});

test('Firestore timestamps normalize to stable ISO strings for sorting and display', () => {
  assert.equal(
    firestoreTimestampIso({ seconds: 1_789_344_000, nanoseconds: 123_000_000 }),
    '2026-09-14T00:00:00.123Z',
  );
  assert.equal(firestoreTimestampIso('2026-09-14T01:00:00.000Z'), '2026-09-14T01:00:00.000Z');
  assert.equal(firestoreTimestampIso({ seconds: 0, nanoseconds: 0 }), '1970-01-01T00:00:00.000Z');
  assert.equal(firestoreTimestampIso(null), '');
});
