import {
  deleteField,
  doc,
  onSnapshot,
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

export const readingTestsRepository = createUserContentRepository('readingTests', {
  tombstoneFields: ['passage', 'question', 'options', 'answer', 'learned', 'order', 'createdAt'],
});
