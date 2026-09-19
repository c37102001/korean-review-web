import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Plus, Trash2, X } from 'lucide-react';

import { FolderPickerDropdown } from '../../word-library/components/BulkWordActions.jsx';
import { wordFolderIds } from '../../word-library/collection/model.js';
import { copyText } from '../../../shared/clipboard.js';
import { createId } from '../../../shared/id.js';
import { formatPairLines, normalizeKoreanKey, parsePairLines, recordOrder, wordChineseSummary } from '../../../words/records.js';
import {
  buildJsonImportDraft,
  clearMissingImportRelated,
  createRecordsForDate,
  createRecordsFromImportEntries,
  findImportConflict,
  findMissingImportRelated,
  findUpdateKoreanCollision,
  formatSingleWordJson,
  parseEditedImportItem,
  parseSingleWordEditJson,
  resolveImportConflictDraft,
} from '../model.js';

function describeImportError(error) {
  const code = String(error?.code || '').replace(/^firestore\//, '');
  const message = error?.message || '未知錯誤';
  if (code === 'permission-denied') return { code, message: 'Firebase 拒絕寫入，請確認登入狀態與 Firestore rules。' };
  if (code === 'resource-exhausted' || /quota|too many requests/i.test(message)) return { code: code || 'quota-exceeded', message: 'Firebase 目前已超過寫入額度，這筆資料尚未儲存，請等額度恢復後重試。' };
  if (code === 'unavailable' || /network|offline|failed to fetch/i.test(message)) return { code: code || 'network', message: '目前無法連線到 Firebase，請確認網路後重試。' };
  if (code === 'unauthenticated') return { code, message: '登入狀態已失效，請重新登入後再試。' };
  return { code: code || error?.name || 'error', message };
}

export function AddItemsModal({ title, date, lockedDate = false, initialKo = '', onAddRecords, onUpdateRecord, onWriteRecords, onEditExisting, editItem, allItems = [], folders = [], initialFolderIds = [], requiredFolderIds = [], onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <button className="modal-close" disabled={busy} title={busy ? '正在等待 Firebase 確認' : ''} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <AddItemsForm
          title={title}
          date={date}
          lockedDate={lockedDate}
          initialKo={initialKo}
          onAddRecords={onAddRecords}
          onUpdateRecord={onUpdateRecord}
          onWriteRecords={onWriteRecords}
          onEditExisting={onEditExisting}
          editItem={editItem}
          allItems={allItems}
          folders={folders}
          initialFolderIds={initialFolderIds}
          requiredFolderIds={requiredFolderIds}
          onBusyChange={setBusy}
          onSaved={onClose}
          compactPanel
        />
      </div>
    </div>
  );
}

export function AddItemsForm({ title, date, lockedDate = false, initialKo = '', onAddRecords, onUpdateRecord, onWriteRecords, onEditExisting, editItem, allItems = [], folders = [], initialFolderIds = [], requiredFolderIds = [], onSaved, onBusyChange, compactPanel = false }) {
  const isEditing = Boolean(editItem);
  const editFolderIds = wordFolderIds(folders, editItem?.id);
  const initialSelectedFolderIds = isEditing
    ? editFolderIds
    : [...new Set([...initialFolderIds, ...requiredFolderIds])];
  const [mode, setMode] = useState('manual');
  const [formDate, setFormDate] = useState(date);
  const [jsonText, setJsonText] = useState(() => editItem ? formatSingleWordJson(editItem) : '');
  const [importDraft, setImportDraft] = useState(null);
  const [manual, setManual] = useState(() => itemToManual(editItem, initialKo));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [importLog, setImportLog] = useState([]);
  const [importCompleted, setImportCompleted] = useState(null);
  const [selectedFolderIds, setSelectedFolderIds] = useState(() => initialSelectedFolderIds);
  const [jsonCopied, setJsonCopied] = useState(false);
  const submissionLockRef = useRef(false);

  useEffect(() => {
    onBusyChange?.(saving);
  }, [saving, onBusyChange]);

  const reportImportProgress = (progress) => {
    setImportProgress(progress);
    if (!progress?.detail) return;
    setImportLog((current) => {
      if (current[current.length - 1]?.detail === progress.detail) return current;
      const next = [...current, {
        detail: progress.detail,
        time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      }];
      return next.slice(-8);
    });
  };

  useEffect(() => {
    setFormDate(editItem?.date || date);
    setManual(itemToManual(editItem, initialKo));
    setJsonText(editItem ? formatSingleWordJson(editItem) : '');
    setMode('manual');
    setImportDraft(null);
    setMessage('');
    setError('');
    setDuplicates([]);
    setImportProgress(null);
    setImportLog([]);
    setImportCompleted(null);
    setSelectedFolderIds(initialSelectedFolderIds);
    setJsonCopied(false);
    submissionLockRef.current = false;
  }, [date, editItem, initialKo, initialFolderIds.join('|'), requiredFolderIds.join('|'), editFolderIds.join('|')]);

  const commitImportEntries = async (entries, targetDate, keptExistingIds = []) => {
    const activeEntries = entries.filter(Boolean);
    if (!activeEntries.length) {
      if (selectedFolderIds.length && keptExistingIds.length) {
        if (!onWriteRecords) throw new Error('目前無法更新資料夾，請重新開啟視窗再試一次');
        await onWriteRecords([], reportImportProgress, selectedFolderIds, keptExistingIds);
      }
      const detail = selectedFolderIds.length && keptExistingIds.length
        ? `已將 ${keptExistingIds.length} 筆既有單字加入資料夾，沒有建立重複卡片。`
        : '沒有資料需要寫入；你選擇保留既有單字。';
      const result = { added: 0, updated: 0, detail };
      setMessage(result.detail);
      setImportDraft(null);
      setImportCompleted(result);
      reportImportProgress({ phase: 'success', current: 0, total: 0, detail: result.detail });
      return;
    }
    if (!onWriteRecords) throw new Error('目前無法執行批次匯入，請重新開啟視窗再試一次');
    const { addRecords, updateRecords } = createRecordsFromImportEntries(activeEntries, targetDate, allItems, lockedDate);
    await onWriteRecords([...addRecords, ...updateRecords], reportImportProgress, selectedFolderIds, keptExistingIds);
    setMessage(`已匯入 ${addRecords.length} 筆，更新 ${updateRecords.length} 筆`);
    setJsonText('');
    setImportDraft(null);
    setImportCompleted({ added: addRecords.length, updated: updateRecords.length, detail: `已匯入 ${addRecords.length} 筆，更新 ${updateRecords.length} 筆` });
  };

  const continueImportDraft = async (draft) => {
    const activeEntries = draft.entries.filter(Boolean);
    reportImportProgress({ phase: 'checking', current: 0, total: activeEntries.length, detail: `正在檢查 ${activeEntries.length} 筆資料的重複單字與關聯詞` });
    const updateCollision = findUpdateKoreanCollision(activeEntries, allItems);
    if (updateCollision) {
      throw new Error(`最終結果「${updateCollision.entry.item.ko}」會和既有單字重複，請回到衝突編輯後再匯入`);
    }
    const conflict = findImportConflict(activeEntries, allItems);
    if (conflict) {
      reportImportProgress({ phase: 'waiting', current: 0, total: activeEntries.length, detail: `發現衝突：${conflict.incoming?.ko || conflict.right?.ko || conflict.leftRecordId}，等待你選擇處理方式` });
      setImportDraft({ ...draft, entries: activeEntries, conflict, missingRelated: null, message: '' });
      setError('');
      return;
    }
    const missingRelated = findMissingImportRelated(activeEntries, allItems);
    if (missingRelated.length) {
      reportImportProgress({ phase: 'waiting', current: 0, total: activeEntries.length, detail: `找到 ${missingRelated.length} 筆含有不存在的關聯詞，等待你確認` });
      setImportDraft({ ...draft, entries: activeEntries, conflict: null, missingRelated, message: '' });
      setError('');
      return;
    }
    await commitImportEntries(activeEntries, draft.targetDate, draft.keptExistingIds || []);
  };

  const handleContinueImportDraft = async () => {
    if (!importDraft || submissionLockRef.current) return;
    submissionLockRef.current = true;
    setSaving(true);
    setError('');
    try {
      await continueImportDraft(importDraft);
    } catch (continueError) {
      const failure = describeImportError(continueError);
      setError(`${failure.message} (${failure.code})`);
      reportImportProgress({ phase: 'error', current: importProgress?.current || 0, total: importProgress?.total || 0, detail: `匯入失敗：${failure.message} [${failure.code}]` });
    } finally {
      submissionLockRef.current = false;
      setSaving(false);
    }
  };

  const updateInvalidText = (issueIndex, text) => {
    setImportDraft((draft) => ({
      ...draft,
      invalid: draft.invalid.map((issue) => (issue.index === issueIndex ? { ...issue, text } : issue)),
    }));
  };

  const applyInvalidFix = (issueIndex) => {
    if (!importDraft) return;
    const issue = importDraft.invalid.find((entry) => entry.index === issueIndex);
    try {
      const item = parseEditedImportItem(issue.text);
      const nextEntries = [...importDraft.entries];
      nextEntries[issueIndex] = {
        index: issueIndex,
        action: 'add',
        recordId: item.id || `${importDraft.targetDate}-custom-${createId()}`,
        item,
      };
      const nextInvalid = importDraft.invalid.filter((entry) => entry.index !== issueIndex);
      const nextConflict = nextInvalid.length ? null : findImportConflict(nextEntries.filter(Boolean), allItems);
      const nextMissingRelated = !nextInvalid.length && !nextConflict ? findMissingImportRelated(nextEntries.filter(Boolean), allItems) : [];
      setImportDraft({
        ...importDraft,
        entries: nextEntries,
        invalid: nextInvalid,
        conflict: nextConflict,
        missingRelated: nextMissingRelated.length ? nextMissingRelated : null,
        message: nextConflict ? '格式問題已修正，請繼續處理重複單字' : nextMissingRelated.length ? '格式問題已修正，請處理找不到的關聯詞' : '已套用修正',
      });
      reportImportProgress({ phase: nextConflict || nextMissingRelated.length ? 'waiting' : 'checking', current: nextEntries.length - nextInvalid.length, total: nextEntries.length, detail: `第 ${issueIndex + 1} 筆格式問題已修正` });
    } catch (validationError) {
      setImportDraft({
        ...importDraft,
        invalid: importDraft.invalid.map((entry) => (entry.index === issueIndex ? { ...entry, error: validationError.message } : entry)),
      });
      reportImportProgress({ phase: 'error', current: 0, total: importDraft.entries.length, detail: `第 ${issueIndex + 1} 筆修正仍不符合格式：${validationError.message}` });
    }
  };

  const updateConflictText = (text) => {
    setImportDraft((draft) => ({ ...draft, conflict: { ...draft.conflict, editText: text, error: '' } }));
  };

  const resolveConflict = (choice) => {
    if (!importDraft) return;
    reportImportProgress({ phase: 'checking', current: 0, total: importDraft?.entries.filter(Boolean).length || 0, detail: '已套用衝突選擇，正在檢查剩餘資料' });
    try {
      setImportDraft(resolveImportConflictDraft(importDraft, choice, allItems));
    } catch (validationError) {
      setImportDraft({ ...importDraft, conflict: { ...importDraft.conflict, error: validationError.message } });
      reportImportProgress({ phase: 'error', current: 0, total: importDraft.entries.length, detail: `衝突處理失敗：${validationError.message}` });
    }
  };

  const clearMissingRelatedAndContinue = () => {
    reportImportProgress({ phase: 'checking', current: 0, total: importDraft?.entries.filter(Boolean).length || 0, detail: '已移除找不到的關聯詞，可以繼續匯入' });
    setImportDraft((draft) => ({
      ...draft,
      entries: clearMissingImportRelated(draft.entries, draft.missingRelated || []),
      missingRelated: null,
      message: '已清空找不到的關聯詞，可以繼續匯入',
    }));
  };

  const updateManualMeaning = (meaningIndex, patch) => {
    setManual((current) => ({
      ...current,
      meanings: (current.meanings?.length ? current.meanings : [emptyManualMeaning()])
        .map((meaning, index) => (index === meaningIndex ? { ...meaning, ...patch } : meaning)),
    }));
  };

  const addManualMeaning = () => {
    setManual((current) => ({
      ...current,
      meanings: [...(current.meanings?.length ? current.meanings : [emptyManualMeaning()]), emptyManualMeaning()],
    }));
  };

  const removeManualMeaning = (meaningIndex) => {
    setManual((current) => ({
      ...current,
      meanings: current.meanings?.length > 1 ? current.meanings.filter((_, index) => index !== meaningIndex) : (current.meanings || [emptyManualMeaning()]),
    }));
  };

  const toggleFolder = (folderId) => {
    if (!isEditing && requiredFolderIds.includes(folderId)) return;
    setSelectedFolderIds((current) => (
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId]
    ));
  };

  const switchMode = (nextMode) => {
    if (nextMode === mode || saving) return;
    setError('');
    try {
      if (isEditing) {
        if (nextMode === 'json') {
          setJsonText(formatSingleWordJson(mergeEditedItem(editItem, manual, allItems)));
        } else {
          setManual(itemToManual(parseSingleWordEditJson(jsonText, editItem, allItems)));
        }
      }
      setJsonCopied(false);
      setMode(nextMode);
    } catch (validationError) {
      setError(validationError.message);
    }
  };

  const copyJsonContent = async () => {
    try {
      await copyText(jsonText);
      setJsonCopied(true);
      window.setTimeout(() => setJsonCopied(false), 1600);
    } catch (copyError) {
      setError(copyError.message || '無法複製 JSON 內容');
    }
  };

  const clearJsonContent = () => {
    setJsonText('');
    setJsonCopied(false);
    setError('');
    setMessage('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submissionLockRef.current) return;
    submissionLockRef.current = true;
    setMessage('');
    setError('');
    setDuplicates([]);
    setImportCompleted(null);
    setSaving(true);
    try {
      const targetDate = isEditing ? formDate : lockedDate ? date : formDate;
      if (isEditing) {
        const record = {
          id: editItem.id,
          date: targetDate,
          order: recordOrder(editItem),
          item: mode === 'json' ? parseSingleWordEditJson(jsonText, editItem, allItems) : mergeEditedItem(editItem, manual, allItems),
          createdAt: editItem.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await onUpdateRecord(record, reportImportProgress, selectedFolderIds);
        setMessage('已更新單字');
      } else {
        if (mode === 'json') {
          reportImportProgress({ phase: 'parsing', current: 0, total: 0, detail: '正在解析與驗證 JSON 內容' });
          const draft = buildJsonImportDraft(jsonText, targetDate);
          const total = draft.entries.filter(Boolean).length + draft.invalid.length;
          if (draft.invalid.length) {
            reportImportProgress({ phase: 'waiting', current: total - draft.invalid.length, total, detail: `發現 ${draft.invalid.length} 筆格式問題，等待逐筆修正` });
            setImportDraft(draft);
            setError('有資料不符合匯入格式，請先修正。修正完成前不會匯入任何資料。');
            return;
          }
          const conflict = findImportConflict(draft.entries, allItems);
          if (conflict) {
            reportImportProgress({ phase: 'waiting', current: 0, total, detail: `發現衝突：${conflict.incoming?.ko || conflict.right?.ko || conflict.leftRecordId}，等待你選擇處理方式` });
            setImportDraft({ ...draft, conflict });
            setError('發現重複韓文單字，請先選擇處理方式。處理完成前不會匯入任何資料。');
            return;
          }
          await continueImportDraft(draft);
          return;
        }
        const rawItems = [manualToItem(manual, allItems)];
        const repeatedInInput = rawItems.map((item) => normalizeKoreanKey(item.ko)).filter((ko, index, list) => list.indexOf(ko) !== index);
        if (repeatedInInput.length) {
          setError(`這次新增內容中有重複韓文：${[...new Set(repeatedInInput)].join('、')}`);
          return;
        }
        const existing = rawItems
          .map((rawItem) => allItems.find((item) => normalizeKoreanKey(item.ko) === normalizeKoreanKey(rawItem.ko)))
          .filter(Boolean);
        if (existing.length) {
          setDuplicates(existing);
          setError('不能新增重複韓文單字。請直接編輯既有單字卡。');
          return;
        }
        const records = createRecordsForDate(targetDate, rawItems, allItems);
        await onAddRecords(records, reportImportProgress, selectedFolderIds);
        setMessage(`已新增 ${records.length} 筆到 ${targetDate}`);
        setManual(itemToManual());
      }
      onSaved?.();
    } catch (submitError) {
      const failure = describeImportError(submitError);
      setError(`${failure.message} (${failure.code})`);
      reportImportProgress({ phase: 'error', current: importProgress?.current || 0, total: importProgress?.total || 0, detail: `儲存失敗：${failure.message} [${failure.code}]` });
    } finally {
      submissionLockRef.current = false;
      setSaving(false);
    }
  };

  return (
    <form className={`${compactPanel ? '' : 'panel'} add-panel`} onSubmit={submit}>
      <div className="panel-title">
        <div><h2>{title}</h2><span>{isEditing ? '修改後會覆蓋這筆單字資料' : '可貼上整份 JSON，或手動新增一筆'}</span></div>
        {!importCompleted && <div className="segmented compact">
          <button type="button" disabled={saving} className={mode === 'manual' ? 'active' : ''} onClick={() => switchMode('manual')}>表單</button>
          <button type="button" disabled={saving} className={mode === 'json' ? 'active' : ''} onClick={() => switchMode('json')}>JSON</button>
        </div>}
      </div>

      {importCompleted ? (
        <ImportCompletePanel result={importCompleted} onDone={onSaved} />
      ) : importDraft ? (
        <ImportReviewPanel
          draft={importDraft}
          onUpdateInvalidText={updateInvalidText}
          onApplyInvalidFix={applyInvalidFix}
          onContinue={handleContinueImportDraft}
          onUpdateConflictText={updateConflictText}
          onResolveConflict={resolveConflict}
          onClearMissingRelated={clearMissingRelatedAndContinue}
          saving={saving}
          onCancel={() => {
            setImportDraft(null);
            setError('');
            setMessage('已放棄這次匯入，沒有寫入任何資料');
            reportImportProgress({ phase: 'cancelled', current: 0, total: 0, detail: '已放棄這次匯入，沒有寫入任何資料' });
          }}
        />
      ) : <div className="form-grid">
        <label>
          日期
          <input type="date" value={isEditing ? formDate : lockedDate ? date : formDate} onChange={(event) => setFormDate(event.target.value)} disabled={lockedDate && !isEditing} required />
        </label>
        {!!folders.length && (
          <FolderPickerDropdown
            folders={folders}
            selectedFolderIds={selectedFolderIds}
            requiredFolderIds={isEditing ? [] : requiredFolderIds}
            onToggle={toggleFolder}
            title={isEditing ? '所屬資料夾' : '加入資料夾'}
            wide={false}
          />
        )}
        {mode === 'manual' ? (
          <>
            <label>
              韓文 *
              <input value={manual.ko} onChange={(event) => setManual({ ...manual, ko: event.target.value })} required />
            </label>
            <label>
              詞性 / 類型
              <select value={manual.pos} onChange={(event) => setManual({ ...manual, pos: event.target.value })}>
                <option value="">不指定</option>
                {manual.pos && !['名詞', '動詞', '形容詞', '副詞', '片語', '動詞片語', '句子', '文法', '比較'].includes(manual.pos) && <option value={manual.pos}>{manual.pos}</option>}
                {['名詞', '動詞', '形容詞', '副詞', '片語', '動詞片語', '句子', '文法', '比較'].map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <div className="wide-field meanings-editor">
              <div className="meanings-editor-head">
                <div>
                  <strong>意思與例句</strong>
                  <span>每個中文意思可以有自己的句型和例句</span>
                </div>
                <button type="button" className="soft-button" onClick={addManualMeaning}><Plus size={16} /> 新增意思</button>
              </div>
              {manual.meanings.map((meaning, meaningIndex) => (
                <section className="meaning-editor-card" key={meaning.id || meaningIndex}>
                  <div className="meaning-editor-title">
                    <strong>意思 {meaningIndex + 1}</strong>
                    <button type="button" className="ghost-danger" onClick={() => removeManualMeaning(meaningIndex)} disabled={manual.meanings.length <= 1}>
                      <Trash2 size={15} /> 刪除
                    </button>
                  </div>
                  <label>
                    中文 *
                    <input value={meaning.zh} onChange={(event) => updateManualMeaning(meaningIndex, { zh: event.target.value })} />
                  </label>
                  <label>
                    常見句型 / 搭配
                    <input value={meaning.pattern} onChange={(event) => updateManualMeaning(meaningIndex, { pattern: event.target.value })} />
                  </label>
                  <label className="wide-field">
                    例句
                    <textarea
                      value={meaning.examples}
                      onChange={(event) => updateManualMeaning(meaningIndex, { examples: event.target.value })}
                      placeholder={'韓文一行、中文一行，例句之間可空一行\n\n오늘은 날씨가 좋아요.\n今天天氣很好。\n\n주말에는 사람이 많아요.\n週末人很多。'}
                      rows={8}
                    />
                  </label>
                </section>
              ))}
            </div>
            <label className="wide-field">
              補充說明
              <textarea value={manual.notes} onChange={(event) => setManual({ ...manual, notes: event.target.value })} placeholder={'支援 Markdown，例如：\n\n### 使用提醒\n這個單字常用於 **口語**。\n\n- 注意語氣\n- 可與其他單字搭配'} rows={8} />
            </label>
            <RelatedSelector manual={manual} setManual={setManual} allItems={allItems} editItem={editItem} />
          </>
        ) : (
          <div className="wide-field json-input-field">
            <div className="json-input-heading">
              <label htmlFor="word-json-input">JSON 內容</label>
              {isEditing && <div className="json-input-actions">
                <button type="button" className="soft-button" onClick={copyJsonContent} aria-live="polite"><Copy size={15} /> {jsonCopied ? '已複製內容' : '複製'}</button>
                <button type="button" className="json-clear-button" onClick={clearJsonContent}><X size={15} /> 清除</button>
              </div>}
            </div>
            <textarea id="word-json-input" className="json-input" spellCheck={false} value={jsonText} onChange={(event) => { setJsonText(event.target.value); setJsonCopied(false); }} placeholder='{ "schemaVersion": 2, "data": [{ "ko": "뉴스", "pos": "名詞", "meanings": [{ "zh": "新聞", "examples": [] }] }] }' required />
          </div>
        )}
      </div>}

      {importProgress && <ImportProgressPanel progress={importProgress} log={importLog} />}
      {message && !importCompleted && <div className="form-success">{message}</div>}
      {error && <div className="form-error">{error}</div>}
      {!!duplicates.length && (
        <div className="duplicate-list">
          {duplicates.map((item) => (
            <button type="button" key={item.id} onClick={() => onEditExisting?.(item)}>
              <strong>{item.ko}</strong><span>{item.zh}</span><small>{item.date}</small>
            </button>
          ))}
        </div>
      )}
      {!importDraft && !importCompleted && <div className="form-actions">
        <button className="primary" disabled={saving}>{saving ? '儲存中' : isEditing ? '儲存修改' : '新增到單字庫'}</button>
      </div>}
    </form>
  );
}

function ImportProgressPanel({ progress, log }) {
  const labels = {
    parsing: '解析 JSON',
    checking: '檢查資料',
    waiting: '等待處理',
    preparing: '逐筆整理',
    uploading: '等待 Firebase',
    success: '匯入完成',
    error: '匯入失敗',
    cancelled: '已放棄',
  };
  const percent = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <section className={`import-progress import-progress-${progress.phase}`} role="status" aria-live="polite">
      <div className="import-progress-head">
        <strong>{labels[progress.phase] || '處理中'}</strong>
        {!!progress.total && <span>{progress.current}/{progress.total}</span>}
      </div>
      {!!progress.total && <div className="import-progress-track"><span style={{ width: `${percent}%` }} /></div>}
      <p>{progress.detail}</p>
      {!!log.length && (
        <div className="import-progress-log">
          {log.map((entry, index) => <div key={`${index}-${entry.detail}`}><time>{entry.time}</time>{entry.detail}</div>)}
        </div>
      )}
    </section>
  );
}

function ImportCompletePanel({ result, onDone }) {
  return (
    <div className="import-complete">
      <Check size={28} aria-hidden="true" />
      <strong>匯入已完成</strong>
      <p>{result.detail}</p>
      <button type="button" className="primary" onClick={onDone}>完成</button>
    </div>
  );
}

function ImportReviewPanel({ draft, onUpdateInvalidText, onApplyInvalidFix, onContinue, onUpdateConflictText, onResolveConflict, onClearMissingRelated, onCancel, saving }) {
  const pendingCount = draft.entries.filter(Boolean).length;
  return (
    <div className="import-review">
      <div className="import-review-head">
        <div>
          <strong>匯入預檢</strong>
          <span>{pendingCount} 筆待匯入 / {draft.invalid.length} 筆需要修正</span>
        </div>
        <button type="button" className="danger-soft" disabled={saving} onClick={onCancel}>放棄匯入</button>
      </div>

      {!!draft.invalid.length && (
        <div className="import-section">
          <h3>不符合規定的資料</h3>
          <p>請逐筆修正後按「套用修正」。全部修正完成前，不會匯入任何資料。</p>
          {draft.invalid.map((issue) => (
            <div className="import-fix-card" key={issue.index}>
              <div className="import-fix-title">
                <strong>第 {issue.index + 1} 筆</strong>
                <span>{issue.error}</span>
              </div>
              <textarea value={issue.text} onChange={(event) => onUpdateInvalidText(issue.index, event.target.value)} spellCheck="false" />
              <button type="button" onClick={() => onApplyInvalidFix(issue.index)}>套用修正</button>
            </div>
          ))}
        </div>
      )}

      {!draft.invalid.length && draft.conflict && (
        <ImportConflictResolver conflict={draft.conflict} onUpdateText={onUpdateConflictText} onResolve={onResolveConflict} />
      )}

      {!draft.invalid.length && !draft.conflict && !!draft.missingRelated?.length && (
        <ImportMissingRelatedPanel issues={draft.missingRelated} onClear={onClearMissingRelated} />
      )}

      {!draft.invalid.length && !draft.conflict && !draft.missingRelated?.length && (
        <div className="import-ready">
          <strong>所有問題都已處理</strong>
          <p>確認後會一次匯入新增資料，並更新你選擇合併或覆蓋的既有單字。</p>
          <button type="button" className="primary" disabled={saving} onClick={onContinue}>{saving ? '匯入中…' : '全部匯入'}</button>
        </div>
      )}

      {!!draft.invalid.length && (
        <div className="form-actions">
          <button type="button" className="primary" disabled={!!draft.invalid.length} onClick={onContinue}>繼續檢查重複單字</button>
        </div>
      )}
    </div>
  );
}

function ImportMissingRelatedPanel({ issues, onClear }) {
  const missingCount = issues.reduce((sum, issue) => sum + issue.missing.length, 0);
  return (
    <div className="import-section missing-related-section">
      <h3>找不到 {missingCount} 個關聯詞</h3>
      <p>這些 related 沒有對應到既有單字，也沒有對應到這次匯入的單字。你可以清空這些無效關聯詞後繼續匯入，其他有效關聯詞會保留。</p>
      <div className="missing-related-list">
        {issues.map((issue) => (
          <div key={`${issue.position}-${issue.ko}`}>
            <strong>{issue.ko}</strong>
            <span>{issue.missing.join('、')}</span>
          </div>
        ))}
      </div>
      <div className="conflict-actions">
        <button type="button" className="primary" onClick={onClear}>清空這些關聯詞並繼續</button>
      </div>
    </div>
  );
}

function ImportConflictResolver({ conflict, onUpdateText, onResolve }) {
  const isExisting = conflict.type === 'existing';
  const conflictTitle = conflict.reason === 'id' ? `重複單字 ID：${isExisting ? conflict.existing.id : conflict.leftRecordId}` : `重複韓文單字：${conflict.right?.ko || conflict.incoming?.ko}`;
  const leftLabel = isExisting ? '既有單字' : '匯入資料 A';
  const rightLabel = isExisting ? '匯入資料' : '匯入資料 B';
  const leftItem = isExisting ? conflict.existing : conflict.left;
  const rightItem = isExisting ? conflict.incoming : conflict.right;
  return (
    <div className="import-section">
      <h3>{conflictTitle}</h3>
      <p>請選擇保留其中一邊、直接合併，或編輯最終結果。處理完成前不會匯入任何資料。</p>
      <div className="import-compare-grid">
        <ImportCompareCard label={leftLabel} item={leftItem} />
        <ImportCompareCard label={rightLabel} item={rightItem} />
      </div>
      <div className="conflict-actions">
        {isExisting ? (
          <>
            <button type="button" onClick={() => onResolve('existing')}>保留既有單字</button>
            <button type="button" onClick={() => onResolve('incoming')}>使用匯入資料取代</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onResolve('left')}>保留 A</button>
            <button type="button" onClick={() => onResolve('right')}>保留 B</button>
          </>
        )}
        <button type="button" onClick={() => onResolve('merge')}>直接合併</button>
      </div>
      <label className="import-final-editor">
        編輯最終結果
        <textarea value={conflict.editText} onChange={(event) => onUpdateText(event.target.value)} spellCheck="false" />
      </label>
      {conflict.error && <div className="form-error">{conflict.error}</div>}
      <button type="button" className="primary" onClick={() => onResolve('edit')}>使用編輯後結果</button>
    </div>
  );
}

function ImportCompareCard({ label, item }) {
  return (
    <div className="import-compare-card">
      <span>{label}</span>
      <strong>{item.ko}</strong>
      {item.pos && <small>{item.pos}</small>}
      <p>{wordChineseSummary(item)}</p>
      {!!item.meanings?.length && (
        <div className="import-meaning-list">
          {item.meanings.map((meaning, index) => (
            <div key={meaning.id || `${meaning.zh}-${index}`}>
              <b>{meaning.zh}</b>
              {!!meaning.examples?.length && <em>{meaning.examples.length} 個例句</em>}
            </div>
          ))}
        </div>
      )}
      {!!item.notes?.length && <p className="import-note">{item.notes.join(' / ')}</p>}
    </div>
  );
}

function RelatedSelector({ manual, setManual, allItems, editItem }) {
  const query = manual.relatedQuery || '';
  const selected = manual.relatedSelected || [];
  const selectedSet = new Set(selected);
  const results = allItems
    .filter((item) => item.id !== editItem?.id)
    .filter((item) => !selectedSet.has(item.id))
    .filter((item) => !query.trim() || `${item.ko} ${item.zh}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);
  return (
    <div className="wide-field related-selector">
      <label>
        相關詞
        <input value={query} onChange={(event) => setManual({ ...manual, relatedQuery: event.target.value })} placeholder="搜尋已有單字" />
      </label>
      {!!selected.length && (
        <div className="selected-related">
          {selected.map((id) => {
            const item = allItems.find((candidate) => candidate.id === id);
            return (
              <button type="button" key={id} onClick={() => setManual({ ...manual, relatedSelected: selected.filter((entry) => entry !== id) })}>
                {item?.ko || id}{item?.zh ? ` · ${item.zh}` : ''} ×
              </button>
            );
          })}
        </div>
      )}
      <div className="related-results">
        {results.map((item) => (
          <button type="button" key={item.id} onClick={() => setManual({ ...manual, relatedSelected: [...selected, item.id], relatedQuery: '' })}>
            <strong>{item.ko}</strong><span>{item.zh}</span>
          </button>
        ))}
        {query.trim() && !results.length && <div className="empty small-empty">找不到符合的既有單字</div>}
      </div>
    </div>
  );
}

function emptyManualMeaning() {
  return { id: '', zh: '', pattern: '', examples: '' };
}

function manualMeaningHasContent(meaning) {
  return Boolean(meaning.zh.trim() || meaning.pattern.trim() || meaning.examples.trim());
}

function manualMeaningToItemMeaning(meaning, index) {
  if (!meaning.zh.trim()) throw new Error(`第 ${index + 1} 個意思需要中文`);
  return {
    ...(meaning.id ? { id: meaning.id } : {}),
    zh: meaning.zh.trim(),
    ...(meaning.pattern.trim() ? { pattern: meaning.pattern.trim() } : {}),
    examples: parsePairLines(meaning.examples),
  };
}

function manualToItem(manual, allItems = []) {
  if (!manual.ko.trim()) throw new Error('韓文是必填');
  const meaningInputs = (manual.meanings || []).filter(manualMeaningHasContent);
  if (!meaningInputs.length) throw new Error('至少需要 1 個中文意思');
  const item = {
    ko: manual.ko.trim(),
    meanings: meaningInputs.map(manualMeaningToItemMeaning),
  };
  if (manual.pos) item.pos = manual.pos;
  const notesMarkdown = manual.notes.trim();
  if (notesMarkdown) item.notes = [notesMarkdown];
  const related = (manual.relatedSelected || []).filter((id) => allItems.some((candidate) => candidate.id === id));
  if (related.length) item.related = related;
  return item;
}

function itemToManual(item, initialKo = '') {
  if (!item) {
    return { ko: initialKo, pos: '', meanings: [emptyManualMeaning()], notes: '', relatedSelected: [], relatedQuery: '' };
  }
  return {
    ko: item.ko || '',
    pos: item.pos || '',
    meanings: (item.meanings?.length ? item.meanings : [emptyManualMeaning()]).map((meaning) => ({
      id: meaning.id || '',
      zh: meaning.zh || '',
      pattern: meaning.pattern || '',
      examples: formatPairLines(meaning.examples),
    })),
    notes: (item.notes || []).join('\n\n'),
    relatedSelected: (item.related || []).filter(Boolean),
    relatedQuery: '',
  };
}

function mergeEditedItem(original, manual, allItems = []) {
  const edited = manualToItem(manual, allItems);
  const {
    id,
    date,
    index,
    order,
    createdAt,
    updatedAt,
    total,
    rate,
    score,
    level,
    ...content
  } = original;
  const next = { ...content, ...edited };
  ['pos', 'meanings', 'notes', 'related'].forEach((key) => {
    if (edited[key] === undefined) delete next[key];
  });
  return next;
}
