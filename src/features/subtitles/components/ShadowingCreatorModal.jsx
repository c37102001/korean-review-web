import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { createShadowingSubtitle, SHADOWING_SUBTITLE_TAG } from '../../../subtitles/shadowing.js';
import { subtitleTimeLabel } from '../../../subtitles/player.js';

export function ShadowingCreatorModal({ notes, onSave, onClose }) {
  const sources = notes.filter((note) => note.videoId && note.entries.length && note.tag !== SHADOWING_SUBTITLE_TAG);
  const [sourceId, setSourceId] = useState('');
  const [step, setStep] = useState('video');
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const source = sources.find((note) => note.id === sourceId);
  const toggleEntry = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (step === 'video') {
      if (source) setStep('sentences');
      return;
    }
    setSaving(true);
    try {
      await onSave(createShadowingSubtitle(source, selectedIds));
    } catch (saveError) {
      setError(saveError.message || '建立跟讀失敗');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="shadowing-creator-title">
      <form className="modal-panel shadowing-creator" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-modal-head"><h2 id="shadowing-creator-title">建立跟讀</h2></div>
        {step === 'video' ? (
          <label className="grammar-field"><span>選擇影片</span>
            <select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setSelectedIds([]); }} required>
              <option value="">請選擇影片</option>
              {sources.map((note) => <option key={note.id} value={note.id}>{note.tag ? `${note.tag} · ` : ''}{note.title}</option>)}
            </select>
            {!sources.length && <small>目前沒有含影片連結與字幕的檔案。</small>}
          </label>
        ) : (
          <>
            <h3 className="shadowing-source-title">{source?.title}</h3>
            <div className="bulk-selection-summary">
              <strong>已選 {selectedIds.length} 句</strong>
              <button type="button" className="text-link" disabled={saving} onClick={() => setSelectedIds(selectedIds.length === source?.entries.length ? [] : source.entries.map((entry) => entry.id))}>{selectedIds.length === source?.entries.length ? '取消全選' : '全選句子'}</button>
            </div>
            <fieldset className="shadowing-sentences" disabled={saving}>
              <legend className="sr-only">選擇字幕句子</legend>
              {source?.entries.map((entry, index) => (
                <label className="shadowing-sentence" key={entry.id}>
                  <input type="checkbox" aria-label={`第 ${index + 1} 句`} checked={selectedIds.includes(entry.id)} onChange={() => toggleEntry(entry.id)} />
                  <span><small>{index + 1}{entry.startMs !== null ? ` · ${subtitleTimeLabel(entry.startMs)}` : ''}</small><span lang="ko">{entry.ko}</span><span className="muted">{entry.zh}</span></span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="actions grammar-editor-actions">
          {step === 'sentences' && <button type="button" disabled={saving} onClick={() => { setStep('video'); setError(''); }}><ChevronLeft size={17} /> 上一步</button>}
          <button type="button" disabled={saving} onClick={onClose}>取消</button>
          <button type="submit" className="primary" disabled={saving || !source || (step === 'sentences' && !selectedIds.length)}>
            {step === 'video' ? <><ChevronRight size={17} /> 下一步</> : <><Check size={17} /> {saving ? '儲存中' : '儲存'}</>}
          </button>
        </div>
      </form>
    </div>
  );
}
