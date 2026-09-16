import React from 'react';
import { Pencil, Star, Volume2 } from 'lucide-react';

export function EditIconButton({ onClick, label = '編輯' }) {
  return (
    <button
      type="button"
      className="edit-icon-button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
    >
      <Pencil size={15} />
    </button>
  );
}

export function StarButton({ active, onClick }) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      className={`star-button ${active ? 'active' : ''}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      aria-label={active ? '取消星號' : '打星號'}
      title={active ? '取消星號' : '打星號'}
    >
      <Star size={17} />
    </button>
  );
}

export function KoreanSpeakButton({ text, onSpeak, label = '播放韓文發音' }) {
  if (!text || !onSpeak) return null;
  return (
    <button
      type="button"
      className="speak-icon-button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSpeak(text, 'ko-KR');
      }}
      aria-label={label}
      title={label}
    >
      <Volume2 size={15} />
    </button>
  );
}
