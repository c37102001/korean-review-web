import React from 'react';
import { Check, FolderInput, X } from 'lucide-react';

export function WordFolderButtons({ compact = false, isLearned = false, isUnfamiliar = false, learnedSaving = false, unfamiliarSaving = false, onMarkLearned, onMarkUnfamiliar }) {
  return (
    <div className={`answer-folder-buttons ${compact ? 'compact-folder-buttons' : ''}`}>
      <button
        type="button"
        className={`unfamiliar-soft ${isUnfamiliar ? 'selected-soft' : ''}`}
        disabled={unfamiliarSaving}
        onClick={onMarkUnfamiliar}
        title={isUnfamiliar ? '移出「不熟悉」' : '加入「不熟悉」'}
      >
        <FolderInput size={compact ? 15 : 18} />
        <span>{compact ? '不熟悉' : unfamiliarSaving ? '更新中' : isUnfamiliar ? '移出「不熟悉」' : '加入「不熟悉」'}</span>
      </button>
      <button
        type="button"
        className={`learned-soft ${isLearned ? 'selected-soft' : ''}`}
        disabled={learnedSaving}
        onClick={onMarkLearned}
        title={isLearned ? '移出「已學習」' : '加入「已學習」'}
      >
        <FolderInput size={compact ? 15 : 18} />
        <span>{compact ? '已學會' : learnedSaving ? '更新中' : isLearned ? '移出「已學習」' : '加入「已學習」'}</span>
      </button>
    </div>
  );
}

export function PracticeDecisionBar({ canClassify, isLearned, isUnfamiliar, learnedSaving, unfamiliarSaving, learnedError, unfamiliarError, onToggleLearned, onToggleUnfamiliar, onCorrect, onWrong, disabled = false }) {
  return (
    <div className="answer-panel practice-decision-panel">
      {canClassify && (
        <WordFolderButtons
          compact
          isLearned={isLearned}
          isUnfamiliar={isUnfamiliar}
          learnedSaving={learnedSaving}
          unfamiliarSaving={unfamiliarSaving}
          onMarkLearned={onToggleLearned}
          onMarkUnfamiliar={onToggleUnfamiliar}
        />
      )}
      <div className="practice-grade-actions">
        <button className="success" disabled={disabled} onClick={onCorrect}><Check size={18} /> 答對</button>
        <button className="danger-button" disabled={disabled} onClick={onWrong}><X size={18} /> 答錯</button>
      </div>
      {(learnedError || unfamiliarError) && <small className="form-error">{learnedError || unfamiliarError}</small>}
    </div>
  );
}

