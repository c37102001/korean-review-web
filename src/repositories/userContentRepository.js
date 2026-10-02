import {
  deleteField,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { markOfflineSectionReady } from '../offlineSupport.js';
import { subscribeToIncrementalCollection } from './incrementalCollectionRepository.js';
import { retryFirestoreWrite } from './firestoreWriteRepository.js';

export function tombstonePayload(id, fields = []) {
  return Object.fromEntries([
    ['id', id],
    ['deletedAt', serverTimestamp()],
    ['updatedAt', serverTimestamp()],
    ...fields.map((field) => [field, deleteField()]),
  ]);
}

export function createUserContentRepository(collectionName, { tombstoneFields = [] } = {}) {
  return {
    subscribe(uid, onData, onError) {
      return subscribeToIncrementalCollection({ db, uid, collectionName, onData, onError });
    },
    async save(uid, id, value) {
      await retryFirestoreWrite(() => setDoc(doc(db, 'users', uid, collectionName, id), {
        ...value,
        updatedAt: serverTimestamp(),
      }));
    },
    async saveMany(uid, values) {
      await retryFirestoreWrite(async () => {
        const batch = writeBatch(db);
        values.forEach((value) => batch.set(doc(db, 'users', uid, collectionName, value.id), {
          ...value,
          updatedAt: serverTimestamp(),
        }));
        await batch.commit();
      });
    },
    async remove(uid, id) {
      await retryFirestoreWrite(() => setDoc(
        doc(db, 'users', uid, collectionName, id),
        tombstonePayload(id, tombstoneFields),
        { merge: true },
      ));
    },
  };
}

export function subscribeUserSetting(uid, settingName, onData, onError) {
  return onSnapshot(
    doc(db, 'users', uid, 'settings', settingName),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
        markOfflineSectionReady(uid, settingName);
      }
      onData(snapshot.exists() ? snapshot.data() : null);
    },
    onError,
  );
}

export async function saveUserSetting(uid, settingName, value) {
  await retryFirestoreWrite(() => setDoc(
    doc(db, 'users', uid, 'settings', settingName),
    value,
    { merge: true },
  ));
}

export const grammarNotesRepository = createUserContentRepository('grammarNotes', {
  tombstoneFields: ['title', 'notes', 'examples', 'category', 'createdAt', 'pinned'],
});

export const youtubeSubtitlesRepository = createUserContentRepository('ytSubtitles', {
  tombstoneFields: ['title', 'entries', 'youtubeUrl', 'videoId', 'mode', 'tag', 'createdAt', 'learned', 'pinned'],
});

const readingTestsContentRepository = createUserContentRepository('readingTests', {
  tombstoneFields: ['passage', 'question', 'options', 'answer', 'tag', 'learned', 'serialNumber', 'order', 'createdAt'],
});
const READING_TEST_SEQUENCE_SETTING = 'contentSequences';
const READING_TEST_MIGRATION_CHUNK_SIZE = 400;

function positiveSerialNumber(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

async function saveReadingTestsWithSerialNumbers(uid, values, minimumLastNumber = 0, serialOnly = false) {
  let savedValues = [];
  await retryFirestoreWrite(() => runTransaction(db, async (transaction) => {
    const sequenceReference = doc(db, 'users', uid, 'settings', READING_TEST_SEQUENCE_SETTING);
    const references = values.map((value) => doc(db, 'users', uid, 'readingTests', value.id));
    const [sequenceSnapshot, ...snapshots] = await Promise.all([
      transaction.get(sequenceReference),
      ...references.map((reference) => transaction.get(reference)),
    ]);
    let lastNumber = Math.max(
      positiveSerialNumber(sequenceSnapshot.data()?.lastReadingTestNumber),
      positiveSerialNumber(minimumLastNumber),
      ...snapshots.map((snapshot) => positiveSerialNumber(snapshot.data()?.serialNumber)),
    );
    savedValues = values.map((value, index) => {
      const existingNumber = positiveSerialNumber(snapshots[index].data()?.serialNumber);
      const serialNumber = existingNumber || ++lastNumber;
      return { ...value, serialNumber };
    });
    savedValues.forEach((value, index) => {
      if (serialOnly) {
        transaction.set(references[index], {
          serialNumber: value.serialNumber,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else {
        transaction.set(references[index], { ...value, updatedAt: serverTimestamp() });
      }
    });
    transaction.set(sequenceReference, {
      lastReadingTestNumber: lastNumber,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }));
  return savedValues;
}

export const readingTestsRepository = {
  ...readingTestsContentRepository,
  async saveMany(uid, values) {
    return saveReadingTestsWithSerialNumbers(uid, values);
  },
  async ensureSerialNumbers(uid, values) {
    const knownMaximum = Math.max(0, ...values.map((value) => positiveSerialNumber(value.serialNumber)));
    const missing = values
      .filter((value) => !positiveSerialNumber(value.serialNumber))
      .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
        || Number(left.order || 0) - Number(right.order || 0)
        || String(left.id).localeCompare(String(right.id)));
    let minimumLastNumber = knownMaximum;
    const assigned = new Map();
    for (let start = 0; start < missing.length; start += READING_TEST_MIGRATION_CHUNK_SIZE) {
      const saved = await saveReadingTestsWithSerialNumbers(
        uid,
        missing.slice(start, start + READING_TEST_MIGRATION_CHUNK_SIZE),
        minimumLastNumber,
        true,
      );
      saved.forEach((value) => assigned.set(value.id, value));
      minimumLastNumber = Math.max(minimumLastNumber, ...saved.map((value) => value.serialNumber));
    }
    return values.map((value) => assigned.get(value.id) || value);
  },
};
