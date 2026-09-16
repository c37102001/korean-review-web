import React from 'react';
import {
  Check, ChevronRight, RotateCcw, Shuffle, Star, Trophy, Volume2, VolumeX, X,
} from 'lucide-react';

import { countKoreanLetters, toggleStarredItem } from '../../../review-engine/index.js';
import { PracticeDecisionBar, WordFolderButtons } from '../shared/ClassificationActions.jsx';
import { SessionWordEditDialog } from '../shared/SessionWordDetails.jsx';
import {
  CorrectFireworks,
  DiffResult,
  PracticeAnswerPanel,
  PracticeMistakeReview,
  QuestionKindBadge,
} from './PracticeComponents.jsx';

export function PracticeSetup({
  session, direction, setDirection, answerMode, setAnswerMode, source, setSource,
  starredOnly, setStarredOnly, randomOrder, setRandomOrder, recordResults,
  setRecordResults, shouldRecordResults, sourceQuestions, activeDirection,
  selfGradeMode, onStart,
}) {
  const {
    dailyWordMode, grammarPracticeMode, fixedSource, canChooseResultRecording,
    noteLabel, label, orderPolicy,
  } = session;
  return (
    <section className="page practice-start">
      <div className="panel start-panel">
        <span className="eyebrow">Test · {label}</span>
        <h1>{dailyWordMode ? '選擇每日單字測驗方式' : '選擇測驗方式'}</h1>
        <div className="segmented">
          <button className={direction === 'zh-ko' ? 'active' : ''} onClick={() => setDirection('zh-ko')}>中翻韓</button>
          <button className={direction === 'ko-zh' ? 'active' : ''} onClick={() => setDirection('ko-zh')}>韓翻中</button>
        </div>
        {direction === 'zh-ko' && <div className="segmented compact">
          <button className={answerMode === 'typing' ? 'active' : ''} onClick={() => setAnswerMode('typing')}>打字輸入</button>
          <button className={answerMode === 'self-grade' ? 'active' : ''} onClick={() => setAnswerMode('self-grade')}>心中作答</button>
        </div>}
        {fixedSource ? (
          <div className="fixed-source-note">{grammarPracticeMode ? `此練習包含所選${noteLabel}的全部例句。` : '此測驗只包含單字題。'}</div>
        ) : direction === 'ko-zh' ? (
          <div className="fixed-source-note">韓翻中只測驗單字，公佈答案後自行評分。</div>
        ) : (
          <div className="segmented">
            <button className={source === 'term' ? 'active' : ''} onClick={() => setSource('term')}>單字 / 片語</button>
            <button className={source === 'example' ? 'active' : ''} onClick={() => setSource('example')}>例句</button>
            <button className={source === 'all' ? 'active' : ''} onClick={() => setSource('all')}>全部</button>
          </div>
        )}
        {!dailyWordMode && !grammarPracticeMode && <div className="segmented compact">
          <button className={!starredOnly ? 'active' : ''} onClick={() => setStarredOnly(false)}>全部卡片</button>
          <button className={starredOnly ? 'active' : ''} onClick={() => setStarredOnly(true)}><Star size={16} /> 有星號</button>
        </div>}
        {!dailyWordMode && <div className="segmented compact">
          <button className={!randomOrder ? 'active' : ''} onClick={() => setRandomOrder(false)}>{orderPolicy === 'alphabetical-option' ? '韓文字母順序' : '依原順序'}</button>
          <button className={randomOrder ? 'active' : ''} onClick={() => setRandomOrder(true)}><Shuffle size={16} /> 隨機順序</button>
        </div>}
        {canChooseResultRecording && <div className="segmented compact">
          <button className={!recordResults ? 'active' : ''} onClick={() => setRecordResults(false)}>不紀錄結果</button>
          <button className={recordResults ? 'active' : ''} onClick={() => setRecordResults(true)}>紀錄答對答錯</button>
        </div>}
        {!dailyWordMode && (
          <div className="fixed-source-note muted-note">
            {shouldRecordResults
              ? '本次測驗會更新熟悉分數、作答紀錄與間隔排程。'
              : '本次測驗不會改變熟悉分數、作答紀錄或間隔排程。'}
          </div>
        )}
        <p>
          {sourceQuestions.length} 題可測驗。
          {activeDirection === 'zh-ko' && !selfGradeMode
            ? '請看中文提示輸入韓文答案。'
            : activeDirection === 'zh-ko'
              ? '請先看中文回想韓文，公佈答案後自行選擇答對或答錯。'
              : '請先看韓文回想中文，公佈答案後自行選擇答對或答錯。'}
        </p>
        <button className="primary wide" disabled={!sourceQuestions.length} onClick={onStart}>開始</button>
      </div>
    </section>
  );
}

export function PracticeComplete({
  label, questionCount, mistakeQuestions, onRetry, canRepeat, onRepeat,
  saving, error, onRetrySave,
}) {
  return (
    <section className="page practice-start">
      <div className="panel start-panel practice-complete-panel">
        <Trophy size={34} aria-hidden="true" />
        <span className="eyebrow">Test complete</span>
        <h1>{`${label} 已完成`}</h1>
        <p>這一組的 {questionCount} 題已全部作答。</p>
        <PracticeMistakeReview questions={mistakeQuestions} onRetry={onRetry} />
        {canRepeat && (
          <button className="primary wide" onClick={onRepeat}><RotateCcw size={18} /> 再練一次</button>
        )}
        {saving && <p>正在儲存今日文法進度...</p>}
        {error && (
          <>
            <div className="form-error">{error}</div>
            <button className="primary" onClick={onRetrySave}>重新儲存進度</button>
          </>
        )}
      </div>
    </section>
  );
}

export function EmptyPractice({ label }) {
  return (
    <section className="page practice-start">
      <div className="panel start-panel">
        <span className="eyebrow">Test · {label}</span>
        <h1>目前沒有待測驗題目</h1>
        <p>到期單字都已經清完，今天的測驗任務已完成。</p>
      </div>
    </section>
  );
}

export function PracticeRunner({ session, state, actions, classification, editor }) {
  const {
    question, displayQuestion, index, queueLength, input, result, revealed, graded,
    lastCorrect, soundEnabled, autoPronounce, chinesePronunciation, answerSpeechError,
    completionError, optionalSaving, recognitionWordVisible, selfGradeMode,
    canClassifyCurrentWord, isCurrentWordLearned, isCurrentWordUnfamiliar,
  } = state;
  const {
    grammarMode, grammarPracticeMode, recognitionMode, dailyWordMode,
    activeDirection, noteLabel,
  } = session;
  return (
    <>
      <section className="page practice-page">
        <div className="practice-layout">
          <div className="practice-shell">
            <div className="progress-line"><span style={{ width: `${((index + 1) / queueLength) * 100}%` }} /></div>
            <div className="quiz-meta quiz-meta-row">
              <span>{index + 1} / {queueLength} · {grammarMode ? '文法例句聽力' : grammarPracticeMode ? `${noteLabel}例句練習` : recognitionMode ? '單字例句聽力' : activeDirection === 'zh-ko' ? '中翻韓' : '韓翻中'}</span>
              <div className="quiz-options">
                <button className={soundEnabled ? 'selected-soft' : ''} onClick={actions.toggleSound}>{soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />} 音效</button>
                {!recognitionMode && !grammarMode && <button className={autoPronounce ? 'selected-soft' : ''} onClick={actions.toggleAutoPronounce}>{autoPronounce ? <Volume2 size={16} /> : <VolumeX size={16} />} 自動發音</button>}
                {dailyWordMode && <button className={chinesePronunciation ? 'selected-soft' : ''} aria-pressed={chinesePronunciation} onClick={actions.toggleChinesePronunciation}>{chinesePronunciation ? <Volume2 size={16} /> : <VolumeX size={16} />} 中文發音</button>}
                <button disabled={!recognitionMode && !grammarMode && activeDirection !== 'ko-zh' && !revealed && !graded} onClick={actions.replaySpeech}><Volume2 size={16} /> {recognitionMode || grammarMode || activeDirection === 'ko-zh' ? '重播' : '發音'}</button>
              </div>
            </div>
            {optionalSaving && <p role="status">儲存練習進度中…</p>}
            {answerSpeechError && <p className="form-error" role="alert">{answerSpeechError}</p>}
            {completionError && <p className="form-error" role="alert">{completionError}</p>}
            {!selfGradeMode ? (
              <>
                <div className="prompt">
                  <span>請輸入韓文</span>
                  <div className="prompt-title"><h1>{question.zh}</h1><QuestionKindBadge kind={question.kind} category={question.source?.category} /></div>
                  <small className="answer-length-hint">答案 {countKoreanLetters(question.ko)} 個韓文字</small>
                </div>
                <div className="typed-answer-area">
                  <textarea
                    key={question.id}
                    value={input}
                    onChange={(event) => actions.setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        actions.confirm();
                      }
                    }}
                    placeholder="여기에 한국어를 입력하세요 (Enter 送出)"
                    autoFocus
                    disabled={graded}
                  />
                  <span className="input-korean-count">{countKoreanLetters(input)}</span>
                  <div className="actions answer-actions">
                    {!graded && !revealed ? (
                      <><button className="primary" onClick={actions.confirm}><Check size={18} /> 確認</button><button onClick={actions.revealWrong}><RotateCcw size={18} /> 公佈答案</button></>
                    ) : graded && <>{lastCorrect ? <CorrectFireworks /> : <span className="answer-inline-wrong"><X size={16} /> 答錯</span>}<button className="primary" onClick={actions.next}><ChevronRight size={18} /> 下一題</button></>}
                  </div>
                  {graded && canClassifyCurrentWord && (
                    <div className="typed-folder-actions">
                      <WordFolderButtons compact isLearned={isCurrentWordLearned} isUnfamiliar={isCurrentWordUnfamiliar} learnedSaving={classification.saving === 'learned'} unfamiliarSaving={classification.saving === 'unfamiliar'} onMarkLearned={actions.markLearned} onMarkUnfamiliar={actions.markUnfamiliar} />
                      {classification.errors.learned && <small className="form-error">{classification.errors.learned}</small>}
                      {classification.errors.unfamiliar && <small className="form-error">{classification.errors.unfamiliar}</small>}
                    </div>
                  )}
                </div>
                {result && <DiffResult result={result} />}
              </>
            ) : (
              <>
                {(recognitionMode || grammarMode) && !recognitionWordVisible ? (
                  <div className="prompt ko recognition-listening-prompt"><Volume2 size={42} aria-hidden="true" /><span>{grammarMode ? '請聆聽文法例句' : '請聆聽單字例句'}</span><small>需要時可按右上方「重播」再次播放</small></div>
                ) : (
                  <div className="prompt ko"><span>{grammarMode || activeDirection === 'zh-ko' ? '請在心中想韓文答案' : '請在心中想中文意思'}</span><div className="prompt-title"><h1>{grammarMode || activeDirection === 'zh-ko' ? question.zh : question.ko}</h1><QuestionKindBadge kind={question.kind} category={question.source?.category} /></div></div>
                )}
                {!revealed ? (
                  <button className="primary wide" onClick={actions.advanceStage}>{!recognitionWordVisible && grammarMode ? '顯示中文' : '公佈答案'}</button>
                ) : (
                  <PracticeDecisionBar disabled={optionalSaving} canClassify={canClassifyCurrentWord} isLearned={isCurrentWordLearned} isUnfamiliar={isCurrentWordUnfamiliar} learnedSaving={classification.saving === 'learned'} unfamiliarSaving={classification.saving === 'unfamiliar'} learnedError={classification.errors.learned} unfamiliarError={classification.errors.unfamiliar} onToggleLearned={actions.markLearned} onToggleUnfamiliar={actions.markUnfamiliar} onCorrect={() => actions.submit(true)} onWrong={() => actions.submit(false)} />
                )}
              </>
            )}
          </div>
          <PracticeAnswerPanel question={displayQuestion} visible={revealed || graded} graded={graded} correct={lastCorrect} isStarred={actions.isStarred} onToggleStar={actions.toggleStar} onEdit={editor.canEdit ? editor.open : null} />
        </div>
      </section>
      <SessionWordEditDialog item={editor.item} allItems={editor.allItems} folders={editor.folders} onUpdateRecord={editor.onUpdateRecord} onClose={editor.close} />
    </>
  );
}
