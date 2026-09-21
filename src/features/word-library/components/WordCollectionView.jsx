import React from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';

import { BulkWordActions } from './BulkWordActions.jsx';
import { WordCard } from './WordPresentation.jsx';

export function WordChineseVisibilityButton({ visible = false, onToggle }) {
  return (
    <button
      type="button"
      className="word-chinese-visibility-button"
      onClick={onToggle}
      aria-pressed={visible}
      title={visible ? '隱藏全部單字卡中文' : '顯示全部單字卡中文'}
    >
      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      {visible ? '隱藏中文' : '顯示中文'}
    </button>
  );
}

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
  onSetNoReview,
  currentFolder,
  onRemoveFromCurrentFolder,
  emptyMessage = '沒有符合的單字',
  showPagination = false,
  showBulkActions = true,
}) {
  const starredSet = starredIds instanceof Set ? starredIds : new Set(starredIds);
  return (
    <>
      {showBulkActions && (
        <BulkWordActions
          selectedIds={collection.selectedIds}
          visibleIds={collection.visibleIds}
          folders={folders}
          onSelectionChange={collection.setSelectedIds}
          onAssignFolders={onAssignFolders}
          onCreateFolderAndAssign={onCreateFolderAndAssign}
          onDeleteRecords={onDeleteRecords}
          onSetNoReview={onSetNoReview}
          currentFolder={currentFolder}
          onRemoveFromCurrentFolder={onRemoveFromCurrentFolder}
        />
      )}
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
              selectable={showBulkActions}
              selected={collection.selectedIds.includes(word.id)}
              onToggleSelected={collection.toggleSelected}
              showChinese={collection.isChineseVisible?.(word.id) || false}
              onToggleChinese={collection.toggleChinese ? () => collection.toggleChinese(word.id) : undefined}
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
