import {
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import {
  isSystemFolder,
  normalizeFolder,
  READING_SOURCE_FOLDER_ID,
  READING_SOURCE_FOLDER_NAME,
  YT_SOURCE_FOLDER_ID,
  YT_SOURCE_FOLDER_NAME,
} from '../folders/model.js';
import { isBrowserOffline } from '../offlineSupport.js';
import { retryFirestoreWrite } from '../repositories/firestoreWriteRepository.js';
import { buildRecordLookup, normalizeItemToV2 } from '../words/records.js';

const MAX_ATOMIC_RECORD_WRITES = 450;

export async function writeLearningRecords(
  uid,
  records,
  onProgress,
  folderIds = [],
  additionalFolderWordIds = [],
  foldersToCreate = [],
  folderPatches = [],
  removeFolderIds = [],
) {
  let queuedOffline = isBrowserOffline();
  const uniqueFolderIds = [...new Set(folderIds)].filter(Boolean);
  const extraWordIds = [...new Set(additionalFolderWordIds)].filter(Boolean);
  const newFolders = foldersToCreate.filter((folder) => folder?.id && folder?.name);
  const normalizedFolderPatches = folderPatches
    .filter((patch) => patch?.id)
    .map((patch) => ({ id: String(patch.id), data: patch.data || {} }));
  const uniqueRemoveFolderIds = [...new Set(removeFolderIds)].filter(Boolean);
  if (!records.length && (!uniqueFolderIds.length || !extraWordIds.length)
    && !newFolders.length && !normalizedFolderPatches.length && !uniqueRemoveFolderIds.length) return;
  if (records.length > MAX_ATOMIC_RECORD_WRITES) {
    throw new Error(`一次最多可以寫入 ${MAX_ATOMIC_RECORD_WRITES} 筆單字，請縮小匯入範圍`);
  }
  if (records.length + uniqueFolderIds.length + newFolders.length
    + normalizedFolderPatches.length + uniqueRemoveFolderIds.length > 500) {
    throw new Error('單字與資料夾更新超過 Firebase 單次批次上限');
  }
  const newFolderIds = newFolders.map((folder) => folder.id);
  const patchedFolderIds = normalizedFolderPatches.map((patch) => patch.id);
  const allFolderIds = [...uniqueFolderIds, ...newFolderIds, ...patchedFolderIds];
  if (new Set(newFolderIds).size !== newFolderIds.length
    || new Set(patchedFolderIds).size !== patchedFolderIds.length
    || new Set(allFolderIds).size !== allFolderIds.length) {
    throw new Error('資料夾寫入資料有重複 ID');
  }
  if (uniqueRemoveFolderIds.some((folderId) => allFolderIds.includes(folderId))) {
    throw new Error('同一個資料夾不能同時加入及移除單字');
  }

  const lookup = buildRecordLookup(records);
  const normalizedRecords = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    onProgress?.({
      phase: 'preparing',
      current: index + 1,
      total: records.length,
      ko: record.item?.ko || record.id,
      detail: `正在整理第 ${index + 1}/${records.length} 筆：${record.item?.ko || record.id}`,
    });
    normalizedRecords.push({ ...record, item: normalizeItemToV2(record.item, record.id, lookup) });
    if (onProgress) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const recordIds = [...new Set([...normalizedRecords.map((record) => record.id), ...extraWordIds])];
  if (recordIds.some((recordId) => !recordId)) throw new Error('寫入資料缺少必要的單字 ID');
  if (new Set(recordIds).size !== recordIds.length) throw new Error('寫入資料中含有重複的單字 ID');
  const normalizedNewFolders = newFolders.map((folder) => normalizeFolder({
    ...folder,
    wordIds: [...new Set([...(folder.wordIds || []), ...recordIds])],
  }, folder.id));
  onProgress?.({
    phase: 'uploading',
    current: records.length,
    total: records.length,
    detail: `已準備 ${records.length} 筆，正在以單一批次送往 Firebase，等待伺服器確認`,
  });
  const uploadStartedAt = Date.now();
  const waitingTimer = onProgress ? setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - uploadStartedAt) / 1000));
    onProgress({
      phase: 'uploading',
      current: records.length,
      total: records.length,
      detail: `Firebase 批次已送出，已等待 ${elapsedSeconds} 秒；請保持視窗開啟`,
    });
  }, 5000) : null;
  try {
    const writeResult = await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      normalizedRecords.forEach((record) => batch.set(
        doc(db, 'users', uid, 'records', record.id),
        { ...record, updatedAt: serverTimestamp() },
      ));
      uniqueFolderIds.forEach((folderId) => batch.set(
        doc(db, 'users', uid, 'folders', folderId),
        { wordIds: arrayUnion(...recordIds), updatedAt: serverTimestamp() },
        { merge: true },
      ));
      uniqueRemoveFolderIds.forEach((folderId) => batch.set(
        doc(db, 'users', uid, 'folders', folderId),
        { wordIds: arrayRemove(...recordIds), updatedAt: serverTimestamp() },
        { merge: true },
      ));
      normalizedNewFolders.forEach((folder) => batch.set(
        doc(db, 'users', uid, 'folders', folder.id),
        { ...folder, updatedAt: serverTimestamp() },
      ));
      normalizedFolderPatches.forEach((patch) => batch.set(
        doc(db, 'users', uid, 'folders', patch.id),
        { ...patch.data, wordIds: arrayUnion(...recordIds), updatedAt: serverTimestamp() },
        { merge: true },
      ));
      await batch.commit();
    });
    if (writeResult?.queuedOffline) queuedOffline = true;
  } finally {
    if (waitingTimer) clearInterval(waitingTimer);
  }
  onProgress?.({
    phase: 'success',
    current: records.length,
    total: records.length,
    detail: queuedOffline
      ? `已將 ${records.length} 筆變更儲存在此裝置，恢復連線後會自動同步`
      : `Firebase 已確認完成 ${records.length} 筆寫入`,
  });
}

export function sourceFolderWritePlan(folders, source, selectedFolderIds = []) {
  const matchingFolder = folders.find((folder) => (
    !isSystemFolder(folder) && folder.name.toLocaleLowerCase() === source.folderName.toLocaleLowerCase()
  ));
  if (matchingFolder) {
    return {
      folderIds: [...new Set([...selectedFolderIds, matchingFolder.id])],
      foldersToCreate: [],
    };
  }
  const now = new Date().toISOString();
  return {
    folderIds: [...new Set(selectedFolderIds)].filter((folderId) => folderId !== source.folderId),
    foldersToCreate: [normalizeFolder({
      id: source.folderId,
      name: source.folderName,
      tag: source.folderName,
      wordIds: [],
      createdAt: now,
      updatedAt: now,
    }, source.folderId)],
  };
}

async function writeSourceLearningRecords(uid, records, folders, source, onProgress, selectedFolderIds = [], additionalFolderWordIds = []) {
  const plan = sourceFolderWritePlan(folders, source, selectedFolderIds);
  await writeLearningRecords(
    uid,
    records,
    onProgress,
    plan.folderIds,
    additionalFolderWordIds,
    plan.foldersToCreate,
  );
}

export async function writeYoutubeSubtitleLearningRecords(uid, records, folders = [], onProgress, folderIds = [], additionalFolderWordIds = []) {
  await writeSourceLearningRecords(uid, records, folders, {
    folderId: YT_SOURCE_FOLDER_ID,
    folderName: YT_SOURCE_FOLDER_NAME,
  }, onProgress, folderIds, additionalFolderWordIds);
}

export async function writeReadingTestLearningRecords(uid, records, folders = [], onProgress, folderIds = [], additionalFolderWordIds = []) {
  await writeSourceLearningRecords(uid, records, folders, {
    folderId: READING_SOURCE_FOLDER_ID,
    folderName: READING_SOURCE_FOLDER_NAME,
  }, onProgress, folderIds, additionalFolderWordIds);
}

export async function writeLearningRecord(uid, record, onProgress, folderIds = []) {
  await writeLearningRecords(uid, [record], onProgress, folderIds);
}

export async function deleteLearningRecords(uid, recordIds, folders = []) {
  const ids = [...new Set(recordIds.filter(Boolean))];
  if (!ids.length) return;
  const affectedFolders = folders.filter((folder) => folder.wordIds.some((wordId) => ids.includes(wordId)));
  if (ids.length + affectedFolders.length > 500) {
    throw new Error('這次刪除超過 Firebase 單次批次上限，請縮小選取範圍');
  }
  await retryFirestoreWrite(async () => {
    const batch = writeBatch(db);
    ids.forEach((recordId) => batch.set(
      doc(db, 'users', uid, 'records', recordId),
      {
        id: recordId,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        item: deleteField(),
        date: deleteField(),
        createdAt: deleteField(),
        order: deleteField(),
      },
      { merge: true },
    ));
    affectedFolders.forEach((folder) => batch.set(
      doc(db, 'users', uid, 'folders', folder.id),
      { wordIds: arrayRemove(...ids), updatedAt: serverTimestamp() },
      { merge: true },
    ));
    await batch.commit();
  });
}

export async function deleteLearningRecord(uid, recordId, folders = []) {
  await deleteLearningRecords(uid, [recordId], folders);
}
