import { firestoreTimestampMillis } from './shared/firestoreTimestamp.js';

export { firestoreTimestampMillis } from './shared/firestoreTimestamp.js';

const RECORD_SYNC_STORAGE_KEY = 'korean-review-record-sync-v1';
const RECORD_SYNC_VERSION = 1;

function collectionSyncStorageKey(collectionName) {
  return collectionName === 'records'
    ? RECORD_SYNC_STORAGE_KEY
    : `korean-review-${collectionName}-sync-v1`;
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function firestoreTimestampParts(value) {
  if (!value) return null;
  if (Number.isFinite(value.seconds)) {
    return { seconds: Number(value.seconds), nanoseconds: Number(value.nanoseconds) || 0 };
  }
  const milliseconds = firestoreTimestampMillis(value);
  if (!milliseconds) return null;
  return {
    seconds: Math.floor(milliseconds / 1000),
    nanoseconds: (milliseconds % 1000) * 1_000_000,
  };
}

export function collectionSyncCheckpoint(uid, collectionName) {
  if (!uid) return null;
  try {
    const value = JSON.parse(storage()?.getItem(collectionSyncStorageKey(collectionName)) || 'null');
    if (value?.version !== RECORD_SYNC_VERSION || value.uid !== uid || !Number.isFinite(value.seconds) || !Number.isFinite(value.nanoseconds)) return null;
    return value;
  } catch {
    return null;
  }
}

export function updateCollectionSyncCheckpoint(uid, collectionName, documents = []) {
  if (!uid) return null;
  const previous = collectionSyncCheckpoint(uid, collectionName);
  const latest = documents.reduce((current, entry) => {
    const data = typeof entry?.data === 'function' ? entry.data() : entry;
    const candidate = firestoreTimestampParts(data?.updatedAt);
    if (!candidate) return current;
    if (!current || candidate.seconds > current.seconds || (candidate.seconds === current.seconds && candidate.nanoseconds > current.nanoseconds)) return candidate;
    return current;
  }, previous ? { seconds: previous.seconds, nanoseconds: previous.nanoseconds } : null);
  if (!latest) return previous;
  const value = {
    version: RECORD_SYNC_VERSION,
    uid,
    seconds: latest.seconds,
    nanoseconds: latest.nanoseconds,
    updatedAtMillis: (latest.seconds * 1000) + Math.floor(latest.nanoseconds / 1_000_000),
  };
  storage()?.setItem(collectionSyncStorageKey(collectionName), JSON.stringify(value));
  return value;
}

export function clearCollectionSyncCheckpoint(uid = '', collectionName = 'records') {
  const current = collectionSyncCheckpoint(uid, collectionName);
  if (!uid || current?.uid === uid) storage()?.removeItem(collectionSyncStorageKey(collectionName));
}

export function clearCollectionSyncCheckpoints(uid = '', collectionNames = []) {
  collectionNames.forEach((collectionName) => clearCollectionSyncCheckpoint(uid, collectionName));
}

export const recordSyncCheckpoint = (uid) => collectionSyncCheckpoint(uid, 'records');
export const updateRecordSyncCheckpoint = (uid, documents = []) => updateCollectionSyncCheckpoint(uid, 'records', documents);
export const clearRecordSyncCheckpoint = (uid = '') => clearCollectionSyncCheckpoint(uid, 'records');

function recordFromDocument(entry) {
  if (!entry) return null;
  const data = typeof entry.data === 'function' ? entry.data() : entry;
  const id = String(data?.id || entry.id || data?._docId || '');
  return id ? { ...data, id } : null;
}

export function mergeCollectionDocuments(currentRecords = [], documents = []) {
  const byId = new Map(currentRecords.map((record) => [record.id, record]));
  documents.forEach((entry) => {
    const record = recordFromDocument(entry);
    if (!record) return;
    if (record.deletedAt) byId.delete(record.id);
    else byId.set(record.id, record);
  });
  return [...byId.values()];
}

export function activeCollectionDocuments(documents = []) {
  return mergeCollectionDocuments([], documents);
}

export const mergeRecordDocuments = mergeCollectionDocuments;
export const activeRecordDocuments = activeCollectionDocuments;
