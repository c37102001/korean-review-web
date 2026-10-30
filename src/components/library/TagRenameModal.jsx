import { useState } from 'react';
import { Check, X } from 'lucide-react';

export function TagRenameModal({ tag, countLabel, onSave, onClose }) {
  const [name, setName] = useState(tag);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave(name.trim());
      onClose();
    } catch (saveError) {
      setError(saveError.message || '標籤儲存失敗');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tag-rename-title">
      <form className="modal-panel folder-name-modal" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="folder-editor-head"><h2 id="tag-rename-title">編輯標籤</h2><span>{countLabel}</span></div>
        <label className="grammar-field"><span>標籤名稱</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={40} disabled={saving} placeholder="留空會歸類為無標籤" /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-actions folder-editor-actions">
          <button type="button" disabled={saving} onClick={onClose}>取消</button>
          <button className="primary" disabled={saving} type="submit"><Check size={17} /> {saving ? '儲存中' : '儲存'}</button>
        </div>
      </form>
    </div>
  );
}
