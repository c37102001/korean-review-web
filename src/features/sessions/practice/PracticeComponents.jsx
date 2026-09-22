import React from 'react';
import { Check, RotateCcw } from 'lucide-react';

import { KoreanSpeakButton } from '../../../components/actions/ContentActionButtons.jsx';
import { TextSpeakButton } from '../../../components/actions/TextSpeakButton.jsx';
import { speakText } from '../../../audio/speech.js';
import { wordSpeechText } from '../../../words/speech.js';
import { NOTE_CATEGORY_GRAMMAR, NOTE_CATEGORY_VOCABULARY } from '../../../notes/model.js';
import { WordDetailCard } from '../../word-library/components/WordPresentation.jsx';

export function QuestionKindBadge({ kind, category = NOTE_CATEGORY_GRAMMAR }) {
  const isGrammarExample = kind === 'grammar-example';
  const isExample = kind === 'example' || isGrammarExample;
  const noteExampleLabel = category === NOTE_CATEGORY_VOCABULARY ? '單字筆記例句' : '文法例句';
  return <small className={`question-kind-badge ${isExample ? 'example' : 'term'}`}>{isGrammarExample ? noteExampleLabel : isExample ? '例句' : '單字'}</small>;
}


export function PracticeMistakeReview({ questions = [], onRetry = null }) {
  return (
    <section className="practice-mistake-review" aria-label="錯誤題目檢討">
      <div className="practice-mistake-review-head">
        <div>
          <span className="eyebrow">Review</span>
          <h2>錯誤單字檢討</h2>
        </div>
        <div className="practice-mistake-review-actions">
          <strong>{questions.length} 個</strong>
          {onRetry && (
            <button type="button" className="primary small" onClick={onRetry}>
              <RotateCcw size={16} /> 重測錯題
            </button>
          )}
        </div>
      </div>
      {questions.length ? (
        <div className="practice-mistake-grid">
          {questions.map((question) => {
            const grammarExample = question.kind === 'grammar-example';
            const korean = grammarExample ? question.ko : question.source?.ko || question.ko;
            const chinese = grammarExample ? question.zh : question.source?.zh || question.zh;
            return (
              <article className="practice-mistake-card" key={question.id}>
                <div className="practice-mistake-word">
                  <h3>{korean}</h3>
                  <KoreanSpeakButton text={grammarExample ? korean : wordSpeechText(question.source || question)} onSpeak={speakText} />
                </div>
                <p>{chinese}</p>
                {question.kind === 'example' && question.ko !== korean && (
                  <small><strong>{question.ko}</strong><span>{question.zh}</span></small>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="practice-no-mistakes"><Check size={20} /> 這次沒有答錯的單字</div>
      )}
    </section>
  );
}

export function PracticeAnswerPanel({ question, visible, graded, correct, isStarred = false, onToggleStar, onEdit }) {
  return (
    <aside className={`practice-answer-panel ${visible ? 'visible' : ''}`}>
      <div className="answer-panel-inner">
        {!visible ? (
          <div className="answer-placeholder">
            <span>答案卡片</span>
            <strong>{question.kind === 'grammar-example' ? '答題後會顯示筆記與完整例句' : '答題後會顯示完整單字卡'}</strong>
          </div>
        ) : (
          <>
            <div className="answer-review-head">
              <span>{graded ? (correct ? '答對' : '答錯') : '公布答案'}</span>
              {(question.kind === 'example' || question.kind === 'grammar-example') && <strong>{question.kind === 'grammar-example' ? question.source.title : '例句來自這張卡片'}</strong>}
              {graded && <small>再按 Enter 進入下一題</small>}
            </div>
            <div className="answer-card-stage">
              {question.kind === 'grammar-example' ? (
                <div className="grammar-practice-answer">
                  <h3>{question.source.title}</h3>
                  {question.source.notes && <p>{question.source.notes}</p>}
                  <div className="grammar-example">
                    <p className="grammar-example-ko"><span>{question.ko}</span><TextSpeakButton text={question.ko} lang="ko-KR" label="播放韓文例句" /></p>
                    <p className="grammar-example-zh"><span>{question.zh}</span><TextSpeakButton text={question.zh} lang="zh-TW" label="播放中文翻譯" /></p>
                  </div>
                </div>
              ) : (
                <WordDetailCard
                  word={question.source}
                  onSpeak={speakText}
                  isStarred={isStarred}
                  onToggleStar={onToggleStar}
                  onEdit={onEdit}
                />
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

export function CorrectFireworks() {
  return (
    <div className="answer-inline-celebration" aria-label="答對了">
      <span aria-hidden="true">🎉</span>
      <strong>答對！</strong>
    </div>
  );
}

export function DiffResult({ result }) {
  if (result.isCorrect) return null;

  return (
    <div className="diff-box wrong-shake" role="status">
      <div className="wrong-feedback"><span aria-hidden="true">✕</span><strong>答錯了</strong></div>
      <div className="diff-line">
        {result.parts.map((part, index) => {
          if (part.type === 'missing') return <span className="missing" key={index}>□</span>;
          if (part.type === 'missing-space') return <span className="missing-space" key={index}>_</span>;
          if (part.type === 'extra-space') return <span className="bad space" key={index}>␠</span>;
          if (part.type === 'extra') return <span className="bad" key={index}>{part.text}</span>;
          if (part.type === 'replace') return <span className="bad replace" key={index} title={`應改成 ${part.expected}`}>{part.text === ' ' ? '␠' : part.text}</span>;
          return <span key={index}>{part.text}</span>;
        })}
      </div>
    </div>
  );
}
