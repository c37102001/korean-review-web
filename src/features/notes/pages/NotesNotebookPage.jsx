import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Dumbbell,
  ListChecks,
  NotebookPen,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { EditIconButton } from '../../../components/actions/ContentActionButtons.jsx';
import { TextSpeakButton } from '../../../components/actions/TextSpeakButton.jsx';
import {
  formatTaggedNoteText,
  grammarPracticeQuestions,
  noteCategoryMeta,
  NOTE_CATEGORY_GRAMMAR,
  NOTE_CATEGORY_VOCABULARY,
  parseTaggedNoteText,
} from '../../../notes/model.js';

function noteSearchText(note) {
  return [
    note.title,
    note.notes,
    ...(note.examples || []).flatMap((example) => [example.ko, example.zh]),
  ].filter(Boolean).join(' ').toLocaleLowerCase('zh-TW');
}

function noteTimestamp(value) {
  if (!value) return '建立時間未記錄';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function GrammarNoteCard({ note, onOpen, onEdit, onDelete, onTogglePinned, selected, onToggleSelected, category }) {
  const meta = noteCategoryMeta(category);
  return (
    <article className={`grammar-card clickable-card ${selected ? 'selected' : ''}`} onClick={() => onOpen(note)}>
      <div className="card-head">
        <h2>{note.title}</h2>
        <div className="card-actions">
          <button
            type="button"
            className={`edit-icon-button pin-icon-button ${note.pinned ? 'active' : ''}`}
            onClick={(event) => { event.stopPropagation(); onTogglePinned(note); }}
            aria-label={note.pinned ? `取消釘選${meta.item}` : `釘選${meta.item}`}
            title={note.pinned ? '取消釘選' : '釘選到最上方'}
          ><Pin size={15} /></button>
          <label className="word-select-control" title={`選取${meta.item}`} onClick={(event) => event.stopPropagation()}>
            <input type="checkbox" checked={selected} onChange={() => onToggleSelected(note.id)} />
            <span className="sr-only">選取 {note.title}</span>
          </label>
          <EditIconButton onClick={() => onEdit(note)} label={`編輯${meta.item}`} />
          <button
            type="button"
            className="edit-icon-button delete-icon-button"
            onClick={(event) => { event.stopPropagation(); onDelete(note); }}
            aria-label={`刪除${meta.item}`}
            title={`刪除${meta.item}`}
          ><Trash2 size={15} /></button>
        </div>
      </div>
      {note.notes && <p className="grammar-card-notes">{note.notes}</p>}
      {!!note.examples.length && (
        <div className="grammar-card-example">
          <strong>{note.examples[0].ko}</strong>
          <span>{note.examples[0].zh}</span>
        </div>
      )}
      <div className="grammar-card-meta">
        <span>{noteTimestamp(note.createdAt)}</span>
        <span>{note.examples.length} 個例句</span>
      </div>
    </article>
  );
}

function GrammarEditorModal({ note, defaultCategory, onSave, onClose }) {
  const [category, setCategory] = useState(note?.category || defaultCategory);
  const [content, setContent] = useState(() => formatTaggedNoteText(note));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const parsed = parseTaggedNoteText(content, note?.examples || []);
      await onSave({ ...note, ...parsed, category });
    } catch (saveError) {
      setError(saveError.message || '儲存筆記失敗');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-panel grammar-editor" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-modal-head"><span className="eyebrow">Korean Note</span><h2>{note ? '編輯筆記' : '新增筆記'}</h2></div>
        <div className="grammar-field">
          <span>筆記分類</span>
          <div className="segmented compact note-category-control">
            <button type="button" className={category === NOTE_CATEGORY_GRAMMAR ? 'active' : ''} onClick={() => setCategory(NOTE_CATEGORY_GRAMMAR)}>文法筆記</button>
            <button type="button" className={category === NOTE_CATEGORY_VOCABULARY ? 'active' : ''} onClick={() => setCategory(NOTE_CATEGORY_VOCABULARY)}>單字筆記</button>
          </div>
        </div>
        <label className="grammar-field tagged-note-field">
          <span>筆記內容</span>
          <textarea
            className="tagged-note-textarea"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={26}
            spellCheck={false}
            placeholder={'[標題]\n\n表示過去反覆的習慣：動詞 + -곤 했다\n\n[筆記]\n\n用來表達「以前常常……」、「過去時常會……」。\n\n[例句]\n\n어렸을 때 주말마다 할머니 댁에 가곤 했어요.\n小時候每到週末常常會去奶奶家。'}
          />
          <small>請保留 [標題]、[筆記]、[例句]。例句使用韓文一行、中文一行，例句之間可空行。</small>
        </label>
        {error && <div className="json-edit-error">{error}</div>}
        <div className="actions grammar-editor-actions">
          <button type="button" disabled={saving} onClick={onClose}>取消</button>
          <button className="primary" disabled={saving} type="submit"><Check size={17} /> {saving ? '儲存中' : '儲存筆記'}</button>
        </div>
      </form>
    </div>
  );
}

function GrammarDetailModal({ note, category, onEdit, onDelete, onPractice, onClose }) {
  const meta = noteCategoryMeta(category);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.isComposing) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel grammar-detail-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-detail-head">
          <div><span className="eyebrow">{meta.eyebrow}</span><h2>{note.title}</h2></div>
          <div className="card-actions">
            <button className="small grammar-detail-practice" disabled={!grammarPracticeQuestions([note]).length} onClick={() => onPractice(note)}><Dumbbell size={16} /> 練習</button>
            <EditIconButton onClick={() => onEdit(note)} label={`編輯${meta.item}`} />
            <button className="edit-icon-button delete-icon-button" onClick={() => onDelete(note)} aria-label={`刪除${meta.item}`} title={`刪除${meta.item}`}><Trash2 size={15} /></button>
          </div>
        </div>
        <div className="grammar-created-at">建立於 {noteTimestamp(note.createdAt)}</div>
        {note.notes && <section className="grammar-detail-section"><h3>筆記</h3><div className="grammar-notes-content">{note.notes}</div></section>}
        {!!note.examples.length && (
          <section className="grammar-detail-section">
            <h3>例句 <span>{note.examples.length}</span></h3>
            <div className="grammar-example-list">
              {note.examples.map((example, index) => (
                <article className="grammar-example" key={example.id}>
                  <div className="grammar-example-number">{index + 1}</div>
                  {example.ko && <p className="grammar-example-ko"><span>{example.ko}</span><TextSpeakButton text={example.ko} lang="ko-KR" label="播放韓文例句" /></p>}
                  {example.zh && <p className="grammar-example-zh"><span>{example.zh}</span><TextSpeakButton text={example.zh} lang="zh-TW" label="播放中文翻譯" /></p>}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function NoteCategorySection({ category, notes, query, loading, collapsed, onToggleCollapse, onSave, onDelete, onPractice }) {
  const meta = noteCategoryMeta(category);
  const categoryNotes = useMemo(() => notes.filter((note) => note.category === category), [notes, category]);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    setEditing(null);
    setViewing(null);
    setSelectedIds([]);
    setActionError('');
  }, [category]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-TW');
    const matches = keyword ? categoryNotes.filter((note) => noteSearchText(note).includes(keyword)) : categoryNotes;
    return [...matches].sort((left, right) => (
      Number(right.pinned) - Number(left.pinned)
        || (right.createdAt || '').localeCompare(left.createdAt || '')
        || left.title.localeCompare(right.title)
    ));
  }, [categoryNotes, query]);
  useEffect(() => {
    const existingIds = new Set(categoryNotes.map((note) => note.id));
    setSelectedIds((current) => current.filter((id) => existingIds.has(id)));
  }, [categoryNotes]);
  const selectedNotes = categoryNotes.filter((note) => selectedIds.includes(note.id));
  const selectedQuestions = grammarPracticeQuestions(selectedNotes);
  const filteredIds = filtered.map((note) => note.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const toggleSelected = (noteId) => setSelectedIds((current) => (
    current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId]
  ));
  const toggleFiltered = () => setSelectedIds((current) => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredIds);
      return current.filter((id) => !filteredSet.has(id));
    }
    return [...new Set([...current, ...filteredIds])];
  });
  const startPractice = (targetNotes, label) => {
    const questions = grammarPracticeQuestions(targetNotes);
    if (!questions.length) {
      setActionError(`所選${meta.singular}沒有可練習的完整例句`);
      return;
    }
    setActionError('');
    onPractice(questions, label, { grammarOnly: true, noteCategory: category });
  };
  const deleteNote = async (note) => {
    if (!window.confirm(`確定要刪除「${note.title}」嗎？`)) return;
    setActionError('');
    try {
      await onDelete(note.id);
      if (viewing?.id === note.id) setViewing(null);
      setSelectedIds((current) => current.filter((id) => id !== note.id));
    } catch (error) {
      setActionError(error.message || `刪除${meta.singular}失敗`);
    }
  };
  const togglePinned = async (note) => {
    setActionError('');
    try {
      await onSave({ ...note, pinned: !note.pinned });
    } catch (error) {
      setActionError(error.message || `${note.pinned ? '取消釘選' : '釘選'}${meta.singular}失敗`);
    }
  };
  return (
    <section className={`note-category-section ${collapsed ? 'collapsed' : ''}`}>
      <div className="note-category-header">
        <button type="button" className="note-category-toggle" aria-expanded={!collapsed} onClick={onToggleCollapse} title={collapsed ? `展開${meta.singular}` : `收合${meta.singular}`}>
          <span className="note-category-heading"><span className="note-category-mark"><NotebookPen size={15} /></span><h2>{meta.heading}</h2></span>
          <span className="note-category-count">{categoryNotes.length} 篇</span><ChevronDown size={19} />
        </button>
      </div>
      {!collapsed && <>
        <div className="note-category-actions"><button className="primary" onClick={() => setEditing({ category })}><Plus size={17} /> {meta.addLabel}</button></div>
        <div className={`bulk-word-actions grammar-bulk-actions ${selectedIds.length ? 'has-selection' : ''}`}>
          <div className="bulk-selection-summary">
            <ListChecks size={19} /><strong>{selectedIds.length ? `已選 ${selectedIds.length} 個${meta.item}` : `選取${meta.singular}`}</strong>
            <button type="button" className="text-link" disabled={!filteredIds.length} onClick={toggleFiltered}>{allFilteredSelected ? '取消本頁' : '選取本頁'}</button>
            {!!selectedIds.length && <button type="button" className="text-link muted-link" onClick={() => setSelectedIds([])}>清除</button>}
          </div>
          {!!selectedIds.length && <div className="bulk-action-buttons"><button type="button" className="primary" disabled={!selectedQuestions.length} onClick={() => startPractice(selectedNotes, `已選 ${selectedNotes.length} 個${meta.item}`)}><Dumbbell size={17} /> 練習 ({selectedQuestions.length || 0})</button></div>}
        </div>
        {actionError && <div className="form-error">{actionError}</div>}
        {loading ? <div className="panel grammar-empty">載入{meta.singular}中...</div> : filtered.length ? (
          <div className="grammar-grid">{filtered.map((note) => <GrammarNoteCard key={note.id} note={note} onOpen={setViewing} onEdit={setEditing} onDelete={deleteNote} onTogglePinned={togglePinned} selected={selectedIds.includes(note.id)} onToggleSelected={toggleSelected} category={category} />)}</div>
        ) : <div className="panel grammar-empty">{query ? `找不到符合搜尋條件的${meta.singular}。` : `目前還沒有${meta.singular}。`}</div>}
      </>}
      {editing && <GrammarEditorModal note={editing.id ? editing : null} defaultCategory={editing.category || category} onSave={async (note) => { await onSave(note); setEditing(null); }} onClose={() => setEditing(null)} />}
      {viewing && <GrammarDetailModal note={viewing} category={viewing.category} onEdit={(note) => { setViewing(null); setEditing(note); }} onDelete={deleteNote} onPractice={(note) => { setViewing(null); startPractice([note], note.title); }} onClose={() => setViewing(null)} />}
    </section>
  );
}

export default function NotesNotebookPage({ notes, loading, error, onSave, onDelete, onPractice }) {
  const [query, setQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState(() => new Set());
  const toggleCategory = (category) => setCollapsedCategories((current) => {
    const next = new Set(current);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    return next;
  });
  return (
    <section className="page notes-notebook-page">
      <div className="topbar"><div><span className="eyebrow">Korean Notes</span><h1>筆記</h1></div></div>
      <label className="search grammar-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋標題、筆記或例句" /></label>
      {error && <div className="sync-error">Firebase 同步失敗：{error}</div>}
      {[NOTE_CATEGORY_VOCABULARY, NOTE_CATEGORY_GRAMMAR].map((category) => (
        <NoteCategorySection key={category} category={category} notes={notes} query={query} loading={loading} collapsed={collapsedCategories.has(category)} onToggleCollapse={() => toggleCategory(category)} onSave={onSave} onDelete={onDelete} onPractice={onPractice} />
      ))}
    </section>
  );
}
