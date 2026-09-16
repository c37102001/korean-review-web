import { useMemo, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Plus, Search, Trash2, X } from 'lucide-react';
import { ActionMenu } from '../../../components/actions/ActionMenu.jsx';
import { EditIconButton } from '../../../components/actions/ContentActionButtons.jsx';
import {
  formatReadingTestsJson,
  parseReadingTestsJson,
  READING_TEST_JSON_SAMPLE,
} from '../../../reading/model.js';
import { copyText } from '../../../shared/clipboard.js';
import { formatContentTimestamp } from '../../../shared/dateTime.js';

function ReadingTestCard({ test, index, onOpen, onEdit, onDelete }) {
  return (
    <article className="reading-test-card clickable-card" onClick={() => onOpen(test.id)}>
      <div className="card-head">
        <div><span className="eyebrow">Reading · {test.options.length} choices</span><h2>閱讀題 {index + 1}</h2></div>
        <div className="card-actions">
          <EditIconButton label="編輯閱讀題" onClick={() => onEdit(test)} />
          <button type="button" className="edit-icon-button delete-icon-button" title="刪除閱讀題" aria-label="刪除閱讀題" onClick={(event) => { event.stopPropagation(); onDelete(test); }}><Trash2 size={15} /></button>
        </div>
      </div>
      <p>{test.passage.ko}</p>
      <div className="yt-subtitle-note-meta">
        {test.learned && <span className="yt-subtitle-learned-chip"><Check size={13} /> 已學習</span>}
        <span>{test.options.length} 個選項</span>
        <span>{formatContentTimestamp(test.updatedAt || test.createdAt)}</span>
      </div>
    </article>
  );
}

function ReadingTestsEditorModal({ test, existingTests, onSave, onClose }) {
  const [source, setSource] = useState(() => test ? formatReadingTestsJson([test]) : READING_TEST_JSON_SAMPLE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const preview = useMemo(() => {
    try {
      const parsed = parseReadingTestsJson(source, existingTests);
      if (test && parsed.length !== 1) throw new Error('編輯時 JSON 只能包含一題');
      return { tests: parsed, error: '' };
    } catch (parseError) {
      return { tests: [], error: parseError.message || '格式無法解析' };
    }
  }, [existingTests, source, test]);
  const submit = async (event) => {
    event.preventDefault();
    if (preview.error) { setError(preview.error); return; }
    setSaving(true);
    setError('');
    try { await onSave(preview.tests); } catch (saveError) { setError(saveError.message || '儲存閱讀題失敗'); } finally { setSaving(false); }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={test ? '編輯閱讀題' : '匯入閱讀題'}>
      <form className="modal-panel reading-test-editor" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-modal-head"><span className="eyebrow">Reading Practice JSON</span><h2>{test ? '編輯閱讀題' : '批次匯入閱讀題'}</h2></div>
        <label className="grammar-field tagged-note-field">
          <span>JSON 內容</span>
          <textarea className="yt-subtitle-source" value={source} onChange={(event) => setSource(event.target.value)} rows={24} spellCheck={false} />
          <small>`data` 可放多題；`passage` 是文章、`question` 是提問、`options` 是中韓選項，`answer` 必須填正確選項的 id，`learned` 預設 false。</small>
          <small className={preview.error ? 'subtitle-parse-error' : 'subtitle-parse-success'}>{preview.error || `格式正確，可儲存 ${preview.tests.length} 題`}</small>
        </label>
        {error && <div className="json-edit-error">{error}</div>}
        <div className="actions grammar-editor-actions"><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={saving || !!preview.error}><Check size={17} /> {saving ? '儲存中' : test ? '儲存修改' : `匯入 ${preview.tests.length || ''} 題`}</button></div>
      </form>
    </div>
  );
}

export default function ReadingTestsPage({ tests, error, onSave, onSaveMany, onDelete, onOpen }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [hideLearned, setHideLearned] = useState(true);
  const [formatCopied, setFormatCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const learnedCount = tests.filter((test) => test.learned).length;
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-TW');
    return tests.filter((test) => (!hideLearned || !test.learned) && (!keyword || [
      test.passage.ko, test.passage.zh, test.question.ko, test.question.zh,
      ...test.options.flatMap((option) => [option.ko, option.zh]),
    ].filter(Boolean).join(' ').toLocaleLowerCase('zh-TW').includes(keyword)));
  }, [hideLearned, query, tests]);
  const deleteTest = async (test) => {
    if (!window.confirm('確定要刪除這題閱讀題嗎？')) return;
    setActionError('');
    try { await onDelete(test.id); } catch (deleteError) { setActionError(deleteError.message || '刪除閱讀題失敗'); }
  };
  const copyJsonFormat = async () => {
    setActionError('');
    try {
      await copyText(READING_TEST_JSON_SAMPLE);
      setFormatCopied(true);
      window.setTimeout(() => setFormatCopied(false), 1600);
    } catch {
      setActionError('無法複製 JSON 格式，請在匯入視窗中手動選取。');
    }
  };
  return (
    <section className="page reading-tests-page">
      <div className="topbar">
        <div><span className="eyebrow">Reading Practice</span><h1>閱讀測驗</h1></div>
        <div className="actions notebook-actions">
          <button className="primary" onClick={() => setEditing({})}><Plus size={18} /> 匯入題目</button>
          <ActionMenu>
            <button type="button" className={`learned-visibility-button ${hideLearned ? 'active' : ''}`} aria-pressed={hideLearned} title={`${hideLearned ? '目前隱藏' : '目前顯示'} ${learnedCount} 個已學習題目`} onClick={() => setHideLearned((current) => !current)}>
              {hideLearned ? <EyeOff size={18} /> : <Eye size={18} />}{hideLearned ? '隱藏已學習' : '顯示已學習'}
            </button>
            <button type="button" onClick={copyJsonFormat}><Copy size={18} /> {formatCopied ? '已複製格式' : '複製 JSON 格式'}</button>
          </ActionMenu>
        </div>
      </div>
      <label className="search grammar-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋韓文文章、題目、選項或中文翻譯" /></label>
      {actionError && <div className="form-error">{actionError}</div>}
      {error && <div className="sync-error">Firebase 同步失敗：{error}</div>}
      {filtered.length ? <div className="reading-test-grid">{filtered.map((test, index) => <ReadingTestCard key={test.id} test={test} index={index} onOpen={onOpen} onEdit={setEditing} onDelete={deleteTest} />)}</div>
        : <div className="panel grammar-empty">{query ? '找不到符合的閱讀題。' : hideLearned && tests.length ? '目前沒有未學習的閱讀題。取消隱藏即可查看全部題目。' : '還沒有閱讀題，請用 JSON 一次匯入一題或多題。'}</div>}
      {editing && <ReadingTestsEditorModal test={editing.id ? editing : null} existingTests={tests} onSave={async (nextTests) => { if (editing.id) await onSave(nextTests[0]); else await onSaveMany(nextTests); setEditing(null); }} onClose={() => setEditing(null)} />}
    </section>
  );
}
