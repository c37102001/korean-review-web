import {
  arrayRemove,
  arrayUnion,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { retryFirestoreWrite } from './firestoreWriteRepository.js';
import { createUserContentRepository, tombstonePayload } from './userContentRepository.js';

const contentRepository = createUserContentRepository('folders');

function uniqueIds(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

export const folderRepository = {
  subscribe: contentRepository.subscribe,
  async save(uid, folder) {
    await contentRepository.save(uid, folder.id, folder);
  },
  async remove(uid, folderId) {
    await retryFirestoreWrite(() => setDoc(
      doc(db, 'users', uid, 'folders', folderId),
      tombstonePayload(folderId, ['name', 'wordIds', 'tag', 'createdAt', 'pinned']),
      { merge: true },
    ));
  },
  async addWords(uid, folderId, wordIds) {
    const ids = uniqueIds(wordIds);
    if (!ids.length) return;
    await retryFirestoreWrite(() => setDoc(doc(db, 'users', uid, 'folders', folderId), {
      wordIds: arrayUnion(...ids),
      updatedAt: serverTimestamp(),
    }, { merge: true }));
  },
  async removeWords(uid, folderId, wordIds) {
    const ids = uniqueIds(wordIds);
    if (!ids.length) return;
    await retryFirestoreWrite(() => setDoc(doc(db, 'users', uid, 'folders', folderId), {
      wordIds: arrayRemove(...ids),
      updatedAt: serverTimestamp(),
    }, { merge: true }));
  },
  async addWordsToFolders(uid, folderIds, wordIds) {
    const targetFolderIds = uniqueIds(folderIds);
    const ids = uniqueIds(wordIds);
    if (!targetFolderIds.length || !ids.length) return;
    if (targetFolderIds.length > 500) throw new Error('一次最多可以更新 500 個資料夾');
    await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      targetFolderIds.forEach((folderId) => batch.set(
        doc(db, 'users', uid, 'folders', folderId),
        { wordIds: arrayUnion(...ids), updatedAt: serverTimestamp() },
        { merge: true },
      ));
      await batch.commit();
    });
  },
  async createAndAssign(uid, folder, additionalFolderIds = []) {
    const targetFolderIds = uniqueIds(additionalFolderIds);
    if (targetFolderIds.length + 1 > 500) throw new Error('這次更新的資料夾數量超過 Firebase 單次批次上限');
    await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', uid, 'folders', folder.id), {
        ...folder,
        updatedAt: serverTimestamp(),
      });
      targetFolderIds.forEach((folderId) => batch.set(
        doc(db, 'users', uid, 'folders', folderId),
        { wordIds: arrayUnion(...folder.wordIds), updatedAt: serverTimestamp() },
        { merge: true },
      ));
      await batch.commit();
    });
  },
};
