import { useCallback, useEffect, useState } from 'react';
import {
  defaultLearnedFolder,
  defaultUnfamiliarFolder,
  isLearnedFolder,
  isSystemFolder,
  isUnfamiliarFolder,
  normalizeFolder,
  SYSTEM_LEARNED_FOLDER_ID,
  SYSTEM_LEARNED_FOLDER_NAME,
  SYSTEM_UNFAMILIAR_FOLDER_NAME,
  systemFolderRank,
} from '../../../folders/model.js';
import { folderRepository } from '../../../repositories/folderRepository.js';
import { createId } from '../../../shared/id.js';

function sortFolders(folders) {
  return [...folders].sort((left, right) => (
    systemFolderRank(left) - systemFolderRank(right)
      || (right.createdAt || '').localeCompare(left.createdAt || '')
      || left.name.localeCompare(right.name)
  ));
}

export function useWordFolders(user, enabled = true) {
  const [state, setState] = useState({ folders: [], loading: false, error: '' });

  useEffect(() => {
    if (!user || !enabled) {
      setState({ folders: [], loading: false, error: '' });
      return undefined;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    return folderRepository.subscribe(
      user.uid,
      (documents) => {
        let folders = sortFolders(documents
          .map((folder) => normalizeFolder(folder, folder.id))
          .filter((folder) => folder.name));
        const missingSystemFolders = [];
        if (!folders.some(isLearnedFolder)) missingSystemFolders.push(defaultLearnedFolder());
        if (!folders.some(isUnfamiliarFolder)) missingSystemFolders.push(defaultUnfamiliarFolder());
        if (missingSystemFolders.length) {
          folders = sortFolders([...missingSystemFolders, ...folders]);
          missingSystemFolders.forEach((folder) => {
            folderRepository.ensure(user.uid, folder)
              .catch((error) => setState((current) => ({
                ...current,
                error: `建立${folder.name}資料夾失敗：${error.message}`,
              })));
          });
        }
        setState({ folders, loading: false, error: '' });
      },
      (error) => setState((current) => ({ ...current, loading: false, error: error.message })),
    );
  }, [user, enabled]);

  const save = useCallback(async (input) => {
    if (!user) throw new Error('尚未登入');
    const id = input?.id || createId();
    const existing = state.folders.find((folder) => folder.id === id);
    const systemFolder = isSystemFolder(existing || input);
    const name = systemFolder
      ? String(existing?.name || input?.name || '').trim()
      : String(input?.name || '').trim();
    if (!name) throw new Error('請輸入資料夾名稱');
    const duplicate = state.folders.find((folder) => (
      folder.name.toLocaleLowerCase() === name.toLocaleLowerCase() && folder.id !== input?.id
    ));
    if (duplicate) throw new Error(`已經有名為「${name}」的資料夾`);
    const now = new Date().toISOString();
    const folder = normalizeFolder({
      ...existing,
      ...input,
      id,
      name,
      wordIds: existing?.wordIds || input?.wordIds || [],
      createdAt: existing?.createdAt || input?.createdAt || now,
      updatedAt: now,
    }, id);
    await folderRepository.save(user.uid, folder);
    return folder;
  }, [user, state.folders]);

  const remove = useCallback(async (folderId) => {
    if (!user) throw new Error('尚未登入');
    if (isSystemFolder(state.folders.find((folder) => folder.id === folderId) || { id: folderId })) {
      throw new Error('系統資料夾無法刪除');
    }
    await folderRepository.remove(user.uid, folderId);
  }, [user, state.folders]);

  const addWords = useCallback(async (folderId, wordIds) => {
    if (!user) throw new Error('尚未登入');
    await folderRepository.addWords(user.uid, folderId, wordIds, isLearnedFolder(state.folders.find((folder) => folder.id === folderId) || { id: folderId }));
  }, [user, state.folders]);

  const removeWords = useCallback(async (folderId, wordIds, preserveNoReview = true) => {
    if (!user) throw new Error('尚未登入');
    await folderRepository.removeWords(user.uid, folderId, wordIds, preserveNoReview && isLearnedFolder(state.folders.find((folder) => folder.id === folderId) || { id: folderId }));
  }, [user, state.folders]);

  const addWordsToFolders = useCallback(async (folderIds, wordIds) => {
    if (!user) throw new Error('尚未登入');
    await folderRepository.addWordsToFolders(user.uid, folderIds, wordIds, state.folders.find(isLearnedFolder)?.id || SYSTEM_LEARNED_FOLDER_ID);
  }, [user, state.folders]);

  const createFolderAndAssign = useCallback(async (nameInput, wordIds, additionalFolderIds = [], tagInput = '') => {
    if (!user) throw new Error('尚未登入');
    const name = String(nameInput || '').trim();
    if (!name) throw new Error('請輸入新資料夾名稱');
    if ([SYSTEM_LEARNED_FOLDER_NAME, SYSTEM_UNFAMILIAR_FOLDER_NAME].includes(name)) {
      throw new Error(`「${name}」是系統保留資料夾`);
    }
    const duplicate = state.folders.find((folder) => (
      folder.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    ));
    if (duplicate) throw new Error(`已經有名為「${name}」的資料夾，請直接勾選它`);
    const ids = [...new Set(wordIds.filter(Boolean).map(String))];
    if (!ids.length) throw new Error('請先選取要加入的單字');
    const now = new Date().toISOString();
    const folder = normalizeFolder({
      id: createId(),
      name,
      tag: String(tagInput || '').trim(),
      wordIds: ids,
      createdAt: now,
      updatedAt: now,
    });
    await folderRepository.createAndAssign(user.uid, folder, additionalFolderIds, state.folders.find(isLearnedFolder)?.id || SYSTEM_LEARNED_FOLDER_ID);
    return folder;
  }, [user, state.folders]);

  return {
    ...state,
    save,
    remove,
    addWords,
    removeWords,
    addWordsToFolders,
    createFolderAndAssign,
  };
}
