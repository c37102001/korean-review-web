import React, { useEffect, useMemo, useRef, useState } from 'react';

import { noteCategoryMeta, NOTE_CATEGORY_GRAMMAR } from '../../../notes/model.js';
import {
  compareAnswer,
  nextRecognitionRevealState,
  recordAnswer,
  recordDailyRecognitionAnswer,
  recordDailyReviewAnswer,
  recordDailyWrongReviewAnswer,
  toggleStarredItem,
} from '../../../review-engine/index.js';
import { useWordClassification } from '../core/useWordClassification.js';
import {
  activePracticeDirection,
  buildPracticeQueue,
  initialPracticeDirection,
  isSelfGradeAnswerMode,
  practiceMistakeReviewQuestions,
  practiceResultEffect,
  practiceSessionView,
  selectPracticeQuestions,
  shouldAutoPronouncePracticePrompt,
  shouldRecordPracticeResults,
  shuffleItems,
} from './model.js';
import { playResultSound, speakAnswer, speakPracticeAnswer } from '../shared/useSessionAudio.js';
import { useSessionKeydown } from '../shared/useCardNavigation.js';
import { EmptyPractice, PracticeComplete, PracticeRunner, PracticeSetup } from './PracticeViews.jsx';

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
  useSessionKeydown((event) => {
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
  }, [revealed, graded, question, index, queue.length, recognitionMode, grammarMode, recognitionWordVisible, useChineseAnswerSpeech, editingItem], started);

  if (!started && configurableWordMode) {
    return (
      <PracticeSetup
        session={{
          dailyWordMode,
          grammarPracticeMode,
          fixedSource,
          canChooseResultRecording,
          noteLabel: practiceNoteMeta.singular,
          label: set.label,
          orderPolicy: set.policy.order,
        }}
        direction={direction}
        setDirection={setDirection}
        answerMode={answerMode}
        setAnswerMode={setAnswerMode}
        source={source}
        setSource={setSource}
        starredOnly={starredOnly}
        setStarredOnly={setStarredOnly}
        randomOrder={randomOrder}
        setRandomOrder={setRandomOrder}
        recordResults={recordResults}
        setRecordResults={setRecordResults}
        shouldRecordResults={shouldRecordResults}
        sourceQuestions={sourceQuestions}
        activeDirection={activeDirection}
        selfGradeMode={selfGradeMode}
        onStart={startSession}
      />
    );
  }

  if (sessionFinished) {
    const mistakeQuestions = practiceMistakeReviewQuestions(questionQueue, wrongQuestionIds);
    return (
      <PracticeComplete
        label={set.label}
        questionCount={questionQueue.length}
        mistakeQuestions={mistakeQuestions}
        onRetry={canRetryMistakes && mistakeQuestions.length
          ? () => startMistakeRetry(mistakeQuestions)
          : null}
        canRepeat={canRepeatSession && !wrongReviewMode}
        onRepeat={startSession}
        saving={completionSaving}
        error={completionError}
        onRetrySave={finishSession}
      />
    );
  }

  if (!question) return <EmptyPractice label={set.label} />;

  return (
    <PracticeRunner
      session={{
        grammarMode,
        grammarPracticeMode,
        recognitionMode,
        dailyWordMode,
        activeDirection,
        noteLabel: practiceNoteMeta.singular,
      }}
      state={{
        question,
        displayQuestion,
        index,
        queueLength: queue.length,
        input,
        result,
        revealed,
        graded,
        lastCorrect,
        soundEnabled,
        autoPronounce,
        chinesePronunciation,
        answerSpeechError,
        completionError,
        optionalSaving,
        recognitionWordVisible,
        selfGradeMode,
        canClassifyCurrentWord,
        isCurrentWordLearned,
        isCurrentWordUnfamiliar,
      }}
      actions={{
        setInput,
        confirm: handleConfirm,
        revealWrong: revealTypedAnswerAsWrong,
        next: goNext,
        advanceStage: advanceRecognitionStage,
        submit,
        markLearned: markCurrentWordAsLearned,
        markUnfamiliar: markCurrentWordAsUnfamiliar,
        replaySpeech: replayCurrentSpeech,
        toggleSound: () => setSoundEnabled((enabled) => !enabled),
        toggleAutoPronounce: () => setAutoPronounce((enabled) => !enabled),
        toggleChinesePronunciation: () => {
          if (!chinesePronunciation) setAutoPronounce(true);
          setChinesePronunciation(!chinesePronunciation);
          setAnswerSpeechError('');
        },
        isStarred: (store.starred || []).includes(displayQuestion.source?.id),
        toggleStar: grammarMode || grammarPracticeMode
          ? null
          : () => toggleStarredItem(updateStore, question.source.id),
      }}
      classification={classification}
      editor={{
        item: editingItem,
        allItems,
        folders,
        onUpdateRecord,
        close: () => setEditingItem(null),
        canEdit: displayQuestion.kind !== 'grammar-example' && Boolean(onUpdateRecord),
        open: setEditingItem,
      }}
    />
  );
}
