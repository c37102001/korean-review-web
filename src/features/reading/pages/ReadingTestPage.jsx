import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, FolderOpen, Highlighter, Pencil, Trash2, X } from 'lucide-react';

import { isSystemFolder, READING_SOURCE_FOLDER_NAME } from '../../../folders/model.js';
import { todayString } from '../../../shared/date.js';
import { createId } from '../../../shared/id.js';
import { WordMatchesModal } from '../../word-library/components/WordPresentation.jsx';
import { AddItemsModal } from '../../word-import/components/WordImportForm.jsx';
import { SelectableKoreanText } from '../../text-selection/components/SelectableKoreanText.jsx';
import { SelectionActionPopover, WordDefinitionPopover } from '../../text-selection/components/SelectionOverlays.jsx';
import { HighlightExportModal } from '../../text-selection/components/HighlightExportModal.jsx';
import { useDismissibleWordDefinition, useTextSelectionActions } from '../../text-selection/hooks/useTextSelectionActions.js';
import { ReadingTestsEditorModal } from './ReadingTestsPage.jsx';

export function ReadingTestPage({ test, allTests = [], allItems = [], folders = [], onSpeak, onAddRecords, onUpdateRecord, onWriteRecords, onDeleteRecord, onOpenFolder, onSave, onDelete, onBack }) {
  const [selected, setSelected] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [quickAdd, setQuickAdd] = useState(null);
  const [editingWord, setEditingWord] = useState(null);
  const [viewingWords, setViewingWords] = useState([]);
  const [localHighlights, setLocalHighlights] = useState(test?.highlights || []);
  const [exportHighlights, setExportHighlights] = useState(false);
  useEffect(() => {
    setSelected('');
    setSubmitted(false);
    setError('');
    setLocalHighlights(test?.highlights || []);
  }, [test?.id, test?.highlights]);
  const entries = useMemo(() => test ? [
    { id: `${test.id}-passage`, ko: test.passage.ko, zh: test.passage.zh },
    { id: `${test.id}-question`, ko: test.question.ko, zh: test.question.zh },
    ...test.options.map((option) => ({ id: `${test.id}-option-${option.id}`, ko: option.ko, zh: option.zh })),
  ] : [], [test]);
  const { selectionAction, setSelectionAction, clearSelectionAction } = useTextSelectionActions({ entries, trackOffsets: true });
  const [definitionBubble, setDefinitionBubble] = useDismissibleWordDefinition();
  const readingFolder = useMemo(() => folders.find((folder) => (
    !isSystemFolder(folder) && folder.name.toLocaleLowerCase() === READING_SOURCE_FOLDER_NAME.toLocaleLowerCase()
  )) || null, [folders]);
  const readingWords = useMemo(() => {
    const wordIds = new Set(readingFolder?.wordIds || []);
    return allItems.filter((item) => wordIds.has(item.id));
  }, [allItems, readingFolder]);
  if (!test) return <section className="page"><div className="empty">找不到這題閱讀測驗。<button onClick={onBack}>返回上一層</button></div></section>;
  const selectedCorrectly = selected === test.answer;
  const toggleLearned = async () => {
    setError('');
    try { await onSave({ ...test, learned: !test.learned }); } catch (saveError) { setError(saveError.message || '更新已學習狀態失敗'); }
  };
  const deleteTest = async () => {
    if (!window.confirm('確定要刪除這題閱讀題嗎？')) return;
    try { await onDelete(test.id); onBack(); } catch (deleteError) { setError(deleteError.message || '刪除閱讀題失敗'); }
  };
  const showDefinition = (event, words) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setDefinitionBubble({
      words,
      top: Math.max(10, rect.top - 8),
      left: Math.min(Math.max(105, rect.left + (rect.width / 2)), window.innerWidth - 105),
    });
  };
  const showHighlightActions = (event, highlight, entry) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setSelectionAction({
      ko: highlight.text,
      entry,
      start: highlight.start,
      end: highlight.end,
      highlight,
      top: rect.bottom + 8,
      left: Math.min(Math.max(10, rect.left + (rect.width / 2) - 63), window.innerWidth - 136),
    });
  };
  const saveHighlights = async (nextHighlights, previousHighlights) => {
    setLocalHighlights(nextHighlights);
    setError('');
    try {
      await onSave({ ...test, highlights: nextHighlights });
    } catch (saveError) {
      setLocalHighlights(previousHighlights);
      setError(saveError.message || '儲存劃線失敗');
    }
  };
  const addHighlight = () => {
    const highlight = {
      id: createId(),
      entryId: selectionAction.entry.id,
      text: selectionAction.ko,
      start: selectionAction.start,
      end: selectionAction.end,
    };
    const alreadyExists = localHighlights.some((current) => (
      current.entryId === highlight.entryId && current.start === highlight.start && current.end === highlight.end
    ));
    const previousHighlights = localHighlights;
    clearSelectionAction({ removeRanges: true });
    if (alreadyExists) return;
    saveHighlights([...localHighlights, highlight], previousHighlights);
  };
  const removeHighlight = () => {
    if (!selectionAction?.highlight) return;
    const previousHighlights = localHighlights;
    saveHighlights(localHighlights.filter((highlight) => highlight.id !== selectionAction.highlight.id), previousHighlights);
    setSelectionAction(null);
  };
  const deleteWord = async (word) => {
    if (!window.confirm(`確定要刪除「${word.ko}」嗎？`)) return;
    setError('');
    try { await onDeleteRecord(word.id); setDefinitionBubble(null); } catch (deleteError) { setError(deleteError.message || '刪除單字失敗'); }
  };
  const selectableKorean = (entry) => (
    <SelectableKoreanText className="reading-korean-source" entry={entry} words={readingWords} highlights={localHighlights} onSelectWords={showDefinition} onOpenWords={(words) => { clearSelectionAction({ removeRanges: true }); setDefinitionBubble(null); setViewingWords(words); }} onSelectHighlight={showHighlightActions} />
  );
  return (
    <section className="page reading-test-reader">
      <div className="topbar">
        <div><span className="eyebrow">Reading Practice</span><h1>閱讀題</h1></div>
        <div className="actions notebook-actions">
          <button type="button" className={`learned-visibility-button ${test.learned ? 'active' : ''}`} aria-pressed={test.learned} title={test.learned ? '取消已學習' : '標記已學習'} onClick={toggleLearned}>{test.learned ? <Check size={18} /> : <BookOpen size={18} />}已學習</button>
          <button type="button" className="reading-highlight-export-button" title="匯出劃線" aria-label="匯出劃線" onClick={() => setExportHighlights(true)}><Highlighter size={17} /><span>匯出劃線</span></button>
          <button type="button" onClick={() => setEditing(true)}><Pencil size={17} /> 編輯</button>
          <button type="button" className="delete-icon-button" onClick={deleteTest}><Trash2 size={17} /> 刪除</button>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <SelectionActionPopover
        selection={selectionAction}
        onAdd={() => { setQuickAdd(selectionAction); clearSelectionAction({ removeRanges: true }); }}
        onLookup={() => clearSelectionAction({ removeRanges: true })}
        onAddHighlight={addHighlight}
        onRemoveHighlight={removeHighlight}
      />
      <WordDefinitionPopover
        definition={definitionBubble}
        className="reading-word-definition"
        onEdit={(word) => { setEditingWord(word); setDefinitionBubble(null); }}
        onDelete={deleteWord}
      />
      {readingFolder && <div className="reading-reader-floating-actions"><button type="button" className="yt-reader-floating-button" onClick={() => onOpenFolder?.(readingFolder.id)} title={`開啟資料夾「${readingFolder.name}」`} aria-label={`開啟資料夾「${readingFolder.name}」`}><FolderOpen size={22} /></button></div>}
      <article className="reading-passage">
        <p>{selectableKorean(entries[0])}</p>
        {submitted && <p className="reading-translation">{test.passage.zh}</p>}
      </article>
      <div className="reading-question"><h2>{selectableKorean(entries[1])}</h2>{submitted && <p>{test.question.zh}</p>}</div>
      <div className="reading-options" role="radiogroup" aria-label="閱讀題選項">
        {test.options.map((option, index) => {
          const correct = submitted && option.id === test.answer;
          const incorrect = submitted && option.id === selected && !correct;
          return <label className={`reading-option ${selected === option.id ? 'selected' : ''} ${correct ? 'correct' : ''} ${incorrect ? 'incorrect' : ''}`} key={option.id}>
            <input type="radio" name="reading-answer" value={option.id} checked={selected === option.id} disabled={submitted} onChange={() => setSelected(option.id)} />
            <span className="reading-option-number">{['①', '②', '③', '④', '⑤', '⑥'][index] || option.id}</span>
            <span><strong>{selectableKorean(entries[index + 2])}</strong>{submitted && <small>{option.zh}</small>}</span>
            {correct && <Check size={20} />}
            {incorrect && <X size={20} />}
          </label>;
        })}
      </div>
      {!submitted ? <button type="button" className="primary reading-submit" disabled={!selected} onClick={() => setSubmitted(true)}><Check size={18} /> 確認答案</button>
        : <div className={`reading-result ${selectedCorrectly ? 'correct' : 'incorrect'}`}><strong>{selectedCorrectly ? '答對了' : '答錯了'}</strong><span>正確答案是選項 {test.answer}</span><button type="button" onClick={() => { setSelected(''); setSubmitted(false); }}>再做一次</button></div>}
      {editing && <ReadingTestsEditorModal test={test} existingTests={allTests} tagSuggestions={[...new Set(allTests.map((entry) => entry.tag).filter(Boolean))]} onSave={async (tests) => { await onSave(tests[0]); setEditing(false); }} onClose={() => setEditing(false)} />}
      {quickAdd && <AddItemsModal
        title="新增單字"
        date={todayString()}
        initialKo={quickAdd.ko}
        initialVariants={[quickAdd.ko]}
        allItems={allItems}
        folders={folders}
        onAddRecords={onAddRecords}
        onUpdateRecord={onUpdateRecord}
        onWriteRecords={onWriteRecords}
        onEditExisting={(item) => { setQuickAdd(null); setEditingWord(item); }}
        onClose={() => setQuickAdd(null)}
      />}
      {editingWord && <AddItemsModal title="編輯單字" date={editingWord.date} lockedDate editItem={editingWord} allItems={allItems} folders={folders} onUpdateRecord={onUpdateRecord} onClose={() => setEditingWord(null)} />}
      {!!viewingWords.length && <WordMatchesModal items={viewingWords} allItems={allItems} onSpeak={onSpeak} onOpenItems={setViewingWords} onEdit={(word) => { setViewingWords([]); setEditingWord(word); }} onDelete={onDeleteRecord} onClose={() => setViewingWords([])} />}
      {exportHighlights && <HighlightExportModal highlights={localHighlights} onClose={() => setExportHighlights(false)} />}
    </section>
  );
}
