import { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

import { copyText } from '../../../shared/clipboard.js';
import { highlightedTextLines } from '../model.js';

export function HighlightExportModal({ highlights = [], onClose }) {
  const [copied, setCopied] = useState(false);
  const lines = highlightedTextLines(highlights);
  const content = lines.join('\n');
  const copy = async () => {
    await copyText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="匯出劃線">
      <div className="modal-panel highlight-export-modal">
        <button type="button" className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <span className="eyebrow">Highlights</span>
        <h2>匯出劃線</h2>
        {lines.length ? <pre className="highlight-export-content">{content}</pre> : <div className="empty small-empty">目前沒有劃線內容。</div>}
        <div className="form-actions">
          <button type="button" className="primary" disabled={!lines.length} onClick={copy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? '已複製' : '複製'}</button>
        </div>
      </div>
    </div>
  );
}
