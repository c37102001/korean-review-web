import { BookMarked, Highlighter, Pencil, Plus, Trash2 } from 'lucide-react';
import { naverKoreanDictionaryUrl } from '../model.js';

export function SelectionActionPopover({ selection, onAdd, onLookup, onAddHighlight, onRemoveHighlight }) {
  if (!selection) return null;
  const preserveSelection = (event) => event.preventDefault();
  return (
    <div className="subtitle-selection-actions" style={{ top: selection.top, left: selection.left }}>
      <button type="button" className="subtitle-selection-add" onMouseDown={preserveSelection} onClick={onAdd} title="新增單字" aria-label="將選取的韓文新增為單字"><Plus size={18} /></button>
      <a className="subtitle-selection-dictionary" href={naverKoreanDictionaryUrl(selection.ko)} target="_blank" rel="noopener noreferrer" onMouseDown={preserveSelection} onClick={onLookup} title="使用 Naver 字典查詢" aria-label={`使用 Naver 字典查詢「${selection.ko}」`}><BookMarked size={18} /></a>
      {!selection.highlight && onAddHighlight && <button type="button" className="subtitle-selection-highlight" onMouseDown={preserveSelection} onClick={onAddHighlight} title="畫線" aria-label={`畫線標記「${selection.ko}」`}><Highlighter size={18} /></button>}
      {selection.highlight && onRemoveHighlight && <button type="button" className="subtitle-selection-remove-highlight" onMouseDown={preserveSelection} onClick={onRemoveHighlight} title="刪除畫線" aria-label={`刪除「${selection.ko}」的畫線`}><Trash2 size={18} /></button>}
    </div>
  );
}

export function WordDefinitionPopover({ definition, className = '', onEdit, onDelete }) {
  if (!definition) return null;
  return (
    <div className={`subtitle-word-definition ${className}`.trim()} style={{ top: definition.top, left: definition.left }} role={onEdit || onDelete ? 'dialog' : 'status'} aria-label={definition.word ? `${definition.word.ko}的單字資訊` : undefined}>
      {definition.word ? <span><strong>{definition.word.ko}</strong>{definition.zh}</span> : definition.zh}
      {(onEdit || onDelete) && <div>
        {onEdit && <button type="button" onClick={onEdit} title="編輯單字" aria-label="編輯單字"><Pencil size={15} /></button>}
        {onDelete && <button type="button" className="delete-icon-button" onClick={onDelete} title="刪除單字" aria-label="刪除單字"><Trash2 size={15} /></button>}
      </div>}
    </div>
  );
}
