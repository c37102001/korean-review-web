import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Eye, EyeOff, Folder, Trash2, X } from 'lucide-react';

import { EditIconButton, KoreanSpeakButton, StarButton } from '../../../components/actions/ContentActionButtons.jsx';
import { wordSpeechText } from '../../../words/speech.js';
import { relatedWords, wordExamples } from '../../../words/records.js';
import './word-presentation.css';

const MARKDOWN_PLUGINS = [remarkGfm];

function DeleteIconButton({ word, onDelete, label = '刪除', confirmMessage }) {
  if (!onDelete) return null;
  return (
    <button
      type="button"
      className="edit-icon-button delete-icon-button"
      onClick={async (event) => {
        event.stopPropagation();
        if (!window.confirm(confirmMessage || `確定要刪除「${word.ko}」嗎？`)) return;
        await onDelete(word.id);
      }}
      aria-label={label}
      title={label}
    >
      <Trash2 size={15} />
    </button>
  );
}

function MasteryBadge({ level }) {
  if (!level) return null;
  return <span className={`badge mastery-${level}`}>{level}</span>;
}

export function WordCardActions({
  word,
  isStarred = false,
  onToggleStar,
  onEdit,
  onDelete,
  deleteLabel,
  deleteConfirmMessage,
  selectable = false,
  selected = false,
  onToggleSelected,
  showChinese = false,
  onToggleChinese,
  badge,
}) {
  return (
    <div className="card-actions">
      {selectable && (
        <label className="word-select-control" title="選取單字" onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={() => onToggleSelected(word.id)} />
          <span className="sr-only">選取 {word.ko}</span>
        </label>
      )}
      <StarButton active={isStarred} onClick={onToggleStar} />
      {onToggleChinese && (
        <button
          type="button"
          className="edit-icon-button word-chinese-toggle"
          onClick={(event) => {
            event.stopPropagation();
            onToggleChinese();
          }}
          aria-label={showChinese ? '隱藏中文' : '顯示中文'}
          title={showChinese ? '隱藏中文' : '顯示中文'}
          aria-pressed={showChinese}
        >
          {showChinese ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      )}
      {onEdit && <EditIconButton onClick={() => onEdit(word)} />}
      <DeleteIconButton word={word} onDelete={onDelete} label={deleteLabel} confirmMessage={deleteConfirmMessage} />
      {badge === 'mastery' ? <MasteryBadge level={word.level} /> : badge && <span className="badge">{badge}</span>}
    </div>
  );
}

export function WordMetadata({ word }) {
  const score = Number.isFinite(Number(word.score)) ? Number(word.score) : 0;
  const total = Number.isFinite(Number(word.total)) ? Number(word.total) : 0;
  const metadata = [
    word.pos && word.pos !== '未分類' ? word.pos : '',
    word.date || '',
    `${total} 次`,
    score !== 0 ? `熟悉分數 ${score > 0 ? `+${score}` : score}` : '',
    word.noReview ? '不複習' : '',
  ].filter(Boolean);
  if (!metadata.length) return null;
  return (
    <div className="word-meta">
      {metadata.map((value) => <span key={value}>{value}</span>)}
    </div>
  );
}

export function WordFolderTags({ wordId, folders = [] }) {
  const memberships = folders.filter((folder) => (folder.wordIds || []).includes(wordId));
  if (!memberships.length) return null;
  return (
    <div className="word-folder-tags" aria-label="所屬資料夾">
      {memberships.map((folder) => <span key={folder.id}><Folder size={12} /> {folder.name}</span>)}
    </div>
  );
}

export function WordVariantTags({ variants = [] }) {
  if (!variants.length) return null;
  return (
    <div className="word-variant-tags" aria-label="活用形式">
      <span className="word-variant-label">活用形式</span>
      {variants.map((variant) => <span key={variant} lang="ko">{variant}</span>)}
    </div>
  );
}

export function WordCard({
  word,
  folders = [],
  onSpeak,
  onEdit,
  onDelete,
  deleteLabel,
  deleteConfirmMessage,
  onOpen,
  isStarred = false,
  onToggleStar,
  selectable = false,
  selected = false,
  onToggleSelected,
  showChinese = false,
  onToggleChinese,
}) {
  return (
    <article
      className={`word-card ${onOpen ? 'clickable-card' : ''} ${selected ? 'selected-word-card' : ''}`}
      onClick={onOpen ? () => onOpen(word) : undefined}
    >
      <div className="card-head word-card-head">
        <h3 className="speakable-heading"><span>{word.ko}</span><KoreanSpeakButton text={wordSpeechText(word)} onSpeak={onSpeak} /></h3>
        <WordCardActions
          word={word}
          isStarred={isStarred}
          onToggleStar={onToggleStar}
          onEdit={onEdit}
          onDelete={onDelete}
          deleteLabel={deleteLabel}
          deleteConfirmMessage={deleteConfirmMessage}
          selectable={selectable}
          selected={selected}
          onToggleSelected={onToggleSelected}
          showChinese={showChinese}
          onToggleChinese={onToggleChinese}
          badge="mastery"
        />
      </div>
      {showChinese && <p className="word-card-meaning">{word.zh}</p>}
      <WordMetadata word={word} />
      <WordFolderTags wordId={word.id} folders={folders} />
    </article>
  );
}

function MarkdownContent({ value, className = '' }) {
  const markdown = (Array.isArray(value) ? value : [value])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join('\n\n');
  if (!markdown) return null;
  return (
    <div className={`markdown-content ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={MARKDOWN_PLUGINS}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >{markdown}</ReactMarkdown>
    </div>
  );
}

function RelatedPreviewCard({ word, position }) {
  const firstExamples = wordExamples(word).slice(0, 2);
  const style = position ? { left: position.left, top: position.top, transform: position.transform } : undefined;
  return (
    <div className="related-preview-card" style={style} data-placement={position?.placement || 'mobile'} role="tooltip">
      <div className="preview-head">
        <strong>{word.ko}</strong>
        {word.pos && <span>{word.pos}</span>}
      </div>
      <p className="preview-zh">{word.zh}</p>
      {!!word.notes?.length && <MarkdownContent value={word.notes} className="preview-note" />}
      {!!firstExamples.length && (
        <div className="preview-examples">
          {firstExamples.map((example) => (
            <p key={example.id || example.ko}>{example.ko}<br /><span>{example.zh}</span></p>
          ))}
        </div>
      )}
    </div>
  );
}

function RelatedWordTag({ word, onOpenWord }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(null);
  const wrapRef = useRef(null);
  const touchPreviewRef = useRef(false);
  const label = `${word.ko}${word.zh ? ` · ${word.zh}` : ''}`;
  const Tag = onOpenWord ? 'button' : 'span';
  const updatePreviewPosition = () => {
    if (!wrapRef.current || window.matchMedia('(max-width: 920px)').matches) {
      setPreviewPosition(null);
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    const cardWidth = Math.min(360, window.innerWidth - 32);
    const edgePadding = 18;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, cardWidth / 2 + edgePadding),
      window.innerWidth - cardWidth / 2 - edgePadding,
    );
    const placeAbove = rect.top > 300;
    setPreviewPosition({
      left,
      top: placeAbove ? rect.top - 12 : rect.bottom + 12,
      transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      placement: placeAbove ? 'top' : 'bottom',
    });
  };
  const openPreview = () => {
    updatePreviewPosition();
    setPreviewOpen(true);
  };

  useEffect(() => {
    if (!previewOpen) return undefined;
    const reposition = () => updatePreviewPosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [previewOpen]);

  return (
    <span
      ref={wrapRef}
      className="related-tag-wrap"
      onMouseEnter={openPreview}
      onMouseLeave={() => setPreviewOpen(false)}
      onTouchStart={(event) => {
        event.preventDefault();
        touchPreviewRef.current = true;
        openPreview();
      }}
      onTouchEnd={() => {
        setPreviewOpen(false);
        setTimeout(() => {
          touchPreviewRef.current = false;
        }, 250);
      }}
      onTouchCancel={() => {
        setPreviewOpen(false);
        touchPreviewRef.current = false;
      }}
    >
      <Tag
        type={onOpenWord ? 'button' : undefined}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (touchPreviewRef.current) return;
          onOpenWord?.(word);
        }}
      >
        {label}
      </Tag>
      {previewOpen && createPortal(<RelatedPreviewCard word={word} position={previewPosition} />, document.body)}
    </span>
  );
}

export function WordDetails({ word, allWords = [], onOpenWord, onSpeak, showChinese = true, emptyMessage = '' }) {
  const resolvedRelatedWords = relatedWords(word, allWords);
  const visibleMeanings = showChinese
    ? word.meanings || []
    : (word.meanings || []).filter((meaning) => (meaning.examples || []).some((example) => example.ko));
  const hasDetails = visibleMeanings.length
    || (showChinese && word.variants?.length)
    || (showChinese && word.notes?.length)
    || (showChinese && resolvedRelatedWords.length);
  if (!hasDetails && emptyMessage) return <div className="empty">{emptyMessage}</div>;

  return (
    <div className="rich-details">
      {showChinese && <WordVariantTags variants={word.variants} />}
      {!!visibleMeanings.length && (
        <section className="detail-section meanings-section">
          <div className="detail-section-title"><span>{showChinese ? '意思' : '例句'}</span><small>{visibleMeanings.length} 組</small></div>
          <div className="meaning-list">
            {visibleMeanings.map((meaning, index) => (
              <article key={meaning.id} className="meaning-block">
                <div className="meaning-head">
                  <span>{index + 1}</span>
                  {showChinese && <strong>{meaning.zh}</strong>}
                </div>
                {showChinese && meaning.pattern && <div className="meaning-pattern">{meaning.pattern}</div>}
                {!!meaning.examples?.length && (
                  <div className="example-list">
                    {meaning.examples.map((example) => (
                      <div key={example.id || example.ko} className="example-row">
                        <p className="example-ko"><span>{example.ko}</span><KoreanSpeakButton text={example.ko} onSpeak={onSpeak} /></p>
                        {showChinese && <p className="example-zh">{example.zh}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {showChinese && !!word.notes?.length && (
        <section className="detail-section note-section">
          <div className="detail-section-title"><span>筆記</span></div>
          <MarkdownContent value={word.notes} className="note-markdown" />
        </section>
      )}
      {showChinese && !!resolvedRelatedWords.length && (
        <section className="detail-section related-section">
          <div className="detail-section-title"><span>相關詞</span></div>
          <div className="tags rich-tags">
            {resolvedRelatedWords.map((entry) => <RelatedWordTag key={entry.id} word={entry} onOpenWord={onOpenWord} />)}
          </div>
        </section>
      )}
    </div>
  );
}

export function WordDetailCard({
  word,
  allWords = [],
  onSpeak,
  onEdit,
  onDelete,
  onOpenWord,
  isStarred = false,
  onToggleStar,
}) {
  return (
    <article className="word-card word-detail-card">
      <div className="card-head word-card-head">
        <h3 className="speakable-heading"><span>{word.ko}</span><KoreanSpeakButton text={wordSpeechText(word)} onSpeak={onSpeak} /></h3>
        <WordCardActions
          word={word}
          isStarred={isStarred}
          onToggleStar={onToggleStar}
          onEdit={onEdit}
          onDelete={onDelete}
          badge={word.pos}
        />
      </div>
      <p className="zh">{word.zh}</p>
      <WordDetails word={word} allWords={allWords} onOpenWord={onOpenWord} onSpeak={onSpeak} />
    </article>
  );
}

export function ItemDetailModal({
  item,
  allItems = [],
  onSpeak,
  onEdit,
  onDelete,
  onOpenItem,
  onClose,
  isStarred = false,
  onToggleStar,
}) {
  const deleteAndClose = onDelete
    ? async (itemId) => {
      await onDelete(itemId);
      onClose();
    }
    : null;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel detail-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <WordDetailCard
          word={item}
          allWords={allItems}
          onSpeak={onSpeak}
          onEdit={onEdit}
          onDelete={deleteAndClose}
          onOpenWord={onOpenItem}
          isStarred={isStarred}
          onToggleStar={onToggleStar}
        />
      </div>
    </div>
  );
}

export function WordMatchesModal({
  items = [],
  allItems = [],
  onSpeak,
  onEdit,
  onDelete,
  onOpenItems,
  onClose,
}) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!items.length) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`符合 ${items.length} 張單字卡`}>
      <div className={`modal-panel detail-panel ${items.length > 1 ? 'word-matches-panel' : ''}`}>
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        {items.length > 1 && <div className="word-matches-heading"><strong>符合 {items.length} 張單字卡</strong></div>}
        <div className="word-matches-list">
          {items.map((item) => <WordDetailCard
            key={item.id || item.ko}
            word={item}
            allWords={allItems}
            onSpeak={onSpeak}
            onEdit={onEdit}
            onDelete={onDelete ? async (itemId) => { await onDelete(itemId); onClose(); } : null}
            onOpenWord={(word) => onOpenItems?.([word])}
          />)}
        </div>
      </div>
    </div>
  );
}
