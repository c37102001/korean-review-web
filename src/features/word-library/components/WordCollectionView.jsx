import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { BulkWordActions } from './BulkWordActions.jsx';
import { WordCard } from './WordPresentation.jsx';

export function WordCollectionView({
  collection,
  folders,
  starredIds = [],
  onToggleStar,
  onSpeak,
  onOpen,
  onEdit,
  onDelete,
  deleteLabel,
  deleteConfirmMessage,
  onAssignFolders,
  onCreateFolderAndAssign,
  onDeleteRecords,
  currentFolder,
  onRemoveFromCurrentFolder,
  emptyMessage = '沒有符合的單字',
  showPagination = false,
}) {
  const starredSet = starredIds instanceof Set ? starredIds : new Set(starredIds);
  return (
    <>
      <BulkWordActions
        selectedIds={collection.selectedIds}
        visibleIds={collection.visibleIds}
        folders={folders}
        onSelectionChange={collection.setSelectedIds}
        onAssignFolders={onAssignFolders}
        onCreateFolderAndAssign={onCreateFolderAndAssign}
        onDeleteRecords={onDeleteRecords}
        currentFolder={currentFolder}
        onRemoveFromCurrentFolder={onRemoveFromCurrentFolder}
      />
      {collection.pagedItems.length ? (
        <div className="word-grid">
          {collection.pagedItems.map((word) => (
            <WordCard
              key={word.id}
              word={word}
              folders={folders}
              onSpeak={onSpeak}
              onOpen={onOpen}
              onEdit={onEdit}
              onDelete={onDelete}
              deleteLabel={deleteLabel}
              deleteConfirmMessage={typeof deleteConfirmMessage === 'function' ? deleteConfirmMessage(word) : deleteConfirmMessage}
              isStarred={starredSet.has(word.id)}
              onToggleStar={() => onToggleStar(word)}
              selectable
              selected={collection.selectedIds.includes(word.id)}
              onToggleSelected={collection.toggleSelected}
            />
          ))}
        </div>
      ) : <div className="empty">{emptyMessage}</div>}
      {showPagination && (showPagination === 'always' || collection.pageCount > 1) && (
        <div className="pagination">
          <button disabled={collection.pageNumber <= 1} onClick={() => collection.setPageNumber(collection.pageNumber - 1)}><ChevronLeft size={18} /> 上一頁</button>
          <span>{collection.pageNumber} / {collection.pageCount} · 共 {collection.totalCount} 筆</span>
          <button disabled={collection.pageNumber >= collection.pageCount} onClick={() => collection.setPageNumber(collection.pageNumber + 1)}>下一頁 <ChevronRight size={18} /></button>
        </div>
      )}
    </>
  );
}
