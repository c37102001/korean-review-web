import React, { useState } from 'react';
import {
  ChevronDown,
  Folder,
  FolderInput,
  FolderPlus,
  ListChecks,
  PauseCircle,
  PlayCircle,
  Trash2,
  X,
} from 'lucide-react';

import { selectedFoldersFirst } from '../collection/model.js';

export function FolderPickerDropdown({
  folders,
  selectedFolderIds,
  requiredFolderIds = [],
  onToggle,
  showCounts = false,
  title = '加入資料夾',
  wide = true,
}) {
  const selectedSet = new Set(selectedFolderIds);
  const requiredSet = new Set(requiredFolderIds);
  const orderedFolders = selectedFoldersFirst(folders, selectedFolderIds);
  const selectedNames = folders
    .filter((folder) => selectedSet.has(folder.id))
    .map((folder) => folder.name);
  const summary = selectedNames.length
    ? selectedNames.length <= 2 ? selectedNames.join('、') : `已選 ${selectedNames.length} 個資料夾`
    : '尚未選擇';

  return (
    <details className={`${wide ? 'wide-field ' : ''}folder-picker-dropdown`}>
      <summary>
        <span className="folder-picker-dropdown-title"><Folder size={17} /><strong>{title}</strong><small>選填</small></span>
        <span className="folder-picker-dropdown-summary">{summary}</span>
        <ChevronDown size={17} className="folder-picker-chevron" />
      </summary>
      <div className="folder-picker-dropdown-menu">
        {orderedFolders.map((folder) => {
          const required = requiredSet.has(folder.id);
          return (
            <label className={selectedSet.has(folder.id) ? 'selected' : ''} key={folder.id}>
              <input
                type="checkbox"
                checked={selectedSet.has(folder.id)}
                disabled={required}
                onChange={() => onToggle(folder.id)}
              />
              <Folder size={16} />
              <span><strong>{folder.name}</strong>{showCounts && <small>{(folder.wordIds || []).length} 個單字</small>}</span>
              {required && <small className="folder-required-label">目前資料夾</small>}
            </label>
          );
        })}
      </div>
    </details>
  );
}

function FolderAssignmentModal({ folders, wordIds, onAssign, onCreateFolderAndAssign, onClose }) {
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderTag, setNewFolderTag] = useState('');
  const [savingAction, setSavingAction] = useState('');
  const [error, setError] = useState('');
  const toggleFolder = (folderId) => setSelectedFolderIds((current) => (
    current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId]
  ));
  const submit = async (event) => {
    event.preventDefault();
    if (!selectedFolderIds.length) return;
    setSavingAction('existing');
    setError('');
    try {
      await onAssign(selectedFolderIds, wordIds);
      onClose(true);
    } catch (saveError) {
      setError(saveError.message || '加入資料夾失敗');
      setSavingAction('');
    }
  };
  const createAndAssign = async () => {
    if (!newFolderName.trim()) return;
    setSavingAction('create');
    setError('');
    try {
      await onCreateFolderAndAssign(newFolderName, wordIds, selectedFolderIds, newFolderTag);
      onClose(true);
    } catch (saveError) {
      setError(saveError.message || '建立資料夾失敗');
      setSavingAction('');
    }
  };
  const saving = !!savingAction;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="assign-folder-title">
      <form className="modal-panel folder-assignment-modal" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={() => onClose(false)} aria-label="關閉"><X size={18} /></button>
        <span className="eyebrow">Batch organize</span>
        <h2 id="assign-folder-title">將 {wordIds.length} 個單字加入資料夾</h2>
        <p>可以同時選擇多個資料夾；原本已存在的關聯不會重複。</p>
        {folders.length ? (
          <FolderPickerDropdown
            folders={folders}
            selectedFolderIds={selectedFolderIds}
            onToggle={toggleFolder}
            showCounts
          />
        ) : <div className="empty small-empty">還沒有資料夾，可以直接在下方建立。</div>}
        <section className="create-folder-during-assignment">
          <div>
            <FolderPlus size={20} />
            <span><strong>建立新資料夾</strong><small>新資料夾會立即加入這 {wordIds.length} 個單字</small></span>
          </div>
          <div className="create-folder-inline-form">
            <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createAndAssign(); } }} maxLength={60} placeholder="輸入新資料夾名稱" disabled={saving} />
            <input value={newFolderTag} onChange={(event) => setNewFolderTag(event.target.value)} maxLength={40} placeholder="標籤（選填）" list="assignment-folder-tag-options" disabled={saving} />
            <button type="button" className="soft-button" disabled={!newFolderName.trim() || saving} onClick={createAndAssign}>{savingAction === 'create' ? '建立中' : '建立並加入'}</button>
          </div>
          <datalist id="assignment-folder-tag-options">{[...new Set(folders.map((folder) => folder.tag).filter(Boolean))].map((tag) => <option value={tag} key={tag} />)}</datalist>
          {!!selectedFolderIds.length && <small>也會同時加入上方已勾選的 {selectedFolderIds.length} 個資料夾。</small>}
        </section>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <button type="button" onClick={() => onClose(false)} disabled={saving}>取消</button>
          <button className="primary" disabled={!selectedFolderIds.length || saving}>{savingAction === 'existing' ? '加入中' : '加入所選'}</button>
        </div>
      </form>
    </div>
  );
}

export function BulkWordActions({
  selectedIds,
  visibleIds,
  allIds = [],
  allowSelectAll = false,
  folders,
  onSelectionChange,
  onAssignFolders,
  onCreateFolderAndAssign,
  onDeleteRecords,
  onSetNoReview,
  currentFolder,
  onRemoveFromCurrentFolder,
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const selectedSet = new Set(selectedIds);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));
  const allItemsSelected = allIds.length > 0 && allIds.every((id) => selectedSet.has(id));
  const toggleVisible = () => {
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleIds);
      onSelectionChange(selectedIds.filter((id) => !visibleSet.has(id)));
    } else {
      onSelectionChange([...new Set([...selectedIds, ...visibleIds])]);
    }
  };
  const toggleAll = () => {
    if (allItemsSelected) {
      const allSet = new Set(allIds);
      onSelectionChange(selectedIds.filter((id) => !allSet.has(id)));
    } else {
      onSelectionChange([...new Set([...selectedIds, ...allIds])]);
    }
  };
  const runAction = async (action, handler) => {
    setBusyAction(action);
    setError('');
    try {
      await handler();
      onSelectionChange([]);
    } catch (actionError) {
      setError(actionError.message || '批次操作失敗');
    } finally {
      setBusyAction('');
    }
  };
  const removeFromFolder = () => {
    if (!window.confirm(`確定要將所選 ${selectedIds.length} 個單字從「${currentFolder.name}」移除嗎？單字本中的卡片會保留。`)) return;
    runAction('remove', () => onRemoveFromCurrentFolder(currentFolder.id, selectedIds));
  };
  const permanentlyDelete = () => {
    if (!window.confirm(`確定要永久刪除所選 ${selectedIds.length} 個單字嗎？這些卡片也會從單字本與所有資料夾刪除，且無法復原。`)) return;
    runAction('delete', () => onDeleteRecords(selectedIds));
  };

  return (
    <>
      <div className={`bulk-word-actions ${selectedIds.length ? 'has-selection' : ''}`}>
        <div className="bulk-selection-summary">
          <ListChecks size={19} />
          <strong>{selectedIds.length ? `已選 ${selectedIds.length} 個` : '批次選取'}</strong>
          <button type="button" className="text-link" disabled={!visibleIds.length || !!busyAction} onClick={toggleVisible}>{allVisibleSelected ? '取消本頁' : '選取本頁'}</button>
          {allowSelectAll && <button type="button" className="text-link" disabled={!allIds.length || !!busyAction} onClick={toggleAll}>{allItemsSelected ? '取消全部' : '選取全部'}</button>}
          {!!selectedIds.length && <button type="button" className="text-link muted-link" disabled={!!busyAction} onClick={() => onSelectionChange([])}>清除</button>}
        </div>
        {!!selectedIds.length && <div className="bulk-action-buttons">
          <button type="button" disabled={!!busyAction} onClick={() => setAssignOpen(true)}><FolderInput size={17} /> 加入資料夾</button>
          {onSetNoReview && <>
            <button type="button" disabled={!!busyAction} onClick={() => runAction('no-review', () => onSetNoReview(selectedIds, true))}><PauseCircle size={17} /> 不複習</button>
            <button type="button" disabled={!!busyAction} onClick={() => runAction('review', () => onSetNoReview(selectedIds, false))}><PlayCircle size={17} /> 恢復複習</button>
          </>}
          {currentFolder && <button type="button" disabled={!!busyAction} onClick={removeFromFolder} title="只從目前資料夾移除，保留單字卡"><X size={17} /> {busyAction === 'remove' ? '移除中' : '移出資料夾'}</button>}
          <button type="button" className="danger-soft" disabled={!!busyAction} onClick={permanentlyDelete} title="從單字本與所有資料夾永久刪除"><Trash2 size={17} /> {busyAction === 'delete' ? '刪除中' : '永久刪除'}</button>
        </div>}
      </div>
      {error && <div className="form-error bulk-action-error">{error}</div>}
      {assignOpen && (
        <FolderAssignmentModal
          folders={folders}
          wordIds={selectedIds}
          onAssign={onAssignFolders}
          onCreateFolderAndAssign={onCreateFolderAndAssign}
          onClose={(completed) => {
            setAssignOpen(false);
            if (completed) onSelectionChange([]);
          }}
        />
      )}
    </>
  );
}
