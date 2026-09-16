import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Eye, EyeOff, FolderInput, Pause, Play,
  RotateCcw, Shuffle, Star, Trophy, Volume2, VolumeX, X,
} from 'lucide-react';

import { EditIconButton, KoreanSpeakButton, StarButton } from '../../components/actions/ContentActionButtons.jsx';
import { TextSpeakButton } from '../../components/actions/TextSpeakButton.jsx';
import { speakText, speakTextAndWait } from '../../audio/speech.js';
import { noteCategoryMeta, NOTE_CATEGORY_GRAMMAR, NOTE_CATEGORY_VOCABULARY } from '../../notes/model.js';
import {
  compareAnswer,
  countKoreanLetters,
  getStats,
  nextRecognitionRevealState,
  recordAnswer,
  recordDailyRecognitionAnswer,
  recordDailyReviewAnswer,
  recordDailyWrongReviewAnswer,
  toggleStarredItem,
} from '../../review-engine/index.js';
import { AddItemsModal } from '../word-import/components/WordImportForm.jsx';
import { WordDetailCard, WordDetails } from '../word-library/components/WordPresentation.jsx';
import { useWordClassification } from './core/useWordClassification.js';
import { useSessionWakeLock } from './core/useSessionWakeLock.js';
import {
  activePracticeDirection,
  buildPracticeQueue,
  initialPracticeDirection,
  isSelfGradeAnswerMode,
  practiceMistakeReviewQuestions,
  practiceResultEffect,
  practiceSessionView,
  shouldAutoPronouncePracticePrompt,
  shouldRecordPracticeResults,
} from './practice/model.js';
import {
  buildStudyAutoPlaySpeechSequence,
  shouldShowStudyChinese,
  studyCardDoubleTapAction,
} from './study/model.js';

function waitFor(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function speakAnswer(question) {
  speakText(question?.ko, 'ko-KR');
}

function practiceAnswerSpeech(question, useChinese = false) {
  return useChinese
    ? { text: question?.zh || '', lang: 'zh-TW' }
    : { text: question?.ko || '', lang: 'ko-KR' };
}

function ItemDetailModal({ item, allItems = [], onEdit, onDelete, onOpenItem, onClose, isStarred = false, onToggleStar }) {
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
          onSpeak={speakText}
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

function SessionWordEditDialog({ item, allItems, folders, onUpdateRecord, onClose }) {
  if (!item || !onUpdateRecord) return null;
  return (
    <AddItemsModal
      title="編輯單字"
      date={item.date}
      lockedDate
      editItem={item}
      allItems={allItems}
      folders={folders}
      onUpdateRecord={onUpdateRecord}
      onClose={onClose}
    />
  );
}

export function StudyPage({ store, updateStore, set, allItems = [], folders = [], onUpdateRecord, onBack, learnedWordIds = new Set(), unfamiliarWordIds = new Set(), onToggleLearned, onToggleUnfamiliar }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [filter, setFilter] = useState('全部');
  const [frontSide, setFrontSide] = useState('ko');
  const [random, setRandom] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(Date.now());
  const [autoPlay, setAutoPlay] = useState(false);
  const [playVoice, setPlayVoice] = useState(true);
  const [playExampleVoice, setPlayExampleVoice] = useState(true);
  const [voiceRepeatCount, setVoiceRepeatCount] = useState(1);
  const [hideChineseInitially, setHideChineseInitially] = useState(true);
  const [cardChineseRevealed, setCardChineseRevealed] = useState(false);
  const [autoPlayCycle, setAutoPlayCycle] = useState(0);
  const [starredOnly, setStarredOnly] = useState(false);
  const [instantReset, setInstantReset] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const classification = useWordClassification({
    learnedWordIds,
    unfamiliarWordIds,
    onToggleLearned,
    onToggleUnfamiliar,
  });
  const flashcardWrapRef = useRef(null);
  const cardPointerRef = useRef({ start: null, lastTap: null });
  const ignoreTouchClickUntilRef = useRef(0);
  const currentItems = useMemo(() => {
    const latestById = new Map(allItems.map((entry) => [entry.id, entry]));
    return set.items.map((entry) => latestById.get(entry.id) || entry);
  }, [set.items, allItems]);
  const types = ['全部', ...new Set(currentItems.map((item) => item.pos || '未分類'))];
  const filtered = useMemo(() => {
    const starredSet = new Set(store.starred || []);
    return currentItems
      .filter((item) => filter === '全部' || item.pos === filter)
      .filter((item) => !starredOnly || starredSet.has(item.id));
  }, [currentItems, filter, store.starred, starredOnly]);
  const ordered = useMemo(() => (random ? shuffleItems(filtered, shuffleSeed) : filtered), [filtered, random, shuffleSeed]);
  const item = ordered[index % Math.max(ordered.length, 1)];
  const isStarred = !!item && (store.starred || []).includes(item.id);
  const isLearned = !!item && classification.isLearned(item.id);
  const isUnfamiliar = !!item && classification.isUnfamiliar(item.id);
  const showChinese = shouldShowStudyChinese(hideChineseInitially, cardChineseRevealed);
  const frontShowsChinese = frontSide === 'zh' && showChinese;
  const frontText = frontShowsChinese ? item?.zh : item?.ko;
  const backText = frontSide === 'ko' ? item?.zh : item?.ko;
  const frontLang = frontShowsChinese ? 'zh-TW' : 'ko-KR';
  const backLang = frontSide === 'ko' ? 'zh-TW' : 'ko-KR';
  const visibleBackText = frontSide === 'ko' && !showChinese ? item?.ko : backText;
  const visibleBackLang = frontSide === 'ko' && !showChinese ? 'ko-KR' : backLang;
  const autoPlaySpeechSequence = useMemo(() => buildStudyAutoPlaySpeechSequence(item, {
    frontSide,
    hideChineseInitially,
    playExampleVoice,
    voiceRepeatCount,
  }), [item, frontSide, hideChineseInitially, playExampleVoice, voiceRepeatCount]);
  useSessionWakeLock(autoPlay);
  const toggleCard = () => {
    const next = !flipped;
    setFlipped(next);
    if (playVoice) speakText(next ? visibleBackText : frontText, next ? visibleBackLang : frontLang);
  };
  const moveToIndex = (nextIndex) => {
    if (flipped) {
      setInstantReset(true);
      window.requestAnimationFrame(() => setInstantReset(false));
    }
    setFlipped(false);
    setCardChineseRevealed(false);
    classification.clearErrors();
    setIndex(nextIndex);
  };
  const goPrev = () => {
    moveToIndex((index - 1 + ordered.length) % ordered.length);
  };
  const goNext = () => {
    moveToIndex((index + 1) % ordered.length);
  };
  const handleCardPointerDown = (event) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    ignoreTouchClickUntilRef.current = Date.now() + 700;
    const navBottom = document.querySelector('.sidebar')?.getBoundingClientRect().bottom || 0;
    const mobileCardGap = Number.parseFloat(
      window.getComputedStyle(document.querySelector('.app')).getPropertyValue('--mobile-card-edge-gap'),
    ) || 0;
    const alignedTop = navBottom + mobileCardGap;
    const cardTop = flashcardWrapRef.current?.getBoundingClientRect().top;
    cardPointerRef.current.start = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      aligned: Number.isFinite(cardTop) && Math.abs(cardTop - alignedTop) <= 28,
    };
  };
  const stabilizeAlignedCard = () => {
    window.requestAnimationFrame(() => {
      const cardTop = flashcardWrapRef.current?.getBoundingClientRect().top;
      if (!Number.isFinite(cardTop)) return;
      const navBottom = document.querySelector('.sidebar')?.getBoundingClientRect().bottom || 0;
      const mobileCardGap = Number.parseFloat(
        window.getComputedStyle(document.querySelector('.app')).getPropertyValue('--mobile-card-edge-gap'),
      ) || 0;
      const adjustment = cardTop - navBottom - mobileCardGap;
      if (Math.abs(adjustment) > 1 && Math.abs(adjustment) < 80) {
        window.scrollBy({ top: adjustment, behavior: 'smooth' });
      }
    });
  };
  const handleCardPointerUp = (event) => {
    const start = cardPointerRef.current.start;
    cardPointerRef.current.start = null;
    if (event.pointerType !== 'touch' || !event.isPrimary || !start || start.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (start.aligned && moved <= 24) stabilizeAlignedCard();
    if (moved > 14) {
      cardPointerRef.current.lastTap = null;
      return;
    }
    const interactive = event.target instanceof Element
      ? event.target.closest('button, a, input, textarea, select, [contenteditable="true"]')
      : null;
    if (interactive) {
      cardPointerRef.current.lastTap = null;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const action = studyCardDoubleTapAction(event.clientX, rect.left, rect.width);
    const now = Date.now();
    const lastTap = cardPointerRef.current.lastTap;
    if (!action || !lastTap || lastTap.action !== action || now - lastTap.time > 380) {
      cardPointerRef.current.lastTap = { action, time: now };
      return;
    }
    cardPointerRef.current.lastTap = null;
    setAutoPlay(false);
    if (action === 'next') goNext();
    else if (action === 'previous') goPrev();
    else toggleCard();
  };
  const jumpToItem = (targetItem) => {
    const targetIndex = currentItems.findIndex((entry) => entry.id === targetItem.id);
    if (targetIndex < 0) return;
    setAutoPlay(false);
    setRandom(false);
    setFilter('全部');
    setIndex(targetIndex);
    setFlipped(true);
  };
  useLayoutEffect(() => {
    setFlipped(false);
    setCardChineseRevealed(false);
  }, [item?.id]);

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
    setCardChineseRevealed(false);
  }, [filter, random, shuffleSeed, frontSide, starredOnly]);

  useEffect(() => {
    if (autoPlay || !playVoice || !item) return;
    speakText(frontText, frontLang);
  }, [autoPlay, playVoice, item?.id, frontSide]);

  useEffect(() => {
    if (!autoPlay || !item) return undefined;
    let cancelled = false;
    window.speechSynthesis?.cancel();
    setFlipped(false);
    let flipTimer;
    let nextTimer;
    if (playVoice) {
      const playSequence = async () => {
        for (const part of autoPlaySpeechSequence) {
          if (cancelled) return;
          setFlipped(part.face === 'back');
          await waitFor(220);
          if (cancelled) return;
          await speakTextAndWait(part.text, part.lang);
          if (cancelled) return;
          await waitFor(260);
        }
        if (cancelled) return;
        await waitFor(450);
        if (!cancelled) {
          setCardChineseRevealed(false);
          setIndex((current) => (current + 1) % ordered.length);
          setAutoPlayCycle((current) => current + 1);
          setFlipped(false);
        }
      };
      playSequence();
    } else {
      flipTimer = window.setTimeout(() => setFlipped(true), 1800);
      nextTimer = window.setTimeout(() => {
        setCardChineseRevealed(false);
        setIndex((current) => (current + 1) % ordered.length);
        setAutoPlayCycle((current) => current + 1);
        setFlipped(false);
      }, 3900);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(flipTimer);
      window.clearTimeout(nextTimer);
      window.speechSynthesis?.cancel();
    };
  }, [autoPlay, item?.id, index, playVoice, autoPlaySpeechSequence, ordered.length, autoPlayCycle]);

  useEffect(() => {
    if (!item) return undefined;
    const onKeyDown = (event) => {
      const target = event.target;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
      if (isTyping || event.isComposing || editingItem || event.defaultPrevented) return;
      if (event.key === ' ') {
        event.preventDefault();
        if (!event.repeat && hideChineseInitially && (flipped ? frontSide === 'ko' : frontSide === 'zh')) {
          setCardChineseRevealed((current) => !current);
        }
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setAutoPlay(false);
        goPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setAutoPlay(false);
        goNext();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setAutoPlay(false);
        toggleCard();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item?.id, autoPlay, flipped, playVoice, frontSide, showChinese, hideChineseInitially, editingItem, index, ordered.length]);

  if (!filtered.length) return <section className="page"><div className="empty">沒有可學習的卡片。</div></section>;
  return (
    <section className="page study-page">
      <div className="topbar study-topbar">
        <div><span className="eyebrow">Flashcards · {set.label}</span></div>
        <select value={filter} onChange={(e) => { setFilter(e.target.value); setIndex(0); }}>{types.map((type) => <option key={type}>{type}</option>)}</select>
      </div>
      <div className="study-toolstrip">
        <button className={frontSide === 'ko' ? 'selected-soft' : ''} onClick={() => setFrontSide('ko')}>韓文正面</button>
        <button className={frontSide === 'zh' ? 'selected-soft' : ''} onClick={() => setFrontSide('zh')}>中文正面</button>
        <button className={random ? 'selected-soft' : ''} onClick={() => { setRandom(!random); setShuffleSeed(Date.now()); }}><Shuffle size={16} /> 隨機</button>
        <button title="自動播放期間保持螢幕開啟" className={autoPlay ? 'selected-soft' : ''} onClick={() => setAutoPlay(!autoPlay)}>{autoPlay ? <Pause size={16} /> : <Play size={16} />} 自動</button>
        <button className={playVoice ? 'selected-soft' : ''} onClick={() => setPlayVoice(!playVoice)}>{playVoice ? <Volume2 size={16} /> : <VolumeX size={16} />} 語音</button>
        <button disabled={!playVoice} className={playExampleVoice && playVoice ? 'selected-soft' : ''} onClick={() => setPlayExampleVoice((current) => !current)}><Volume2 size={16} /> 例句語音</button>
        <button
          className={!hideChineseInitially ? 'selected-soft' : ''}
          aria-pressed={!hideChineseInitially}
          onClick={() => {
            setHideChineseInitially((current) => !current);
            setCardChineseRevealed(false);
          }}
        >
          {hideChineseInitially ? <EyeOff size={16} /> : <Eye size={16} />}
          {hideChineseInitially ? '每張先隱藏中文' : '每張顯示中文'}
        </button>
        <label className="study-repeat-control" title="每張卡片完整播放幾次">
          <RotateCcw size={15} />
          <span>每張完整播放</span>
          <select value={voiceRepeatCount} disabled={!playVoice} onChange={(event) => setVoiceRepeatCount(Number(event.target.value))}>
            {[1, 2, 3].map((count) => <option key={count} value={count}>{count} 次</option>)}
          </select>
        </label>
        <button className={starredOnly ? 'selected-soft' : ''} onClick={() => setStarredOnly((current) => !current)}><Star size={16} /> 有星號</button>
        {onBack && <button className="study-back-button" onClick={onBack}><ChevronLeft size={18} /> 返回上一層</button>}
      </div>
      {(classification.errors.learned || classification.errors.unfamiliar) && <div className="form-error study-folder-error">{classification.errors.learned || classification.errors.unfamiliar}</div>}
      <div className="flashcard-wrap" ref={flashcardWrapRef}>
        <button className="card-arrow left" onClick={goPrev} aria-label="上一張"><ChevronLeft size={26} /></button>
        <div className={`flashcard ${flipped ? 'flipped' : ''} ${instantReset ? 'instant-reset' : ''}`} role="button" tabIndex={0}
          onClick={() => { if (Date.now() > ignoreTouchClickUntilRef.current) toggleCard(); }}
          onPointerDown={handleCardPointerDown}
          onPointerUp={handleCardPointerUp}
          onPointerCancel={() => { cardPointerRef.current.start = null; cardPointerRef.current.lastTap = null; }}
          onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === 'Enter') { e.preventDefault(); toggleCard(); } }}
        >
          <div className="study-folder-actions" onClick={(event) => event.stopPropagation()}>
            <WordFolderButtons
              compact
              isLearned={isLearned}
              isUnfamiliar={isUnfamiliar}
              learnedSaving={classification.saving === 'learned'}
              unfamiliarSaving={classification.saving === 'unfamiliar'}
              onMarkLearned={() => classification.toggleLearned(item.id)}
              onMarkUnfamiliar={() => classification.toggleUnfamiliar(item.id)}
            />
          </div>
          <div className="flashcard-star">
            <StarButton active={isStarred} onClick={() => toggleStarredItem(updateStore, item.id)} />
            {onUpdateRecord && <EditIconButton onClick={() => setEditingItem(item)} />}
          </div>
          <div className="flash-face front">
            <span>{index + 1} / {ordered.length}</span>
            <div className="study-pronunciation-row"><strong>{item.ko}</strong><TextSpeakButton text={item.ko} lang="ko-KR" label="播放韓文單字" /></div>
            {frontShowsChinese && <div className="study-pronunciation-row"><span className="flashcard-translation">{item.zh}</span><TextSpeakButton text={item.zh} lang="zh-TW" label="播放中文意思" /></div>}
            {frontSide === 'zh' && hideChineseInitially && (
              <button
                className="card-chinese-toggle"
                aria-pressed={showChinese}
                onClick={(event) => { event.stopPropagation(); setCardChineseRevealed((current) => !current); }}
              >
                {showChinese ? <EyeOff size={16} /> : <Eye size={16} />} {showChinese ? '隱藏中文' : '顯示中文'}
              </button>
            )}
            <small>{frontShowsChinese ? '點擊看韓文' : showChinese ? item.pos || '未分類' : '點擊查看韓文例句'}</small>
          </div>
          <div className="flash-face back">
            <div className="flash-back-content" onClick={(event) => event.stopPropagation()}>
              <div className="flash-back-answer">
                <div className="flash-back-answer-copy">
                  <div className="study-pronunciation-row"><strong>{item.ko}</strong><TextSpeakButton text={item.ko} lang="ko-KR" label="播放韓文單字" /></div>
                  {frontSide === 'ko' && showChinese && <div className="study-pronunciation-row"><span>{item.zh}</span><TextSpeakButton text={item.zh} lang="zh-TW" label="播放中文意思" /></div>}
                  {frontSide === 'ko' && hideChineseInitially && (
                    <button
                      className="card-chinese-toggle"
                      aria-pressed={showChinese}
                      onClick={(event) => { event.stopPropagation(); setCardChineseRevealed((current) => !current); }}
                    >
                      {showChinese ? <EyeOff size={16} /> : <Eye size={16} />} {showChinese ? '隱藏中文' : '顯示中文'}
                    </button>
                  )}
                </div>
              </div>
              <div className="study-details">
                <WordDetails
                  word={item}
                  allWords={currentItems}
                  onOpenWord={jumpToItem}
                  onSpeak={speakText}
                  showChinese={showChinese}
                  emptyMessage="這張卡片沒有韓文例句。"
                />
              </div>
            </div>
          </div>
        </div>
        <button className="card-arrow right" onClick={goNext} aria-label="下一張"><ChevronRight size={26} /></button>
      </div>
      <SessionWordEditDialog
        item={editingItem}
        allItems={allItems}
        folders={folders}
        onUpdateRecord={onUpdateRecord}
        onClose={() => setEditingItem(null)}
      />
    </section>
  );
}

export function PracticePage({ store, updateStore, set, allItems = [], folders = [], onUpdateRecord, learnedWordIds = new Set(), unfamiliarWordIds = new Set(), onToggleLearned, onToggleUnfamiliar }) {
  const sessionView = practiceSessionView(set);
  const {
    optionalMode,
    readingMode,
    recognitionMode,
    grammarMode,
    grammarPracticeMode,
    dailyWordMode,
    wrongReviewMode,
    configurableWordMode,
    fixedSource,
    canChooseResultRecording,
    canRetryMistakes,
    canRepeatSession,
    startsImmediately,
  } = sessionView;
  const [direction, setDirection] = useState(() => initialPracticeDirection(set));
  const [source, setSource] = useState('term');
  const [starredOnly, setStarredOnly] = useState(false);
  const [randomOrder, setRandomOrder] = useState(true);
  const [recordResults, setRecordResults] = useState(false);
  const [answerMode, setAnswerMode] = useState(set.policy?.answer === 'self-grade' ? 'self-grade' : 'typing');
  const practiceNoteMeta = noteCategoryMeta(set.noteCategory || NOTE_CATEGORY_GRAMMAR);
  const activeDirection = activePracticeDirection(set, direction);
  const shouldRecordResults = shouldRecordPracticeResults(set, recordResults);
  const selfGradeMode = isSelfGradeAnswerMode(activeDirection, answerMode);
  const [recognitionWordVisible, setRecognitionWordVisible] = useState(false);
  const [started, setStarted] = useState(startsImmediately);
  const [questionQueue, setQuestionQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState(false);
  const [lastCorrect, setLastCorrect] = useState(null);
  const [typedAttempts, setTypedAttempts] = useState(0);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [wrongQuestionIds, setWrongQuestionIds] = useState([]);
  const wrongQuestionIdsRef = useRef(new Set());
  const [mistakeRetryRound, setMistakeRetryRound] = useState(false);
  const [completionError, setCompletionError] = useState('');
  const [completionSaving, setCompletionSaving] = useState(false);
  const classification = useWordClassification({
    learnedWordIds,
    unfamiliarWordIds,
    onToggleLearned,
    onToggleUnfamiliar,
  });
  const completionStartedRef = useRef(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoPronounce, setAutoPronounce] = useState(!readingMode);
  const [chinesePronunciation, setChinesePronunciation] = useState(true);
  const [answerSpeechError, setAnswerSpeechError] = useState('');
  const [optionalSaving, setOptionalSaving] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const optionalSavingRef = useRef(false);
  const clearSessionMistakes = () => {
    wrongQuestionIdsRef.current = new Set();
    setWrongQuestionIds([]);
  };
  const rememberSessionResult = (targetQuestion, correct) => {
    if (correct || !targetQuestion?.id) return;
    const next = new Set(wrongQuestionIdsRef.current);
    next.add(targetQuestion.id);
    wrongQuestionIdsRef.current = next;
    setWrongQuestionIds([...next]);
  };
  const sourceQuestions = useMemo(() => selectPracticeQuestions(set, {
    direction,
    source,
    starredIds: store.starred || [],
    starredOnly,
  }), [set, source, direction, store.starred, starredOnly]);
  const queue = started ? questionQueue : sourceQuestions;
  const question = queue[index];
  const currentAnswerItem = useMemo(() => {
    if (!question || question.kind === 'grammar-example') return question?.source || null;
    return allItems.find((item) => item.id === question.itemId || item.id === question.source?.id) || question.source;
  }, [allItems, question]);
  const displayQuestion = useMemo(() => (
    question && currentAnswerItem && currentAnswerItem !== question.source
      ? { ...question, source: currentAnswerItem }
      : question
  ), [question, currentAnswerItem]);
  const useChineseAnswerSpeech = dailyWordMode && chinesePronunciation;
  const canClassifyCurrentWord = Boolean(question && !grammarMode && !grammarPracticeMode && question.kind !== 'grammar-example');
  const isCurrentWordLearned = Boolean(question && classification.isLearned(question.itemId));
  const isCurrentWordUnfamiliar = Boolean(question && classification.isUnfamiliar(question.itemId));
  const resetSession = () => {
    clearSessionMistakes();
    setSessionFinished(false);
    setMistakeRetryRound(false);
    setStarted(false);
    setQuestionQueue([]);
    setIndex(0);
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
    setTypedAttempts(0);
    classification.clearErrors();
    setRecognitionWordVisible(false);
    setCompletionError('');
    setCompletionSaving(false);
    completionStartedRef.current = false;
  };
  const startSession = () => {
    const nextQuestions = buildPracticeQueue(set, sourceQuestions, { randomOrder, seed: Date.now() });
    if (!nextQuestions.length) {
      resetSession();
      return;
    }
    setQuestionQueue(nextQuestions);
    clearSessionMistakes();
    setSessionFinished(false);
    setMistakeRetryRound(false);
    setStarted(true);
    setIndex(0);
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
    setTypedAttempts(0);
    classification.clearErrors();
    setRecognitionWordVisible(false);
  };
  const startMistakeRetry = (mistakeQuestions) => {
    if (!mistakeQuestions.length) return;
    const nextQuestions = randomOrder
      ? shuffleItems(mistakeQuestions, Date.now())
      : mistakeQuestions;
    setQuestionQueue(nextQuestions);
    clearSessionMistakes();
    setSessionFinished(false);
    setMistakeRetryRound(true);
    setStarted(true);
    setIndex(0);
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
    setTypedAttempts(0);
    setRecognitionWordVisible(false);
    setCompletionError('');
  };

  useEffect(() => {
    if (!startsImmediately) return;
    if (questionQueue.length) return;
    const nextQuestions = buildPracticeQueue(set, sourceQuestions, { randomOrder, seed: Date.now() });
    setQuestionQueue(nextQuestions);
    clearSessionMistakes();
    setStarted(!!nextQuestions.length);
    setIndex(0);
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
    setTypedAttempts(0);
    setRecognitionWordVisible(false);
  }, [set, startsImmediately, sourceQuestions, questionQueue.length, randomOrder]);

  useEffect(() => {
    if (!shouldAutoPronouncePracticePrompt({
      started,
      recognitionMode,
      grammarMode,
      activeDirection,
      autoPronounce,
      recognitionWordVisible,
      revealed,
      graded,
      question,
    })) return undefined;
    const timer = window.setTimeout(() => speakAnswer(question), 180);
    return () => window.clearTimeout(timer);
  }, [started, recognitionMode, grammarMode, activeDirection, autoPronounce, recognitionWordVisible, revealed, graded, question?.id]);

  useEffect(() => {
    if (direction === 'ko-zh') setSource('term');
  }, [direction]);

  const finishSession = () => {
    setSessionFinished(true);
    if (!set.onComplete || completionStartedRef.current) return;
    completionStartedRef.current = true;
    setCompletionSaving(true);
    setCompletionError('');
    Promise.resolve(set.onComplete())
      .catch((error) => {
        completionStartedRef.current = false;
        setCompletionError(error.message || '練習進度儲存失敗');
      })
      .finally(() => setCompletionSaving(false));
  };
  const markCurrentWordAsLearned = () => question && classification.toggleLearned(question.itemId);
  const markCurrentWordAsUnfamiliar = () => question && classification.toggleUnfamiliar(question.itemId);
  const goNext = () => {
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
    setTypedAttempts(0);
    setRecognitionWordVisible(false);
    classification.clearErrors();
    let nextIndex = index + 1;
    if (optionalMode && !grammarMode) {
      while (nextIndex < queue.length) {
        const itemId = queue[nextIndex].itemId;
        if (!classification.isLearned(itemId)) break;
        nextIndex += 1;
      }
    }
    if (nextIndex < queue.length) setIndex(nextIndex);
    else finishSession();
  };
  // Self-directed tests never alter long-term accuracy. Daily listening rounds
  // still update their dedicated rotation state in the recognition branch.
  const submit = async (correct) => {
    const effect = practiceResultEffect(set, { mistakeRetryRound, recordResults });
    if (effect === 'optional-pool') {
      if (optionalSavingRef.current) return;
      optionalSavingRef.current = true;
      setOptionalSaving(true);
      setCompletionError('');
      try {
        await set.onOptionalAnswer(question.id, correct);
        rememberSessionResult(question, correct);
        goNext();
      } catch (error) { setCompletionError(error.message || '練習進度儲存失敗，請重試'); }
      finally { optionalSavingRef.current = false; setOptionalSaving(false); }
      return;
    }
    if (effect === 'daily-wrong-review') {
      updateStore((current) => recordDailyWrongReviewAnswer(current, question, correct));
    } else if (effect === 'recognition-round') {
      updateStore((current) => recordDailyRecognitionAnswer(current, question, correct));
    } else if (effect === 'daily-review') {
      updateStore((current) => recordDailyReviewAnswer(current, question, correct, activeDirection));
    } else if (effect === 'record-answer') {
      updateStore((current) => recordAnswer(current, question, correct));
    }
    rememberSessionResult(question, correct);
    if (soundEnabled) playResultSound(correct);
    goNext();
  };
  // Used when 確認/Enter auto-grades a typed answer: records the result right
  // away (no manual 答對/答錯 choice) but keeps the question on screen so the
  // outcome is visible until the user presses Enter for the next one.
  const finalizeTypedGrade = (correct) => {
    const effect = practiceResultEffect(set, { mistakeRetryRound, recordResults, typed: true });
    if (effect === 'daily-wrong-review') {
      updateStore((current) => recordDailyWrongReviewAnswer(current, question, correct));
    } else if (effect === 'record-answer' || effect === 'daily-review') {
      updateStore((current) => recordAnswer(current, question, correct));
    }
    rememberSessionResult(question, correct);
    setGraded(true);
    setLastCorrect(correct);
    if (soundEnabled) playResultSound(correct);
    setAnswerSpeechError('');
    if (autoPronounce) speakPracticeAnswer(question, useChineseAnswerSpeech, setAnswerSpeechError);
  };
  const gradeAndRecord = (correct) => {
    finalizeTypedGrade(correct);
  };
  const handleConfirm = () => {
    if (graded || !input.trim()) return;
    const submittedInput = input.trim();
    setInput(submittedInput);
    const checkResult = compareAnswer(submittedInput, question.ko);
    setResult(checkResult);
    const nextAttempt = typedAttempts + 1;
    setTypedAttempts(nextAttempt);
    if (checkResult.isCorrect) {
      gradeAndRecord(true);
    } else if ((question.kind === 'example' || question.kind === 'grammar-example') && nextAttempt < 2) {
      setRevealed(false);
      if (soundEnabled) playResultSound(false);
    } else {
      setRevealed(true);
      gradeAndRecord(false);
    }
  };
  const revealTypedAnswerAsWrong = () => {
    if (graded) return;
    setInput((current) => current.trim());
    setRevealed(true);
    setResult(null);
    setTypedAttempts(2);
    gradeAndRecord(false);
  };
  const revealAnswerForSelfGrade = () => {
    setRevealed(true);
    setAnswerSpeechError('');
    if (autoPronounce) speakPracticeAnswer(question, useChineseAnswerSpeech, setAnswerSpeechError);
  };
  const replayCurrentSpeech = () => {
    const answerVisible = revealed || graded || recognitionWordVisible;
    setAnswerSpeechError('');
    if (answerVisible) speakPracticeAnswer(question, useChineseAnswerSpeech, setAnswerSpeechError);
    else speakAnswer(question);
  };
  const advanceRecognitionStage = () => {
    if (recognitionMode) {
      setRecognitionWordVisible(true);
      revealAnswerForSelfGrade();
      return;
    }
    const next = nextRecognitionRevealState(
      grammarMode,
      recognitionWordVisible,
      revealed,
    );
    setRecognitionWordVisible(next.wordVisible);
    if (next.revealed) revealAnswerForSelfGrade();
  };
  useEffect(() => {
    if (!started) return undefined;
    const onKeyDown = (event) => {
      if (editingItem) return;
      if (event.key === ' ' && (recognitionMode || grammarMode) && !event.isComposing) {
        event.preventDefault();
        replayCurrentSpeech();
        return;
      }
      if (event.key === ' ' && (revealed || graded) && !event.isComposing) {
        event.preventDefault();
        replayCurrentSpeech();
        return;
      }
      if (event.key === 'Enter' && graded && !event.isComposing) {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [started, revealed, graded, question, index, queue.length, recognitionMode, grammarMode, recognitionWordVisible, useChineseAnswerSpeech, editingItem]);

  if (!started && configurableWordMode) {
    return (
      <section className="page practice-start">
        <div className="panel start-panel">
          <span className="eyebrow">Test · {set.label}</span>
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
            <div className="fixed-source-note">{grammarPracticeMode ? `此練習包含所選${practiceNoteMeta.singular}的全部例句。` : '此測驗只包含單字題。'}</div>
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
            <button className={!randomOrder ? 'active' : ''} onClick={() => setRandomOrder(false)}>{set.policy.order === 'alphabetical-option' ? '韓文字母順序' : '依原順序'}</button>
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
          <button className="primary wide" disabled={!sourceQuestions.length} onClick={startSession}>開始</button>
        </div>
      </section>
    );
  }

  if (sessionFinished) {
    const mistakeQuestions = practiceMistakeReviewQuestions(questionQueue, wrongQuestionIds);
    return (
      <section className="page practice-start">
        <div className="panel start-panel practice-complete-panel">
          <Trophy size={34} aria-hidden="true" />
          <span className="eyebrow">Test complete</span>
          <h1>{`${set.label} 已完成`}</h1>
          <p>這一組的 {questionQueue.length} 題已全部作答。</p>
          <PracticeMistakeReview
            questions={mistakeQuestions}
            onRetry={canRetryMistakes && mistakeQuestions.length
              ? () => startMistakeRetry(mistakeQuestions)
              : null}
          />
          {canRepeatSession && !wrongReviewMode && (
            <button className="primary wide" onClick={startSession}><RotateCcw size={18} /> 再練一次</button>
          )}
          {completionSaving && <p>正在儲存今日文法進度...</p>}
          {completionError && (
            <>
              <div className="form-error">{completionError}</div>
              <button className="primary" onClick={finishSession}>重新儲存進度</button>
            </>
          )}
        </div>
      </section>
    );
  }

  if (!question) {
    return (
      <section className="page practice-start">
        <div className="panel start-panel">
          <span className="eyebrow">Test · {set.label}</span>
          <h1>目前沒有待測驗題目</h1>
          <p>到期單字都已經清完，今天的測驗任務已完成。</p>
        </div>
      </section>
    );
  }

  return (
    <>
    <section className="page practice-page">
      <div className="practice-layout">
        <div className="practice-shell">
          <div className="progress-line"><span style={{ width: `${((index + 1) / queue.length) * 100}%` }} /></div>
          <div className="quiz-meta quiz-meta-row">
            <span>{index + 1} / {queue.length} · {grammarMode ? '文法例句聽力' : grammarPracticeMode ? `${practiceNoteMeta.singular}例句練習` : recognitionMode ? '單字例句聽力' : activeDirection === 'zh-ko' ? '中翻韓' : '韓翻中'}</span>
            <div className="quiz-options">
              <button className={soundEnabled ? 'selected-soft' : ''} onClick={() => setSoundEnabled((enabled) => !enabled)}>{soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />} 音效</button>
              {!recognitionMode && !grammarMode && <button className={autoPronounce ? 'selected-soft' : ''} onClick={() => setAutoPronounce((enabled) => !enabled)}>{autoPronounce ? <Volume2 size={16} /> : <VolumeX size={16} />} 自動發音</button>}
              {dailyWordMode && <button
                className={chinesePronunciation ? 'selected-soft' : ''}
                aria-pressed={chinesePronunciation}
                onClick={() => {
                  if (!chinesePronunciation) setAutoPronounce(true);
                  setChinesePronunciation(!chinesePronunciation);
                  setAnswerSpeechError('');
                }}
              >{chinesePronunciation ? <Volume2 size={16} /> : <VolumeX size={16} />} 中文發音</button>}
              <button disabled={!recognitionMode && !grammarMode && activeDirection !== 'ko-zh' && !revealed && !graded} onClick={replayCurrentSpeech}><Volume2 size={16} /> {recognitionMode || grammarMode || activeDirection === 'ko-zh' ? '重播' : '發音'}</button>
            </div>
          </div>
          {optionalSaving && <p role="status">儲存練習進度中…</p>}
          {answerSpeechError && <p className="form-error" role="alert">{answerSpeechError}</p>}
          {completionError && <p className="form-error" role="alert">{completionError}</p>}
          {!selfGradeMode ? (
            <>
              <div className="prompt">
                <span>請輸入韓文</span>
                <div className="prompt-title">
                  <h1>{question.zh}</h1>
                  <QuestionKindBadge kind={question.kind} category={question.source?.category} />
                </div>
                <small className="answer-length-hint">答案 {countKoreanLetters(question.ko)} 個韓文字</small>
              </div>
              <div className="typed-answer-area">
                <textarea
                  key={question.id}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      e.stopPropagation();
                      handleConfirm();
                    }
                  }}
                  placeholder="여기에 한국어를 입력하세요 (Enter 送出)"
                  autoFocus
                  disabled={graded}
                />
                <span className="input-korean-count">{countKoreanLetters(input)}</span>
                <div className="actions answer-actions">
                  {!graded && !revealed ? (
                    <>
                      <button className="primary" onClick={handleConfirm}><Check size={18} /> 確認</button>
                      <button onClick={revealTypedAnswerAsWrong}><RotateCcw size={18} /> 公佈答案</button>
                    </>
                  ) : (
                    graded && <>
                      {lastCorrect ? <CorrectFireworks /> : <span className="answer-inline-wrong"><X size={16} /> 答錯</span>}
                      <button className="primary" onClick={goNext}><ChevronRight size={18} /> 下一題</button>
                    </>
                  )}
                </div>
                {graded && canClassifyCurrentWord && (
                  <div className="typed-folder-actions">
                    <WordFolderButtons
                      compact
                      isLearned={isCurrentWordLearned}
                      isUnfamiliar={isCurrentWordUnfamiliar}
                      learnedSaving={classification.saving === 'learned'}
                      unfamiliarSaving={classification.saving === 'unfamiliar'}
                      onMarkLearned={markCurrentWordAsLearned}
                      onMarkUnfamiliar={markCurrentWordAsUnfamiliar}
                    />
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
                <div className="prompt ko recognition-listening-prompt">
                  <Volume2 size={42} aria-hidden="true" />
                  <span>{grammarMode ? '請聆聽文法例句' : '請聆聽單字例句'}</span>
                  <small>需要時可按右上方「重播」再次播放</small>
                </div>
              ) : (
                <div className="prompt ko">
                  <span>{grammarMode || activeDirection === 'zh-ko' ? '請在心中想韓文答案' : '請在心中想中文意思'}</span>
                  <div className="prompt-title">
                    <h1>{grammarMode || activeDirection === 'zh-ko' ? question.zh : question.ko}</h1>
                    <QuestionKindBadge kind={question.kind} category={question.source?.category} />
                  </div>
                </div>
              )}
              {!revealed ? (
                <button className="primary wide" onClick={advanceRecognitionStage}>
                  {!recognitionWordVisible && grammarMode
                    ? '顯示中文'
                    : '公佈答案'}
                </button>
              ) : (
                <PracticeDecisionBar
                  disabled={optionalSaving}
                  canClassify={canClassifyCurrentWord}
                  isLearned={isCurrentWordLearned}
                  isUnfamiliar={isCurrentWordUnfamiliar}
                  learnedSaving={classification.saving === 'learned'}
                  unfamiliarSaving={classification.saving === 'unfamiliar'}
                  learnedError={classification.errors.learned}
                  unfamiliarError={classification.errors.unfamiliar}
                  onToggleLearned={markCurrentWordAsLearned}
                  onToggleUnfamiliar={markCurrentWordAsUnfamiliar}
                  onCorrect={() => submit(true)}
                  onWrong={() => submit(false)}
                />
              )}
            </>
          )}
        </div>
        <PracticeAnswerPanel
          question={displayQuestion}
          visible={revealed || graded}
          graded={graded}
          correct={lastCorrect}
          isStarred={(store.starred || []).includes(displayQuestion.source?.id)}
          onToggleStar={grammarMode || grammarPracticeMode ? null : () => toggleStarredItem(updateStore, question.source.id)}
          onEdit={displayQuestion.kind === 'grammar-example' || !onUpdateRecord ? null : setEditingItem}
        />
      </div>
    </section>
    <SessionWordEditDialog
      item={editingItem}
      allItems={allItems}
      folders={folders}
      onUpdateRecord={onUpdateRecord}
      onClose={() => setEditingItem(null)}
    />
    </>
  );
}

function QuestionKindBadge({ kind, category = NOTE_CATEGORY_GRAMMAR }) {
  const isGrammarExample = kind === 'grammar-example';
  const isExample = kind === 'example' || isGrammarExample;
  const noteExampleLabel = category === NOTE_CATEGORY_VOCABULARY ? '單字筆記例句' : '文法例句';
  return <small className={`question-kind-badge ${isExample ? 'example' : 'term'}`}>{isGrammarExample ? noteExampleLabel : isExample ? '例句' : '單字'}</small>;
}

function WordFolderButtons({ compact = false, isLearned = false, isUnfamiliar = false, learnedSaving = false, unfamiliarSaving = false, onMarkLearned, onMarkUnfamiliar }) {
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

function PracticeDecisionBar({ canClassify, isLearned, isUnfamiliar, learnedSaving, unfamiliarSaving, learnedError, unfamiliarError, onToggleLearned, onToggleUnfamiliar, onCorrect, onWrong, disabled = false }) {
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

function PracticeMistakeReview({ questions = [], onRetry = null }) {
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
                  <KoreanSpeakButton text={korean} onSpeak={speakText} />
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

function PracticeAnswerPanel({ question, visible, graded, correct, isStarred = false, onToggleStar, onEdit }) {
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

function CorrectFireworks() {
  return (
    <div className="answer-inline-celebration" aria-label="答對了">
      <span aria-hidden="true">🎉</span>
      <strong>答對！</strong>
    </div>
  );
}

function DiffResult({ result }) {
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

