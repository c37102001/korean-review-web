import { useMemo, useState } from 'react';
import { Check, ChevronDown, Eye, EyeOff, Plus, Search, Trash2, X } from 'lucide-react';
import { ActionMenu } from '../../../components/actions/ActionMenu.jsx';
import { EditIconButton } from '../../../components/actions/ContentActionButtons.jsx';
import { formatContentTimestamp } from '../../../shared/dateTime.js';
import {
  formatYoutubeSubtitleJson,
  formatYoutubeSubtitleSrt,
  groupYoutubeSubtitlesByTag,
  parseYoutubeSubtitleJson,
  parseYoutubeSubtitleSrt,
  subtitleTagLabel,
  UNTAGGED_SUBTITLE_LABEL,
  YT_SUBTITLE_MODE_JSON,
  YT_SUBTITLE_MODE_SRT,
} from '../../../subtitles/model.js';

function YoutubeSubtitleCard({ note, onOpen, onEdit, onDelete }) {
  return (
    <article className="yt-subtitle-note-card clickable-card" onClick={() => onOpen(note.id)}>
      <div className="card-head">
        <div><span className="eyebrow">{note.mode === YT_SUBTITLE_MODE_SRT ? 'SRT subtitles' : 'Bilingual subtitles'}</span><h2>{note.title}</h2></div>
        <div className="card-actions">
          <EditIconButton label="編輯字幕筆記" onClick={() => onEdit(note)} />
          <button type="button" className="edit-icon-button delete-icon-button" title="刪除字幕筆記" aria-label="刪除字幕筆記" onClick={(event) => { event.stopPropagation(); onDelete(note); }}><Trash2 size={15} /></button>
        </div>
      </div>
      <p>{note.mode === YT_SUBTITLE_MODE_SRT ? '可點擊字幕跳轉影片時間' : '中韓逐句字幕'}</p>
      <div className="yt-subtitle-note-meta">
        <span className="yt-subtitle-tag-chip">{subtitleTagLabel(note)}</span>
        {note.learned && <span className="yt-subtitle-learned-chip"><Check size={13} /> 已學習</span>}
        <span>{note.entries.length} 句</span>
        <span>{note.videoId ? '已嵌入影片' : '沒有影片連結'}</span>
        <span>{formatContentTimestamp(note.updatedAt || note.createdAt)}</span>
      </div>
    </article>
  );
}

function YoutubeSubtitleEditorModal({ note, tagSuggestions = [], onSave, onClose }) {
  const initialMode = note?.mode === YT_SUBTITLE_MODE_SRT ? YT_SUBTITLE_MODE_SRT : YT_SUBTITLE_MODE_JSON;
  const [title, setTitle] = useState(note?.title || '');
  const [tag, setTag] = useState(note?.tag || '');
  const [learned, setLearned] = useState(note?.learned === true);
  const [youtubeUrl, setYoutubeUrl] = useState(note?.youtubeUrl || '');
  const [mode, setMode] = useState(initialMode);
  const [jsonText, setJsonText] = useState(() => formatYoutubeSubtitleJson(note?.entries || []));
  const [srtText, setSrtText] = useState(() => formatYoutubeSubtitleSrt(note?.entries || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const activeText = mode === YT_SUBTITLE_MODE_SRT ? srtText : jsonText;
  const setActiveText = mode === YT_SUBTITLE_MODE_SRT ? setSrtText : setJsonText;
  const preview = useMemo(() => {
    if (!activeText.trim()) return null;
    try {
      const entries = mode === YT_SUBTITLE_MODE_SRT
        ? parseYoutubeSubtitleSrt(activeText, note?.entries || [])
        : parseYoutubeSubtitleJson(activeText, note?.entries || []);
      return { count: entries.length, error: '' };
    } catch (parseError) {
      return { count: 0, error: parseError.message || '格式無法解析' };
    }
  }, [activeText, mode, note?.entries]);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const entries = mode === YT_SUBTITLE_MODE_SRT
        ? parseYoutubeSubtitleSrt(srtText, note?.entries || [])
        : parseYoutubeSubtitleJson(jsonText, note?.entries || []);
      await onSave({ ...note, title, tag, learned, youtubeUrl, mode, entries });
    } catch (saveError) {
      setError(saveError.message || '儲存字幕筆記失敗');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-panel yt-subtitle-editor" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-modal-head"><span className="eyebrow">YouTube Subtitles</span><h2>{note ? '編輯字幕筆記' : '新增字幕筆記'}</h2></div>
        <label className="grammar-field"><span>標題</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：影片名稱或主題" autoFocus required /></label>
        <label className="grammar-field"><span>標籤 <small>選填</small></span><input value={tag} onChange={(event) => setTag(event.target.value)} list="yt-subtitle-tag-suggestions" placeholder="留空會歸類為無標籤" />{!!tagSuggestions.length && <datalist id="yt-subtitle-tag-suggestions">{tagSuggestions.map((suggestion) => <option value={suggestion} key={suggestion} />)}</datalist>}</label>
        <label className="yt-subtitle-learned-option"><input type="checkbox" checked={learned} onChange={(event) => setLearned(event.target.checked)} /><span><strong>已學習</strong><small>標示完成後，預設不顯示在 YT 字幕列表中。</small></span></label>
        <label className="grammar-field"><span>YouTube 連結 <small>選填</small></span><input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." /></label>
        <div className="grammar-field"><span>字幕格式</span><div className="segmented compact note-category-control"><button type="button" className={mode === YT_SUBTITLE_MODE_JSON ? 'active' : ''} onClick={() => setMode(YT_SUBTITLE_MODE_JSON)}>JSON 逐句字幕</button><button type="button" className={mode === YT_SUBTITLE_MODE_SRT ? 'active' : ''} onClick={() => setMode(YT_SUBTITLE_MODE_SRT)}>SRT 時間字幕</button></div></div>
        <label className="grammar-field tagged-note-field">
          <span>{mode === YT_SUBTITLE_MODE_SRT ? 'SRT 字幕內容' : 'JSON 字幕內容'}</span>
          <textarea className="yt-subtitle-source" value={activeText} onChange={(event) => setActiveText(event.target.value)} spellCheck={false} rows={18} placeholder={mode === YT_SUBTITLE_MODE_SRT ? '1\n00:00:01,000 --> 00:00:04,000\n안녕하세요.\n你好。' : '{\n  "data": [\n    { "ko": "안녕하세요.", "zh": "你好。" }\n  ]\n}'} />
          <small>{mode === YT_SUBTITLE_MODE_SRT ? '每一段依序填入時間戳、韓文、中文。點擊字幕會跳轉到開始時間。' : '請使用 { "data": [{ "ko": "韓文", "zh": "中文" }] } 格式。'}</small>
          {preview && <small className={preview.error ? 'subtitle-parse-error' : 'subtitle-parse-success'}>{preview.error || `可匯入 ${preview.count} 句字幕`}</small>}
        </label>
        {error && <div className="json-edit-error">{error}</div>}
        <div className="actions grammar-editor-actions"><button type="button" disabled={saving} onClick={onClose}>取消</button><button className="primary" disabled={saving} type="submit"><Check size={17} /> {saving ? '儲存中' : '儲存字幕筆記'}</button></div>
      </form>
    </div>
  );
}

export default function YoutubeSubtitlesPage({ notes, error, onSave, onDelete, onOpen }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [actionError, setActionError] = useState('');
  const [collapsedTags, setCollapsedTags] = useState(() => new Set());
  const [hideLearned, setHideLearned] = useState(true);
  const visibleNotes = useMemo(() => (hideLearned ? notes.filter((note) => !note.learned) : notes), [hideLearned, notes]);
  const learnedCount = notes.filter((note) => note.learned).length;
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-TW');
    if (!keyword) return visibleNotes;
    return visibleNotes.filter((note) => [note.title, note.tag, note.youtubeUrl, ...note.entries.flatMap((entry) => [entry.ko, entry.zh])]
      .filter(Boolean).join(' ').toLocaleLowerCase('zh-TW').includes(keyword));
  }, [query, visibleNotes]);
  const groups = useMemo(() => groupYoutubeSubtitlesByTag(filtered), [filtered]);
  const tagSuggestions = useMemo(() => groupYoutubeSubtitlesByTag(notes)
    .filter((group) => group.label !== UNTAGGED_SUBTITLE_LABEL)
    .map((group) => group.label), [notes]);
  const toggleTag = (tag) => setCollapsedTags((current) => {
    const next = new Set(current);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    return next;
  });
  const deleteNote = async (note) => {
    if (!window.confirm(`確定要刪除「${note.title}」嗎？`)) return;
    setActionError('');
    try { await onDelete(note.id); } catch (deleteError) { setActionError(deleteError.message || '刪除字幕筆記失敗'); }
  };
  return (
    <section className="page yt-subtitles-page">
      <div className="topbar">
        <div><span className="eyebrow">YouTube Subtitles</span><h1>YT 字幕</h1></div>
        <div className="actions notebook-actions"><button className="primary" onClick={() => setEditing({})}><Plus size={18} /> 新增字幕</button><ActionMenu><button type="button" className={`learned-visibility-button ${hideLearned ? 'active' : ''}`} aria-pressed={hideLearned} title={`${hideLearned ? '目前隱藏' : '目前顯示'} ${learnedCount} 個已學習字幕檔案`} onClick={() => setHideLearned((current) => !current)}>{hideLearned ? <EyeOff size={18} /> : <Eye size={18} />}{hideLearned ? '隱藏已學習' : '顯示已學習'}</button></ActionMenu></div>
      </div>
      <label className="search grammar-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋標題、標籤、影片連結或字幕內容" /></label>
      {actionError && <div className="form-error">{actionError}</div>}{error && <div className="sync-error">Firebase 同步失敗：{error}</div>}
      {filtered.length ? <div className="folder-tag-groups yt-subtitle-tag-groups">{groups.map((group) => {
        const collapsed = collapsedTags.has(group.label);
        return <section className={`folder-tag-group ${collapsed ? 'collapsed' : ''}`} key={group.label}>
          <div className="folder-tag-group-head"><button type="button" className="folder-tag-group-toggle" aria-expanded={!collapsed} onClick={() => toggleTag(group.label)} title={collapsed ? `展開${group.label}` : `收合${group.label}`}><span className="folder-tag-group-heading"><span className="folder-tag-mark">標籤</span><h2>{group.label}</h2></span><ChevronDown size={18} /></button><span>{group.notes.length} 個字幕檔案</span></div>
          {!collapsed && <div className="yt-subtitle-note-grid">{group.notes.map((note) => <YoutubeSubtitleCard key={note.id} note={note} onOpen={onOpen} onEdit={setEditing} onDelete={deleteNote} />)}</div>}
        </section>;
      })}</div> : <div className="panel grammar-empty">{query ? '找不到符合的字幕筆記。' : hideLearned && notes.length ? '目前沒有未學習的字幕筆記。取消隱藏即可查看全部字幕。' : '還沒有字幕筆記。新增一篇後即可放入中韓字幕。'}</div>}
      {editing && <YoutubeSubtitleEditorModal note={editing.id ? editing : null} tagSuggestions={tagSuggestions} onSave={async (note) => { await onSave(note); setEditing(null); }} onClose={() => setEditing(null)} />}
    </section>
  );
}
