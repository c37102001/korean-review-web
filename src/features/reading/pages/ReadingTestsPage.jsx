import { useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, Plus, Trash2, X } from 'lucide-react';
import { ActionMenu } from '../../../components/actions/ActionMenu.jsx';
import { EditIconButton } from '../../../components/actions/ContentActionButtons.jsx';
import { ExportCodeBlock } from '../../../components/export/ExportCodeBlock.jsx';
import { CollapsibleGroup, EntityCardShell, EntityGrid, LibraryPageShell } from '../../../components/library/LibraryPrimitives.jsx';
import {
  assignReadingTestsTag,
  formatReadingTestsJson,
  groupReadingTestsByTag,
  parseReadingTestsJson,
  readingTestTagLabel,
  readingTestTitle,
  READING_TEST_JSON_SAMPLE,
  UNTAGGED_READING_TEST_LABEL,
} from '../../../reading/model.js';
import { copyText } from '../../../shared/clipboard.js';
import { formatContentTimestamp } from '../../../shared/dateTime.js';

function ReadingTestCard({ test, onOpen, onEdit, onDelete }) {
  const questionCount = test.questions.length;
  return (
    <EntityCardShell className="reading-test-card" onOpen={() => onOpen(test.id)}>
      <div className="card-head">
        <div><span className="eyebrow">Reading · {questionCount} questions</span><h2>{readingTestTitle(test)}</h2></div>
        <div className="card-actions">
          <EditIconButton label="編輯閱讀題" onClick={() => onEdit(test)} />
          <button type="button" className="edit-icon-button delete-icon-button" title="刪除閱讀題" aria-label="刪除閱讀題" onClick={(event) => { event.stopPropagation(); onDelete(test); }}><Trash2 size={15} /></button>
        </div>
      </div>
      <p>{test.passage.ko}</p>
      <div className="yt-subtitle-note-meta">
        <span className="yt-subtitle-tag-chip">{readingTestTagLabel(test)}</span>
        {test.learned && <span className="yt-subtitle-learned-chip"><Check size={13} /> 已學習</span>}
        <span>{questionCount} 題</span>
        <span>{formatContentTimestamp(test.updatedAt || test.createdAt)}</span>
      </div>
    </EntityCardShell>
  );
}

export function ReadingTestsEditorModal({ test, existingTests, tagSuggestions = [], onSave, onClose }) {
  const [source, setSource] = useState(() => test ? formatReadingTestsJson([test]) : READING_TEST_JSON_SAMPLE);
  const [tag, setTag] = useState(test?.tag || '');
  const [importStep, setImportStep] = useState('json');
  const [tagChoice, setTagChoice] = useState('');
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const preview = useMemo(() => {
    try {
      const parsed = parseReadingTestsJson(source, existingTests, { editingId: test?.id || '' });
      if (test && parsed.length !== 1) throw new Error('編輯時 JSON 只能包含一題');
      return { tests: parsed, error: '' };
    } catch (parseError) {
      return { tests: [], error: parseError.message || '格式無法解析' };
    }
  }, [existingTests, source, test]);
  const submit = async (event) => {
    event.preventDefault();
    if (preview.error) { setError(preview.error); return; }
    if (!test && importStep === 'json') {
      setImportStep('tag');
      setError('');
      return;
    }
    let testsToSave = preview.tests;
    if (!test) {
      if (!tagChoice) { setError('請選擇要匯入的標籤'); return; }
      if (tagChoice === 'new' && !newTag.trim()) { setError('請輸入新標籤名稱'); return; }
      if (tagChoice === 'untagged') testsToSave = assignReadingTestsTag(preview.tests, '');
      else if (tagChoice === 'new') testsToSave = assignReadingTestsTag(preview.tests, newTag);
      else if (tagChoice.startsWith('existing:')) testsToSave = assignReadingTestsTag(preview.tests, tagChoice.slice('existing:'.length));
    }
    setSaving(true);
    setError('');
    try {
      await onSave(test ? [{ ...preview.tests[0], tag: tag.trim() }] : testsToSave);
    } catch (saveError) { setError(saveError.message || '儲存閱讀題失敗'); } finally { setSaving(false); }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={test ? '編輯閱讀題' : '匯入閱讀題'}>
      <form className="modal-panel reading-test-editor" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-modal-head"><span className="eyebrow">Reading Practice JSON</span><h2>{test ? '編輯閱讀題' : '批次匯入閱讀題'}</h2></div>
        {!test && importStep === 'tag' ? (
          <ReadingImportTagStep
            count={preview.tests.length}
            tagSuggestions={tagSuggestions}
            tagChoice={tagChoice}
            onTagChoiceChange={(choice) => { setTagChoice(choice); setError(''); }}
            newTag={newTag}
            onNewTagChange={(value) => { setNewTag(value); setError(''); }}
          />
        ) : <>
          {test && <label className="grammar-field"><span>標籤 <small>選填</small></span><input value={tag} onChange={(event) => setTag(event.target.value)} list="reading-test-tag-suggestions" placeholder="留空會歸類為無標籤" />{!!tagSuggestions.length && <datalist id="reading-test-tag-suggestions">{tagSuggestions.map((suggestion) => <option value={suggestion} key={suggestion} />)}</datalist>}</label>}
          <label className="grammar-field tagged-note-field">
            <span>JSON 內容</span>
            <textarea className="yt-subtitle-source" value={source} onChange={(event) => setSource(event.target.value)} rows={24} spellCheck={false} />
            <small>`data` 可放多篇文章；每篇可填選用的 `tag`，並在 `questions` 放入 1 至 3 題。每題都有自己的 `question`、`options` 與 `answer`，其中 `answer` 必須是該題正確選項的 id；`learned` 預設 false。</small>
            <small className={preview.error ? 'subtitle-parse-error' : 'subtitle-parse-success'}>{preview.error || `格式正確，可儲存 ${preview.tests.length} 題`}</small>
          </label>
        </>}
        {error && <div className="json-edit-error">{error}</div>}
        <div className="actions grammar-editor-actions">
          {!test && importStep === 'tag' ? <button type="button" disabled={saving} onClick={() => { setImportStep('json'); setError(''); }}>返回修改 JSON</button> : <button type="button" disabled={saving} onClick={onClose}>取消</button>}
          <button type="submit" className="primary" disabled={saving || !!preview.error}><Check size={17} /> {saving ? '儲存中' : test ? '儲存修改' : importStep === 'tag' ? `確認匯入 ${preview.tests.length} 題` : `下一步：選擇標籤`}</button>
        </div>
      </form>
    </div>
  );
}

function ReadingImportTagStep({ count, tagSuggestions, tagChoice, onTagChoiceChange, newTag, onNewTagChange }) {
  return (
    <section className="reading-import-tag-step">
      <div className="reading-import-tag-heading">
        <strong>選擇匯入標籤</strong>
        <span>這個選擇會套用到本次匯入的 {count} 篇閱讀文章。</span>
      </div>
      <div className="reading-import-tag-options" role="radiogroup" aria-label="匯入標籤">
        <label><input type="radio" name="reading-import-tag" value="json" checked={tagChoice === 'json'} onChange={(event) => onTagChoiceChange(event.target.value)} /><span><strong>保留 JSON 內標籤</strong><small>每篇文章沿用 JSON 中的 tag，未填寫的會放在無標籤。</small></span></label>
        {tagSuggestions.map((suggestion) => <label key={suggestion}><input type="radio" name="reading-import-tag" value={`existing:${suggestion}`} checked={tagChoice === `existing:${suggestion}`} onChange={(event) => onTagChoiceChange(event.target.value)} /><span><strong>{suggestion}</strong><small>全部加入這個既有標籤。</small></span></label>)}
        <label><input type="radio" name="reading-import-tag" value="untagged" checked={tagChoice === 'untagged'} onChange={(event) => onTagChoiceChange(event.target.value)} /><span><strong>無標籤</strong><small>全部放在無標籤分類。</small></span></label>
        <label><input type="radio" name="reading-import-tag" value="new" checked={tagChoice === 'new'} onChange={(event) => onTagChoiceChange(event.target.value)} /><span><strong>新增標籤</strong><small>建立一個新的分類並加入全部文章。</small></span></label>
      </div>
      {tagChoice === 'new' && <label className="grammar-field reading-import-new-tag"><span>新標籤名稱</span><input value={newTag} onChange={(event) => onNewTagChange(event.target.value)} maxLength={40} autoFocus required /></label>}
    </section>
  );
}

function ReadingTestsExportModal({ tests, onClose }) {
  const tagGroups = useMemo(() => groupReadingTestsByTag(tests), [tests]);
  const [selectedTags, setSelectedTags] = useState(() => new Set());
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);
  const selectedTests = useMemo(() => tests.filter((test) => selectedTags.has(readingTestTagLabel(test))), [selectedTags, tests]);
  const jsonText = useMemo(() => formatReadingTestsJson(selectedTests), [selectedTests]);
  const toggleTag = (tag) => {
    setSelectedTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
    setCopied(false);
  };
  const copyJson = async () => {
    await copyText(jsonText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="匯出閱讀題">
      <div className="modal-panel reading-test-editor reading-test-export">
        <button type="button" className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-modal-head"><span className="eyebrow">Reading Practice JSON</span><h2>匯出題目</h2></div>
        {showJson ? <>
          <div className="reading-import-tag-heading">
            <strong>JSON 內容</strong>
            <span>已匯出 {selectedTests.length} 篇閱讀文章。</span>
          </div>
          <ExportCodeBlock content={jsonText} label="閱讀題 JSON 匯出內容" />
          <div className="actions grammar-editor-actions">
            <button type="button" onClick={() => { setShowJson(false); setCopied(false); }}><ArrowLeft size={17} /> 重新選擇</button>
            <button type="button" className="primary" onClick={copyJson}><Copy size={17} /> {copied ? '已複製' : '複製'}</button>
          </div>
        </> : <>
          <section className="reading-import-tag-step">
            <div className="reading-import-tag-heading">
              <strong>選擇匯出標籤</strong>
              <span>可複選；符合任一標籤的題目都會匯出。</span>
            </div>
            <div className="reading-import-tag-options reading-export-tag-options" aria-label="匯出標籤">
              {tagGroups.map((group) => (
                <label key={group.label}>
                  <input type="checkbox" checked={selectedTags.has(group.label)} onChange={() => toggleTag(group.label)} />
                  <span><strong>{group.label}</strong><small>{group.tests.length} 篇閱讀文章</small></span>
                </label>
              ))}
            </div>
          </section>
          <div className="actions grammar-editor-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" className="primary" disabled={!selectedTests.length} onClick={() => setShowJson(true)}><Check size={17} /> 產生 JSON（{selectedTests.length}）</button>
          </div>
        </>}
      </div>
    </div>
  );
}

export default function ReadingTestsPage({ tests, error, onSave, onSaveMany, onDelete, onOpen }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [collapsedTags, setCollapsedTags] = useState(() => new Set());
  const [formatCopied, setFormatCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState('');
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-TW');
    return tests.filter((test) => !keyword || [
      test.tag, test.passage.ko, test.passage.zh,
      ...test.questions.flatMap((question) => [
        question.question.ko,
        question.question.zh,
        ...question.options.flatMap((option) => [option.ko, option.zh]),
      ]),
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
          <button type="button" disabled={!tests.length} onClick={() => setExporting(true)}><Download size={18} /> 匯出題目</button>
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
          <EntityGrid className="reading-test-grid">{group.tests.map((test) => <ReadingTestCard key={test.id} test={test} onOpen={onOpen} onEdit={setEditing} onDelete={deleteTest} />)}</EntityGrid>
        </CollapsibleGroup>;
      })}</div> : <div className="panel grammar-empty">{query ? '找不到符合的閱讀題。' : '還沒有閱讀題，請用 JSON 一次匯入一題或多題。'}</div>}
      {editing && <ReadingTestsEditorModal test={editing.id ? editing : null} existingTests={tests} tagSuggestions={tagSuggestions} onSave={async (nextTests) => { if (editing.id) await onSave(nextTests[0]); else await onSaveMany(nextTests); setEditing(null); }} onClose={() => setEditing(null)} />}
      {exporting && <ReadingTestsExportModal tests={tests} onClose={() => setExporting(false)} />}
    </LibraryPageShell>
  );
}
