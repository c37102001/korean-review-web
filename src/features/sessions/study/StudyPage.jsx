import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Eye, EyeOff, Pause, Play, RotateCcw, Shuffle, Star, Volume2, VolumeX,
} from 'lucide-react';

import { EditIconButton, StarButton } from '../../../components/actions/ContentActionButtons.jsx';
import { TextSpeakButton } from '../../../components/actions/TextSpeakButton.jsx';
import { speakText, speakTextAndWait } from '../../../audio/speech.js';
import { toggleStarredItem } from '../../../review-engine/index.js';
import { WordDetails } from '../../word-library/components/WordPresentation.jsx';
import { useWordClassification } from '../core/useWordClassification.js';
import { useSessionWakeLock } from '../core/useSessionWakeLock.js';
import { shuffleItems } from '../practice/model.js';
import { WordFolderButtons } from '../shared/ClassificationActions.jsx';
import { SessionWordEditDialog } from '../shared/SessionWordDetails.jsx';
import { waitFor } from '../shared/useSessionAudio.js';
import { isTextEntryTarget, useCardPointerNavigation, useSessionKeydown } from '../shared/useCardNavigation.js';
import {
  buildStudyAutoPlaySpeechSequence,
  shouldShowStudyChinese,
  studyCardDoubleTapAction,
} from './model.js';

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
  const currentItems = useMemo(() => {
    const latestById = new Map(allItems.map((entry) => [entry.id, entry]));
    return set.items.map((entry) => latestById.get(entry.id) || entry);
  }, [set.items, allItems]);
  const types = ['全部', ...new Set(currentItems.map((item) => item.pos).filter(Boolean))];
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
  const cardPointerNavigation = useCardPointerNavigation({
    cardRef: flashcardWrapRef,
    resolveAction: studyCardDoubleTapAction,
    onInteraction: () => setAutoPlay(false),
    onAction: (action) => {
      if (action === 'next') goNext();
      else if (action === 'previous') goPrev();
      else toggleCard();
    },
  });
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

  useSessionKeydown((event) => {
      if (isTextEntryTarget(event.target) || event.isComposing || editingItem || event.defaultPrevented) return;
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
  }, [item?.id, autoPlay, flipped, playVoice, frontSide, showChinese, hideChineseInitially, editingItem, index, ordered.length], Boolean(item));

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
          onClick={() => { if (Date.now() > cardPointerNavigation.ignoreClickUntilRef.current) toggleCard(); }}
          onPointerDown={cardPointerNavigation.onPointerDown}
          onPointerUp={cardPointerNavigation.onPointerUp}
          onPointerCancel={cardPointerNavigation.resetPointer}
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
            <small>{frontShowsChinese ? '點擊看韓文' : showChinese ? item.pos || '' : '點擊查看韓文例句'}</small>
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
