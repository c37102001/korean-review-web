import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, X } from 'lucide-react';
import { formatPairLines, normalizeKoreanKey, parsePairLines } from '../../../words/records.js';

export function QuickAddWordModal({ selection, entries = [], allItems = [], sourceLabel = '字幕', includeInitialExample = true, initialMarkLearned = true, onSubmit, onClose }) {
  const [ko, setKo] = useState(selection.ko);
  const [zh, setZh] = useState(selection.zh || '');
  const [examples, setExamples] = useState(() => includeInitialExample ? formatPairLines([selection.entry]) : '');
  const entryIndex = entries.findIndex((entry) => entry.id === selection.entry.id);
  const [previousIndex, setPreviousIndex] = useState(entryIndex - 1);
  const [nextIndex, setNextIndex] = useState(entryIndex + 1);
  const [history, setHistory] = useState([]);
  const [markLearned, setMarkLearned] = useState(initialMarkLearned);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const extendExample = (entry, position) => {
    try {
      const currentExamples = parsePairLines(examples);
      const current = {
        ko: currentExamples.map((example) => example.ko).join(' ').trim(),
        zh: currentExamples.map((example) => example.zh).join('').trim(),
      };
      const combined = position === 'before'
        ? { ko: `${entry.ko} ${current.ko}`.trim(), zh: `${entry.zh}${current.zh}`.trim() }
        : { ko: `${current.ko} ${entry.ko}`.trim(), zh: `${current.zh}${entry.zh}`.trim() };
      setHistory((currentHistory) => [...currentHistory, { examples, previousIndex, nextIndex }]);
      setExamples(formatPairLines([combined]));
      if (position === 'before') setPreviousIndex((index) => index - 1);
      else setNextIndex((index) => index + 1);
      setError('');
    } catch {
      setError('例句需要維持韓文一行、中文一行的格式，才能加入相鄰逐字稿。');
    }
  };
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setExamples(previous.examples);
    setPreviousIndex(previous.previousIndex);
    setNextIndex(previous.nextIndex);
    setHistory((current) => current.slice(0, -1));
    setError('');
  };
  const submit = async (event) => {
    event.preventDefault();
    const korean = ko.trim();
    const chinese = zh.trim();
    if (!korean || !chinese) { setError('韓文與中文都是必填'); return; }
    if (allItems.some((item) => normalizeKoreanKey(item.ko) === normalizeKoreanKey(korean))) {
      setError(`韓文單字「${korean}」已存在於單字本，請直接編輯既有單字卡。`);
      return;
    }
    let parsedExamples;
    try { parsedExamples = parsePairLines(examples); } catch (parseError) {
      setError(parseError.message || '例句格式錯誤，請確認每組都是韓文一行、中文一行。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ ko: korean, zh: chinese, examples: parsedExamples, markLearned });
      onClose();
    } catch (submitError) {
      setError(submitError.message || '新增單字失敗');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`從${sourceLabel}新增單字`}>
      <form className="modal-panel subtitle-quick-add-modal" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose} disabled={saving} aria-label="關閉"><X size={18} /></button>
        <div className="panel-title"><div><span className="eyebrow">Selected word</span><h2>新增單字</h2><span>{includeInitialExample ? `例句已自動帶入目前${sourceLabel}。` : '可視需要自行加入例句。'}</span></div></div>
        <div className="form-grid subtitle-quick-add-fields">
          <label>韓文<input value={ko} onChange={(event) => setKo(event.target.value)} required autoFocus /></label>
          <label>中文<input value={zh} onChange={(event) => setZh(event.target.value)} required placeholder="請填寫中文意思" /></label>
          <div className="full-width subtitle-example-field">
            <label htmlFor="subtitle-quick-add-examples">例句</label>
            {includeInitialExample && <span className="subtitle-example-extend-actions">
              <button type="button" className="small" onClick={() => previousIndex >= 0 && extendExample(entries[previousIndex], 'before')} disabled={previousIndex < 0} title="加入前一句逐字稿"><ArrowUp size={16} /><Plus size={14} /> 往前加</button>
              <button type="button" className="small" onClick={() => nextIndex < entries.length && extendExample(entries[nextIndex], 'after')} disabled={nextIndex >= entries.length} title="加入後一句逐字稿"><ArrowDown size={16} /><Plus size={14} /> 往後加</button>
              <button type="button" className="small subtitle-example-undo" onClick={undo} disabled={!history.length} title="復原上一次例句延伸" aria-label="復原上一次例句延伸"><RotateCcw size={16} /></button>
            </span>}
            <textarea id="subtitle-quick-add-examples" value={examples} onChange={(event) => { setExamples(event.target.value); setHistory([]); }} rows={4} />
          </div>
          <label className="subtitle-quick-add-learned"><input type="checkbox" checked={markLearned} onChange={(event) => setMarkLearned(event.target.checked)} /><span><strong>已學會</strong><small>同時加入「已學習」資料夾，不會出現在每日測驗。</small></span></label>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="actions grammar-editor-actions"><button type="button" onClick={onClose} disabled={saving}>取消</button><button className="primary" type="submit" disabled={saving}><Plus size={17} /> {saving ? '新增中' : '新增到單字本'}</button></div>
      </form>
    </div>
  );
}
