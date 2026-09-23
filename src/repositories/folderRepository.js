import {
  arrayRemove,
  arrayUnion,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { retryFirestoreWrite } from './firestoreWriteRepository.js';
import { createUserContentRepository, tombstonePayload } from './userContentRepository.js';
import { SYSTEM_LEARNED_FOLDER_ID } from '../folders/model.js';

const contentRepository = createUserContentRepository('folders');

function uniqueIds(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

export const folderRepository = {
  subscribe: contentRepository.subscribe,
  async save(uid, folder) {
    await contentRepository.save(uid, folder.id, folder);
  },
  async ensure(uid, folder) {
    await retryFirestoreWrite(() => runTransaction(db, async (transaction) => {
      const reference = doc(db, 'users', uid, 'folders', folder.id);
      const snapshot = await transaction.get(reference);
      if (snapshot.exists() && !snapshot.data()?.deletedAt) return;
      transaction.set(reference, {
        ...folder,
        updatedAt: serverTimestamp(),
      });
    }));
  },
  async remove(uid, folderId) {
    await retryFirestoreWrite(() => setDoc(
      doc(db, 'users', uid, 'folders', folderId),
      tombstonePayload(folderId, ['name', 'wordIds', 'tag', 'createdAt', 'pinned']),
      { merge: true },
    ));
  },
  async addWords(uid, folderId, wordIds, markNoReview = folderId === SYSTEM_LEARNED_FOLDER_ID) {
    const ids = uniqueIds(wordIds);
    if (!ids.length) return;
    if (markNoReview && ids.length > 490) throw new Error('一次最多可以將 490 個單字加入已學習');
    await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', uid, 'folders', folderId), {
        wordIds: arrayUnion(...ids), updatedAt: serverTimestamp(),
      }, { merge: true });
      if (markNoReview) ids.forEach((id) => batch.set(
        doc(db, 'users', uid, 'records', id),
        { item: { noReview: true }, updatedAt: serverTimestamp() },
        { merge: true },
      ));
      await batch.commit();
    });
  },
  async removeWords(uid, folderId, wordIds, markNoReview = folderId === SYSTEM_LEARNED_FOLDER_ID) {
    const ids = uniqueIds(wordIds);
    if (!ids.length) return;
    if (markNoReview && ids.length > 490) throw new Error('一次最多可以從已學習移出 490 個單字');
    await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', uid, 'folders', folderId), {
        wordIds: arrayRemove(...ids), updatedAt: serverTimestamp(),
      }, { merge: true });
      if (markNoReview) ids.forEach((id) => batch.set(
        doc(db, 'users', uid, 'records', id),
        { item: { noReview: true }, updatedAt: serverTimestamp() },
        { merge: true },
      ));
      await batch.commit();
    });
  },
  async addWordsToFolders(uid, folderIds, wordIds, learnedFolderId = SYSTEM_LEARNED_FOLDER_ID) {
    const targetFolderIds = uniqueIds(folderIds);
    const ids = uniqueIds(wordIds);
    if (!targetFolderIds.length || !ids.length) return;
    const markNoReview = targetFolderIds.includes(learnedFolderId);
    if (targetFolderIds.length + (markNoReview ? ids.length : 0) > 500) throw new Error('這次更新超過 Firebase 單次批次上限');
    await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      targetFolderIds.forEach((folderId) => batch.set(
        doc(db, 'users', uid, 'folders', folderId),
        { wordIds: arrayUnion(...ids), updatedAt: serverTimestamp() },
        { merge: true },
      ));
      if (markNoReview) ids.forEach((id) => batch.set(
        doc(db, 'users', uid, 'records', id),
        { item: { noReview: true }, updatedAt: serverTimestamp() },
        { merge: true },
      ));
      await batch.commit();
    });
  },
  async createAndAssign(uid, folder, additionalFolderIds = [], learnedFolderId = SYSTEM_LEARNED_FOLDER_ID) {
    const targetFolderIds = uniqueIds(additionalFolderIds);
    const markNoReview = targetFolderIds.includes(learnedFolderId);
    if (targetFolderIds.length + 1 + (markNoReview ? folder.wordIds.length : 0) > 500) throw new Error('這次更新超過 Firebase 單次批次上限');
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
      if (markNoReview) uniqueIds(folder.wordIds).forEach((id) => batch.set(
        doc(db, 'users', uid, 'records', id),
        { item: { noReview: true }, updatedAt: serverTimestamp() },
        { merge: true },
      ));
      await batch.commit();
    });
  },
};
