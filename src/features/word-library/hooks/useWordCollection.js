import { useCallback, useEffect, useMemo, useState } from 'react';

import { deriveWordCollection, UNFILED_FOLDER_FILTER_ID } from '../collection/model.js';

function toggleValue(values, value) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function retainIds(values, availableIds) {
  const next = values.filter((value) => availableIds.has(value));
  return next.length === values.length ? values : next;
}

export function useWordCollection({
  items = [],
  questions = [],
  store = {},
  folders = [],
  sourceKey = '',
  defaultSort = 'source',
  pageSize = 0,
  resetFolderFiltersOnSourceChange = false,
} = {}) {
  const [query, setQuery] = useState('');
  const [searchScope, setSearchScope] = useState('word');
  const [selectedLevels, setSelectedLevels] = useState([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [sort, setSort] = useState(defaultSort);
  const [pageNumber, setPageNumber] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showAllChinese, setShowAllChinese] = useState(false);
  const [chineseVisibilityOverrides, setChineseVisibilityOverrides] = useState({});

  const derived = useMemo(() => deriveWordCollection({
    items,
    questions,
    store,
    folders,
    query,
    searchScope,
    selectedLevels,
    selectedFolderIds,
    sort,
    pageNumber,
    pageSize,
  }), [items, questions, store, folders, query, searchScope, selectedLevels, selectedFolderIds, sort, pageNumber, pageSize]);

  useEffect(() => setPageNumber(1), [query, searchScope, selectedLevels, selectedFolderIds, sort]);

  useEffect(() => {
    setPageNumber(1);
    setSelectedIds([]);
    setShowAllChinese(false);
    setChineseVisibilityOverrides({});
    if (resetFolderFiltersOnSourceChange) setSelectedFolderIds([]);
  }, [sourceKey, resetFolderFiltersOnSourceChange]);

  useEffect(() => {
    const availableFolderIds = new Set([UNFILED_FOLDER_FILTER_ID, ...folders.map((folder) => folder.id)]);
    setSelectedFolderIds((current) => retainIds(current, availableFolderIds));
  }, [folders]);

  useEffect(() => {
    const availableWordIds = new Set(items.map((item) => item.id));
    setSelectedIds((current) => retainIds(current, availableWordIds));
    setChineseVisibilityOverrides((current) => Object.fromEntries(
      Object.entries(current).filter(([itemId]) => availableWordIds.has(itemId)),
    ));
  }, [items]);

  useEffect(() => {
    const filteredWordIds = new Set(derived.filteredItems.map((item) => item.id));
    setSelectedIds((current) => retainIds(current, filteredWordIds));
  }, [derived.filteredItems]);

  useEffect(() => {
    if (pageNumber !== derived.pageNumber) setPageNumber(derived.pageNumber);
  }, [derived.pageNumber, pageNumber]);

  const toggleSelected = useCallback((itemId) => {
    setSelectedIds((current) => toggleValue(current, itemId));
  }, []);
  const toggleLevel = useCallback((level) => {
    setSelectedLevels((current) => toggleValue(current, level));
  }, []);
  const toggleFolder = useCallback((folderId) => {
    setSelectedFolderIds((current) => toggleValue(current, folderId));
  }, []);
  const isChineseVisible = useCallback((itemId) => (
    Object.hasOwn(chineseVisibilityOverrides, itemId)
      ? chineseVisibilityOverrides[itemId]
      : showAllChinese
  ), [chineseVisibilityOverrides, showAllChinese]);
  const toggleChinese = useCallback((itemId) => {
    setChineseVisibilityOverrides((current) => {
      const currentlyVisible = Object.hasOwn(current, itemId) ? current[itemId] : showAllChinese;
      return { ...current, [itemId]: !currentlyVisible };
    });
  }, [showAllChinese]);
  const toggleAllChinese = useCallback(() => {
    setShowAllChinese((current) => !current);
    setChineseVisibilityOverrides({});
  }, []);

  return {
    ...derived,
    query,
    setQuery,
    searchScope,
    setSearchScope,
    selectedLevels,
    setSelectedLevels,
    toggleLevel,
    selectedFolderIds,
    setSelectedFolderIds,
    toggleFolder,
    sort,
    setSort,
    pageNumber,
    setPageNumber,
    selectedIds,
    setSelectedIds,
    toggleSelected,
    showAllChinese,
    toggleAllChinese,
    isChineseVisible,
    toggleChinese,
    visibleIds: derived.pagedItems.map((item) => item.id),
  };
}
