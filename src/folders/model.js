export const SYSTEM_LEARNED_FOLDER_ID = 'system-learned';
export const SYSTEM_LEARNED_FOLDER_NAME = '已學習';
export const SYSTEM_UNFAMILIAR_FOLDER_ID = 'system-unfamiliar';
export const SYSTEM_UNFAMILIAR_FOLDER_NAME = '不熟悉';
export const YT_SOURCE_FOLDER_ID = 'source-yt-subtitles';
export const YT_SOURCE_FOLDER_NAME = 'YT字幕';
export const READING_SOURCE_FOLDER_ID = 'source-reading-tests';
export const READING_SOURCE_FOLDER_NAME = '閱讀測驗';
export const UNTAGGED_FOLDER_LABEL = '無標籤';

export function normalizeFolder(folder, fallbackId = '') {
  return {
    id: String(folder?.id || fallbackId),
    name: String(folder?.name || '').trim(),
    tag: String(folder?.tag || '').trim(),
    pinned: folder?.pinned === true,
    wordIds: [...new Set((Array.isArray(folder?.wordIds) ? folder.wordIds : []).filter(Boolean).map(String))],
    createdAt: String(folder?.createdAt || ''),
    updatedAt: String(folder?.updatedAt || ''),
    systemKey: String(folder?.systemKey || ''),
  };
}

export function folderTagLabel(folder) {
  return String(folder?.tag || '').trim() || UNTAGGED_FOLDER_LABEL;
}

export function groupFoldersByTag(folders = []) {
  const groups = new Map();
  folders.forEach((folder) => {
    const label = folderTagLabel(folder);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(folder);
  });
  return [...groups.entries()]
    .map(([label, groupedFolders]) => ({ label, folders: groupedFolders }))
    .sort((left, right) => {
      if (left.label === UNTAGGED_FOLDER_LABEL) return 1;
      if (right.label === UNTAGGED_FOLDER_LABEL) return -1;
      return left.label.localeCompare(right.label, 'zh-TW');
    });
}

export function toggleFolderGroupSelection(selectedFolderIds = [], groupFolderIds = []) {
  const selected = new Set(selectedFolderIds);
  const allSelected = groupFolderIds.length > 0 && groupFolderIds.every((folderId) => selected.has(folderId));
  if (allSelected) groupFolderIds.forEach((folderId) => selected.delete(folderId));
  else groupFolderIds.forEach((folderId) => selected.add(folderId));
  return [...selected];
}

export function isLearnedFolder(folder) {
  return folder?.id === SYSTEM_LEARNED_FOLDER_ID
    || folder?.systemKey === 'learned'
    || folder?.name === SYSTEM_LEARNED_FOLDER_NAME;
}

export function isUnfamiliarFolder(folder) {
  return folder?.id === SYSTEM_UNFAMILIAR_FOLDER_ID
    || folder?.systemKey === 'unfamiliar'
    || folder?.name === SYSTEM_UNFAMILIAR_FOLDER_NAME;
}

export function isSystemFolder(folder) {
  return isLearnedFolder(folder) || isUnfamiliarFolder(folder);
}

export function systemFolderRank(folder) {
  if (isLearnedFolder(folder)) return 0;
  if (isUnfamiliarFolder(folder)) return 1;
  return 2;
}

export function defaultLearnedFolder(now = new Date().toISOString()) {
  return normalizeFolder({
    id: SYSTEM_LEARNED_FOLDER_ID,
    name: SYSTEM_LEARNED_FOLDER_NAME,
    wordIds: [],
    systemKey: 'learned',
    createdAt: now,
    updatedAt: now,
  }, SYSTEM_LEARNED_FOLDER_ID);
}

export function defaultUnfamiliarFolder(now = new Date().toISOString()) {
  return normalizeFolder({
    id: SYSTEM_UNFAMILIAR_FOLDER_ID,
    name: SYSTEM_UNFAMILIAR_FOLDER_NAME,
    wordIds: [],
    systemKey: 'unfamiliar',
    createdAt: now,
    updatedAt: now,
  }, SYSTEM_UNFAMILIAR_FOLDER_ID);
}
