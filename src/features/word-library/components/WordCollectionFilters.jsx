import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { groupFoldersByTag } from '../../../folders/model.js';
import { UNFILED_FOLDER_FILTER_ID } from '../collection/model.js';

export function SearchScopeControl({ value, onChange }) {
  return (
    <div className="search-scope segmented" aria-label="搜尋範圍">
      <button type="button" className={value === 'word' ? 'active' : ''} aria-pressed={value === 'word'} onClick={() => onChange('word')}>單字</button>
      <button type="button" className={value === 'all' ? 'active' : ''} aria-pressed={value === 'all'} onClick={() => onChange('all')}>全部</button>
    </div>
  );
}

export function MultiSelectFilter({ label, options, selectedValues, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedSet = new Set(selectedValues);
  const selectedOptions = options.filter((option) => selectedSet.has(option.value));
  const summary = !selectedOptions.length
    ? '全部'
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `已選 ${selectedOptions.length} 項`;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`multi-select-filter ${open ? 'open' : ''}`} ref={rootRef}>
      <button type="button" className="multi-select-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span><small>{label}</small><strong>{summary}</strong></span>
        <ChevronDown size={17} />
      </button>
      {open && (
        <div className="multi-select-menu" role="group" aria-label={`${label}篩選`}>
          <div className="multi-select-menu-head">
            <strong>{label}</strong>
            {!!selectedValues.length && <button type="button" className="text-link" onClick={onClear}>清除</button>}
          </div>
          <div className="multi-select-options">
            {options.map((option) => (
              <label key={option.value} className={selectedSet.has(option.value) ? 'selected' : ''}>
                <input type="checkbox" checked={selectedSet.has(option.value)} onChange={() => onToggle(option.value)} />
                <span>{option.label}</span>
                {option.count !== undefined && <small>{option.count}</small>}
              </label>
            ))}
            {!options.length && <span className="muted-note">沒有可選項目</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function IndeterminateCheckbox({ checked, indeterminate, onChange }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={inputRef} type="checkbox" checked={checked} onChange={onChange} />;
}

export function GroupedFolderMultiSelect({ folders, selectedValues, onToggle, onToggleGroup, onClear, includeUnfiled = false, unfiledCount = 0 }) {
  const [open, setOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const rootRef = useRef(null);
  const selectedSet = new Set(selectedValues);
  const groups = groupFoldersByTag(folders);
  const summary = !selectedValues.length ? '全部' : `已選 ${selectedValues.length} 項`;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const toggleExpanded = (label) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    return next;
  });

  return (
    <div className={`multi-select-filter ${open ? 'open' : ''}`} ref={rootRef}>
      <button type="button" className="multi-select-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span><small>資料夾</small><strong>{summary}</strong></span>
        <ChevronDown size={17} />
      </button>
      {open && (
        <div className="multi-select-menu grouped-folder-menu" role="group" aria-label="資料夾篩選">
          <div className="multi-select-menu-head">
            <strong>依標籤選擇資料夾</strong>
            {!!selectedValues.length && <button type="button" className="text-link" onClick={onClear}>清除</button>}
          </div>
          {includeUnfiled && (
            <div className="multi-select-options folder-special-options">
              <label className={selectedSet.has(UNFILED_FOLDER_FILTER_ID) ? 'selected' : ''}>
                <input type="checkbox" checked={selectedSet.has(UNFILED_FOLDER_FILTER_ID)} onChange={() => onToggle(UNFILED_FOLDER_FILTER_ID)} />
                <span>無資料夾</span>
                <small>{unfiledCount}</small>
              </label>
            </div>
          )}
          <div className="folder-filter-groups">
            {groups.map((group) => {
              const folderIds = group.folders.map((folder) => folder.id);
              const selectedCount = folderIds.filter((id) => selectedSet.has(id)).length;
              const expanded = expandedGroups.has(group.label);
              return (
                <section className="folder-filter-group" key={group.label}>
                  <div className="folder-filter-group-head">
                    <button type="button" className="folder-group-toggle" aria-expanded={expanded} onClick={() => toggleExpanded(group.label)} title={expanded ? '收合資料夾' : '展開資料夾'}>
                      <ChevronRight size={16} />
                    </button>
                    <label>
                      <IndeterminateCheckbox
                        checked={selectedCount === folderIds.length && folderIds.length > 0}
                        indeterminate={selectedCount > 0 && selectedCount < folderIds.length}
                        onChange={() => onToggleGroup(folderIds)}
                      />
                      <span>{group.label}</span>
                      <small>{selectedCount ? `${selectedCount} / ${folderIds.length}` : folderIds.length}</small>
                    </label>
                  </div>
                  {expanded && (
                    <div className="multi-select-options folder-group-options">
                      {group.folders.map((folder) => (
                        <label key={folder.id} className={selectedSet.has(folder.id) ? 'selected' : ''}>
                          <input type="checkbox" checked={selectedSet.has(folder.id)} onChange={() => onToggle(folder.id)} />
                          <span>{folder.name}</span>
                          <small>{(folder.wordIds || []).length}</small>
                        </label>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
            {!groups.length && <span className="muted-note">沒有資料夾</span>}
          </div>
        </div>
      )}
    </div>
  );
}
