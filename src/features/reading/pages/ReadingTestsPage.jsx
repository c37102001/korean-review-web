import { useMemo, useState } from 'react';
import { Check, Copy, Plus, Trash2, X } from 'lucide-react';
import { ActionMenu } from '../../../components/actions/ActionMenu.jsx';
import { EditIconButton } from '../../../components/actions/ContentActionButtons.jsx';
import { CollapsibleGroup, EntityCardShell, EntityGrid, LibraryPageShell } from '../../../components/library/LibraryPrimitives.jsx';
import {
  formatReadingTestsJson,
  groupReadingTestsByTag,
  parseReadingTestsJson,
  readingTestTagLabel,
  READING_TEST_JSON_SAMPLE,
  UNTAGGED_READING_TEST_LABEL,
} from '../../../reading/model.js';
import { copyText } from '../../../shared/clipboard.js';
import { formatContentTimestamp } from '../../../shared/dateTime.js';

function ReadingTestCard({ test, index, onOpen, onEdit, onDelete }) {
  return (
    <EntityCardShell className="reading-test-card" onOpen={() => onOpen(test.id)}>
      <div className="card-head">
        <div><span className="eyebrow">Reading · {test.options.length} choices</span><h2>閱讀題 {index + 1}</h2></div>
        <div className="card-actions">
          <EditIconButton label="編輯閱讀題" onClick={() => onEdit(test)} />
          <button type="button" className="edit-icon-button delete-icon-button" title="刪除閱讀題" aria-label="刪除閱讀題" onClick={(event) => { event.stopPropagation(); onDelete(test); }}><Trash2 size={15} /></button>
        </div>
      </div>
      <p>{test.passage.ko}</p>
      <div className="yt-subtitle-note-meta">
        <span className="yt-subtitle-tag-chip">{readingTestTagLabel(test)}</span>
        {test.learned && <span className="yt-subtitle-learned-chip"><Check size={13} /> 已學習</span>}
        <span>{test.options.length} 個選項</span>
        <span>{formatContentTimestamp(test.updatedAt || test.createdAt)}</span>
      </div>
    </EntityCardShell>
  );
}

export function ReadingTestsEditorModal({ test, existingTests, tagSuggestions = [], onSave, onClose }) {
  const [source, setSource] = useState(() => test ? formatReadingTestsJson([test]) : READING_TEST_JSON_SAMPLE);
  const [tag, setTag] = useState(test?.tag || '');
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
    try {
      await onSave(test ? [{ ...preview.tests[0], tag: tag.trim() }] : preview.tests);
    } catch (saveError) { setError(saveError.message || '儲存閱讀題失敗'); } finally { setSaving(false); }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={test ? '編輯閱讀題' : '匯入閱讀題'}>
      <form className="modal-panel reading-test-editor" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-modal-head"><span className="eyebrow">Reading Practice JSON</span><h2>{test ? '編輯閱讀題' : '批次匯入閱讀題'}</h2></div>
        {test && <label className="grammar-field"><span>標籤 <small>選填</small></span><input value={tag} onChange={(event) => setTag(event.target.value)} list="reading-test-tag-suggestions" placeholder="留空會歸類為無標籤" />{!!tagSuggestions.length && <datalist id="reading-test-tag-suggestions">{tagSuggestions.map((suggestion) => <option value={suggestion} key={suggestion} />)}</datalist>}</label>}
        <label className="grammar-field tagged-note-field">
          <span>JSON 內容</span>
          <textarea className="yt-subtitle-source" value={source} onChange={(event) => setSource(event.target.value)} rows={24} spellCheck={false} />
          <small>`data` 可放多題；每題可填選用的 `tag`；`passage` 是文章、`question` 是提問、`options` 是中韓選項，`answer` 必須填正確選項的 id，`learned` 預設 false。</small>
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
  const [collapsedTags, setCollapsedTags] = useState(() => new Set());
  const [formatCopied, setFormatCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-TW');
    return tests.filter((test) => !keyword || [
      test.tag, test.passage.ko, test.passage.zh, test.question.ko, test.question.zh,
      ...test.options.flatMap((option) => [option.ko, option.zh]),
    ].filter(Boolean).join(' ').toLocaleLowerCase('zh-TW').includes(keyword));
  }, [query, tests]);
  const groups = useMemo(() => groupReadingTestsByTag(filtered), [filtered]);
  const tagSuggestions = useMemo(() => groupReadingTestsByTag(tests)
    .filter((group) => group.label !== UNTAGGED_READING_TEST_LABEL)
    .map((group) => group.label), [tests]);
  const toggleTag = (tagLabel) => setCollapsedTags((current) => {
    const next = new Set(current);
    if (next.has(tagLabel)) next.delete(tagLabel);
    else next.add(tagLabel);
    return next;
  });
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
    <LibraryPageShell
      className="reading-tests-page"
      eyebrow="Reading Practice"
      title="閱讀測驗"
      actions={<>
          <button className="primary" onClick={() => setEditing({})}><Plus size={18} /> 匯入題目</button>
          <ActionMenu>
            <button type="button" onClick={copyJsonFormat}><Copy size={18} /> {formatCopied ? '已複製格式' : '複製 JSON 格式'}</button>
          </ActionMenu>
      </>}
      query={query}
      onQueryChange={setQuery}
      searchPlaceholder="搜尋韓文文章、題目、選項或中文翻譯"
      error={error}
    >
      {actionError && <div className="form-error">{actionError}</div>}
      {filtered.length ? <div className="folder-tag-groups reading-test-tag-groups">{groups.map((group) => {
        const collapsed = collapsedTags.has(group.label);
        return <CollapsibleGroup className="folder-tag-group" collapsed={collapsed} onToggle={() => toggleTag(group.label)} title={group.label} countLabel={`${group.tests.length} 題`} key={group.label}>
          <EntityGrid className="reading-test-grid">{group.tests.map((test, index) => <ReadingTestCard key={test.id} test={test} index={index} onOpen={onOpen} onEdit={setEditing} onDelete={deleteTest} />)}</EntityGrid>
        </CollapsibleGroup>;
      })}</div> : <div className="panel grammar-empty">{query ? '找不到符合的閱讀題。' : '還沒有閱讀題，請用 JSON 一次匯入一題或多題。'}</div>}
      {editing && <ReadingTestsEditorModal test={editing.id ? editing : null} existingTests={tests} tagSuggestions={tagSuggestions} onSave={async (nextTests) => { if (editing.id) await onSave(nextTests[0]); else await onSaveMany(nextTests); setEditing(null); }} onClose={() => setEditing(null)} />}
    </LibraryPageShell>
  );
}
