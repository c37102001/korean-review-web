import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppDataProvider, useAppData } from './AppDataProvider.jsx';
import { AppShell } from './AppShell.jsx';
import { useAppNavigation } from './navigation.js';
import {
  configureSpeechUtterance,
  findPreferredSpeechVoice,
  normalizeSpeechLanguage,
  readSpeechVoicePreferences,
  SPEECH_VOICE_STORAGE_KEY,
  speakText,
  speakTextAndWait,
  speechLanguageKey,
} from '../audio/speech.js';
import { useOptionalPractice } from '../practice/optionalPractice.js';
import { ActionMenu } from '../components/actions/ActionMenu.jsx';
import { EditIconButton, KoreanSpeakButton, StarButton } from '../components/actions/ContentActionButtons.jsx';
import { TextSpeakButton } from '../components/actions/TextSpeakButton.jsx';
import { FolderPickerDropdown } from '../features/word-library/components/BulkWordActions.jsx';
import { GroupedFolderMultiSelect, MultiSelectFilter, SearchScopeControl } from '../features/word-library/components/WordCollectionFilters.jsx';
import { WordCollectionView } from '../features/word-library/components/WordCollectionView.jsx';
import {
  WordDetailCard,
  WordDetails,
} from '../features/word-library/components/WordPresentation.jsx';
import {
  aggregateItemStats,
  compareItemsByKoreanAlphabet,
  FAMILIARITY_FILTER_OPTIONS,
  familiarityLevel,
  familiarityScore,
  filterItemsByFolderSelection,
  folderFilterWordIds,
  folderMembershipChanges,
  itemMatchesSearch,
  matchesFamiliarityLevels,
  selectedFoldersFirst,
  wordFolderIds,
} from '../features/word-library/collection/model.js';
import { useWordCollection } from '../features/word-library/hooks/useWordCollection.js';
import { useWordCollectionDialogs } from '../features/word-library/hooks/useWordCollectionDialogs.js';
import { SelectableKoreanText } from '../features/text-selection/components/SelectableKoreanText.jsx';
import { SelectionActionPopover, WordDefinitionPopover } from '../features/text-selection/components/SelectionOverlays.jsx';
import { QuickAddWordModal } from '../features/text-selection/components/QuickAddWordModal.jsx';
import { useDismissibleWordDefinition, useTextSelectionActions } from '../features/text-selection/hooks/useTextSelectionActions.js';
import { koreanTextMatches } from '../features/text-selection/model.js';
import {
  buildJsonImportDraft,
  clearMissingImportRelated,
  createRecordsForDate,
  createRecordsFromImportEntries,
  createUpdateRecordsFromEditedJson,
  findImportConflict,
  formatSingleWordJson,
  parseEditedImportItem,
  parseSingleWordEditJson,
  resolveImportConflictDraft,
  summarizeEditedJsonChanges,
} from '../features/word-import/model.js';
import { AddItemsModal } from '../features/word-import/components/WordImportForm.jsx';
import {
  createDailyReviewSession,
  createPracticeSession,
  createStudySession,
  PRACTICE_SESSION_KIND,
} from '../features/sessions/core/sessionDefinitions.js';
import { useWordClassification } from '../features/sessions/core/useWordClassification.js';
import { useSessionWakeLock } from '../features/sessions/core/useSessionWakeLock.js';
import {
  activePracticeDirection,
  buildPracticeQueue,
  initialPracticeDirection,
  isSelfGradeAnswerMode,
  orderReviewQuestions,
  practiceMistakeReviewQuestions,
  practiceResultEffect,
  practiceSessionView,
  selectPracticeQuestions,
  shouldAutoPronouncePracticePrompt,
  shouldRecordPracticeResults,
  shuffleItems,
} from '../features/sessions/practice/model.js';
import {
  buildStudyAutoPlaySpeechSequence,
  shouldShowStudyChinese,
  studyCardDoubleTapAction,
} from '../features/sessions/study/model.js';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  CloudOff,
  Copy,
  Download,
  Dumbbell,
  Eye,
  EyeOff,
  Flame,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Link2,
  Minus,
  Pencil,
  Pin,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Shuffle,
  Sparkles,
  Star,
  Target,
  Trash2,
  Trophy,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  folderTagLabel,
  groupFoldersByTag,
  isLearnedFolder,
  isSystemFolder,
  isUnfamiliarFolder,
  normalizeFolder,
  READING_SOURCE_FOLDER_NAME,
  SYSTEM_LEARNED_FOLDER_ID,
  SYSTEM_UNFAMILIAR_FOLDER_ID,
  toggleFolderGroupSelection,
  UNTAGGED_FOLDER_LABEL,
  YT_SOURCE_FOLDER_NAME,
} from '../folders/model.js';
import {
  activeRecordDocuments,
  mergeRecordDocuments,
  recordSyncCheckpoint,
  updateRecordSyncCheckpoint,
} from '../firestoreSync.js';
import {
  clearOfflinePendingWrites,
  isBrowserOffline,
  manualOfflineEnabled,
  markOfflineReady,
  markOfflineSectionReady,
  MANUAL_OFFLINE_STORAGE_KEY,
  offlinePendingWrites,
  offlineReadyState,
  OFFLINE_STATUS_EVENT,
  queueOfflineWrite,
  setManualOfflineEnabled,
  trackOfflineWrite,
} from '../offlineSupport.js';
import {
  formatGrammarExamplesText,
  formatTaggedNoteText,
  grammarPracticeQuestions,
  noteCategoryMeta,
  normalizeGrammarNote,
  NOTE_CATEGORY_GRAMMAR,
  NOTE_CATEGORY_VOCABULARY,
  parseGrammarExamplesText,
  parseTaggedNoteText,
} from '../notes/model.js';
import {
  createReviewAttemptWriteOperations,
  attemptsFromSegmentsSnapshot,
  mergeReviewAttempts,
  reviewAttemptSegmentsRef,
  reviewDayRef,
} from '../repositories/reviewDaysRepository.js';
import {
  commitFirestoreOperations,
  isTransientFirestoreError,
  retryFirestoreWrite,
} from '../repositories/firestoreWriteRepository.js';
import {
  formatReadingTestsJson,
  normalizeReadingTest,
  parseReadingTestsJson,
} from '../reading/model.js';
import { attemptDate, emptyStore, progressShardId } from '../review-engine/store.js';
import {
  calculateReviewStreaks,
  compareAnswer,
  countKoreanLetters,
  dailyGrammarSchedule,
  dailyRecognitionSchedule,
  dailyReviewQuestions,
  dailyWrongTermQuestions,
  excludeLearnedQuestions,
  getProgress,
  getStats,
  groupTasks,
  isDailyWordReviewComplete,
  lowestFamiliarityTermQuestions,
  markReviewDateComplete,
  nextRecognitionRevealState,
  recordAnswer,
  recordDailyRecognitionAnswer,
  recordDailyReviewAnswer,
  recordDailyWrongReviewAnswer,
  reviewQuestions,
  shouldInitializeDailyRecognition,
  toggleStarredItem,
  unfamiliarTermQuestionCount,
} from '../review-engine/index.js';
import {
  deleteLearningRecord,
  deleteLearningRecords,
  writeLearningRecord,
  writeLearningRecords,
  writeReadingTestLearningRecords,
  writeYoutubeSubtitleLearningRecords,
} from '../services/wordLibraryService.js';
import { createId } from '../shared/id.js';
import { copyText } from '../shared/clipboard.js';
import { addDays, toDateKey, todayString } from '../shared/date.js';
import { formatContentTimestamp as grammarTimestamp } from '../shared/dateTime.js';
import {
  formatYoutubeSubtitleSrt,
  groupYoutubeSubtitlesByTag,
  naverDictionaryUrl,
  normalizeYoutubeSubtitle,
  parseYoutubeSubtitleJson,
  parseYoutubeSubtitleSrt,
  subtitleEntryAtTime,
  subtitleTagLabel as youtubeSubtitleTagLabel,
  YOUTUBE_EMBED_ORIGIN,
  youtubeVideoId,
  YT_SUBTITLE_MODE_JSON,
  YT_SUBTITLE_MODE_SRT,
} from '../subtitles/model.js';
import {
  buildRecordLookup,
  formatPairLines,
  normalizeItemToV2,
  normalizeKoreanKey,
  normalizeRecordSet,
  parsePairLines,
} from '../words/records.js';
import { recordOrder, sortRecords, wordChineseSummary, wordExamples } from '../words/records.js';
import '../styles.css';
import {
  FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STORAGE_KEY,
  NotesNotebookPage, PracticePage, ReadingTestPage, ReadingTestsPage,
  StudyPage, YoutubeSubtitleReader, YoutubeSubtitlesPage,
  normalizeRecords, signOutUser, useFirestoreStore, useOfflineMode,
} from './AppRuntime.jsx';
import { LoadingScreen, OfflineStatusBar } from './AppDialogs.jsx';
import { CalendarPage, HomePage, NotesPage } from './HomeCalendarPages.jsx';
import { FolderDetailPage, FoldersPage, NotebookPage, WrongReviewPage } from './WordLibraryPages.jsx';
import { AppErrorBoundary } from './AppErrorBoundary.jsx';
export function AppWorkspace({
  user,
  practiceSet,
  setPracticeSet,
  selectedDate,
  setSelectedDate,
  navigation,
}) {
  const [store, updateStore, storeLoading, storeError, markDateComplete] = useFirestoreStore(user);
  const offlineMode = useOfflineMode(user);
  const { page, pageStack, navTop, navChild, goUp } = navigation;
  const {
    policy: dataPolicy,
    grammar,
    youtubeSubtitles: ytSubtitles,
    readingTests,
    folders,
  } = useAppData();
  const optionalPractice = useOptionalPractice(user);
  const [studySet, setStudySet] = useState(null);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [selectedYoutubeSubtitleId, setSelectedYoutubeSubtitleId] = useState(null);
  const [selectedReadingTestId, setSelectedReadingTestId] = useState(null);
  const [fontScale, setFontScale] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem(FONT_SCALE_STORAGE_KEY));
      return Number.isFinite(stored) ? Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, stored)) : 100;
    } catch {
      return 100;
    }
  });
  const selectedYoutubeSubtitle = ytSubtitles.notes.find((note) => note.id === selectedYoutubeSubtitleId);
  const selectedSubtitleHasFolder = page === 'ytSubtitle' && !!selectedYoutubeSubtitle && folders.folders.some((folder) => (
    folder.name.toLocaleLowerCase() === YT_SOURCE_FOLDER_NAME.toLocaleLowerCase()
  ));
  const selectedReadingHasFolder = page === 'readingTest' && folders.folders.some((folder) => (
    folder.name.toLocaleLowerCase() === READING_SOURCE_FOLDER_NAME.toLocaleLowerCase()
  ));
  const allRecords = useMemo(() => {
    const byId = new Map();
    (store.customRecords || []).forEach((record) => byId.set(record.id, record));
    return [...byId.values()];
  }, [store.customRecords]);
  const { items, questions } = useMemo(() => normalizeRecords(allRecords), [allRecords]);
  const learnedFolder = useMemo(() => folders.folders.find(isLearnedFolder), [folders.folders]);
  const unfamiliarFolder = useMemo(() => folders.folders.find(isUnfamiliarFolder), [folders.folders]);
  const learnedWordIds = useMemo(() => new Set(learnedFolder?.wordIds || []), [learnedFolder]);
  const unfamiliarWordIds = useMemo(() => new Set(unfamiliarFolder?.wordIds || []), [unfamiliarFolder]);
  const dailyQuestions = useMemo(() => (
    excludeLearnedQuestions(reviewQuestions(questions), learnedWordIds)
  ), [questions, learnedWordIds]);
  const todayDailyQuestions = useMemo(() => dailyReviewQuestions(store, dailyQuestions, todayString()), [store, dailyQuestions]);
  const todayWrongQuestions = useMemo(
    () => dailyWrongTermQuestions(store, dailyQuestions, todayString()),
    [store.attempts, dailyQuestions],
  );

  useEffect(() => {
    document.documentElement.style.setProperty('--user-font-scale', String(fontScale / 100));
    try { window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(fontScale)); } catch { /* Local preferences are optional. */ }
  }, [fontScale]);

  useEffect(() => {
    if (!user || storeLoading) return;
    const today = todayString();
    const todayComplete = isDailyWordReviewComplete(todayDailyQuestions);
    const todayMarked = (store.completedReviewDates || []).includes(today);
    if (!todayComplete || todayMarked) return;
    markDateComplete(today).catch(() => {});
  }, [
    user,
    storeLoading,
    store.completedReviewDates,
    todayDailyQuestions,
    markDateComplete,
  ]);

  const startPractice = (sourceQuestions, label, options = {}) => {
    setPracticeSet(createPracticeSession(sourceQuestions, label, options));
    navChild('practice');
  };
  const startStudy = (sourceItems, label) => {
    setStudySet(createStudySession(sourceItems, label));
    navChild('study');
  };
  const addLearningRecords = async (records, onProgress, folderIds = []) => {
    await writeLearningRecords(user.uid, records, onProgress, folderIds);
  };
  const updateLearningRecord = async (record, onProgress, desiredFolderIds) => {
    if (!Array.isArray(desiredFolderIds)) {
      await writeLearningRecord(user.uid, record, onProgress);
      return;
    }
    const { add: folderIdsToAdd, remove: folderIdsToRemove } = folderMembershipChanges(
      folders.folders,
      record.id,
      desiredFolderIds,
    );
    await writeLearningRecords(user.uid, [record], onProgress, folderIdsToAdd, [], [], [], folderIdsToRemove);
  };
  const updateLearningRecords = async (updatedRecords, onProgress, folderIds = [], additionalFolderWordIds = []) => {
    await writeLearningRecords(user.uid, updatedRecords, onProgress, folderIds, additionalFolderWordIds);
  };
  const addYoutubeSubtitleRecords = async (_subtitle, records, options) => {
    await writeYoutubeSubtitleLearningRecords(user.uid, records, folders.folders, options);
  };
  const addReadingTestRecords = async (_test, records, options) => {
    await writeReadingTestLearningRecords(user.uid, records, folders.folders, options);
  };
  const deleteLearningRecordsFromStore = async (recordIds) => {
    const ids = [...new Set(recordIds.filter(Boolean))];
    if (!ids.length) return;
    await deleteLearningRecords(user.uid, ids, folders.folders);
    const belongsToDeletedRecord = (entryId) => ids.some((recordId) => entryId === recordId || entryId.startsWith(`${recordId}-`));
    await updateStore((current) => ({
      ...current,
      customRecords: (current.customRecords || []).filter((record) => !ids.includes(record.id)),
      stats: Object.fromEntries(Object.entries(current.stats || {}).filter(([id]) => !belongsToDeletedRecord(id))),
      progress: Object.fromEntries(Object.entries(current.progress || {}).filter(([id]) => !belongsToDeletedRecord(id))),
      starred: (current.starred || []).filter((id) => !ids.includes(id)),
    }));
  };
  const deleteLearningRecordFromStore = async (recordId) => deleteLearningRecordsFromStore([recordId]);
  const openFolder = (folderId) => {
    setSelectedFolderId(folderId);
    navChild('folder');
  };
  const openYoutubeSubtitle = (subtitleId) => {
    setSelectedYoutubeSubtitleId(subtitleId);
    navChild('ytSubtitle');
  };
  const openReadingTest = (testId) => {
    setSelectedReadingTestId(testId);
    navChild('readingTest');
  };

  if (storeLoading
    || (dataPolicy.folders && folders.loading)
    || (dataPolicy.grammar && grammar.loading)
    || (dataPolicy.youtubeSubtitles && ytSubtitles.loading)
    || (dataPolicy.readingTests && readingTests.loading)) {
    return <LoadingScreen text="載入資料中" />;
  }

  const views = {
    home: <HomePage store={store} items={items} questions={dailyQuestions} dueQuestionsForToday={todayDailyQuestions} wrongQuestionsForToday={todayWrongQuestions} optionalPractice={optionalPractice} grammarNotes={grammar.notes} onPractice={startPractice} onOpenWrongReview={() => navChild('wrongReview')} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onWriteRecords={updateLearningRecords} folders={folders.folders} offlineMode={offlineMode} fontScale={fontScale} onFontScaleChange={setFontScale} />,
    calendar: <CalendarPage store={store} items={items} selectedDate={selectedDate} setSelectedDate={setSelectedDate} onOpenNotes={() => navChild('dateNotes')} />,
    dateNotes: <NotesPage store={store} updateStore={updateStore} items={items.filter((item) => item.date === selectedDate)} questions={questions.filter((q) => q.date === selectedDate)} date={selectedDate} allItems={items} folders={folders.folders} onAssignFolders={folders.addWordsToFolders} onCreateFolderAndAssign={folders.createFolderAndAssign} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onUpdateRecords={updateLearningRecords} onDeleteRecord={deleteLearningRecordFromStore} onDeleteRecords={deleteLearningRecordsFromStore} />,
    study: <StudyPage store={store} updateStore={updateStore} set={studySet || createStudySession(items, '全部內容')} allItems={items} folders={folders.folders} onUpdateRecord={updateLearningRecord} onBack={pageStack.length ? goUp : null} learnedWordIds={learnedWordIds} unfamiliarWordIds={unfamiliarWordIds} onToggleLearned={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(learnedFolder?.id || SYSTEM_LEARNED_FOLDER_ID, [itemId])} onToggleUnfamiliar={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(unfamiliarFolder?.id || SYSTEM_UNFAMILIAR_FOLDER_ID, [itemId])} />,
    practice: <PracticePage store={store} updateStore={updateStore} set={practiceSet || createDailyReviewSession(todayDailyQuestions)} allItems={items} folders={folders.folders} onUpdateRecord={updateLearningRecord} learnedWordIds={learnedWordIds} unfamiliarWordIds={unfamiliarWordIds} onToggleLearned={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(learnedFolder?.id || SYSTEM_LEARNED_FOLDER_ID, [itemId])} onToggleUnfamiliar={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(unfamiliarFolder?.id || SYSTEM_UNFAMILIAR_FOLDER_ID, [itemId])} />,
    notebook: <NotebookPage store={store} updateStore={updateStore} items={items} questions={questions} folders={folders.folders} onAssignFolders={folders.addWordsToFolders} onCreateFolderAndAssign={folders.createFolderAndAssign} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onUpdateRecords={updateLearningRecords} onDeleteRecord={deleteLearningRecordFromStore} onDeleteRecords={deleteLearningRecordsFromStore} />,
    wrongReview: <WrongReviewPage store={store} updateStore={updateStore} questions={todayWrongQuestions} allItems={items} folders={folders.folders} onPractice={startPractice} onStudy={startStudy} onUpdateRecord={updateLearningRecord} />,
    folders: <FoldersPage folders={folders.folders} items={items} loading={folders.loading} error={folders.error} onSave={folders.save} onDelete={folders.remove} onOpen={openFolder} />,
    folder: <FolderDetailPage folder={folders.folders.find((folder) => folder.id === selectedFolderId)} folders={folders.folders} store={store} updateStore={updateStore} items={items} questions={questions} onSaveFolder={folders.save} onDeleteFolder={folders.remove} onAddWords={folders.addWords} onAssignFolders={folders.addWordsToFolders} onCreateFolderAndAssign={folders.createFolderAndAssign} onRemoveWords={folders.removeWords} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onUpdateRecords={updateLearningRecords} onDeleteRecord={deleteLearningRecordFromStore} onDeleteRecords={deleteLearningRecordsFromStore} onBack={goUp} />,
    notes: <NotesNotebookPage notes={grammar.notes} loading={grammar.loading} error={grammar.error} onSave={grammar.save} onDelete={grammar.remove} onPractice={startPractice} />,
    ytSubtitles: <YoutubeSubtitlesPage notes={ytSubtitles.notes} error={ytSubtitles.error} onSave={ytSubtitles.save} onDelete={ytSubtitles.remove} onOpen={openYoutubeSubtitle} />,
    ytSubtitle: <YoutubeSubtitleReader note={selectedYoutubeSubtitle} allItems={items} folders={folders.folders} onAddRecords={addYoutubeSubtitleRecords} onBack={goUp} onOpenFolder={openFolder} onSave={ytSubtitles.save} onDelete={ytSubtitles.remove} />,
    readingTests: <ReadingTestsPage tests={readingTests.tests} error={readingTests.error} onSave={readingTests.save} onSaveMany={readingTests.saveMany} onDelete={readingTests.remove} onOpen={openReadingTest} />,
    readingTest: <ReadingTestPage test={readingTests.tests.find((test) => test.id === selectedReadingTestId)} allItems={items} folders={folders.folders} onAddRecords={addReadingTestRecords} onUpdateRecord={updateLearningRecord} onDeleteRecord={deleteLearningRecordFromStore} onOpenFolder={openFolder} onSave={readingTests.save} onDelete={readingTests.remove} onBack={goUp} />,
  };

  const backButtonClassName = `${page === 'ytSubtitle'
    ? `with-yt-controls ${selectedYoutubeSubtitle?.videoId ? 'with-yt-video' : ''} ${selectedSubtitleHasFolder ? 'with-yt-folder' : ''}`
    : ''} ${selectedReadingHasFolder ? 'with-reading-folder' : ''}`;
  return (
    <AppShell
      page={page}
      navTop={navTop}
      goUp={goUp}
      onLogout={signOutUser}
      status={<OfflineStatusBar offlineMode={offlineMode} />}
      errors={[
        { label: 'Firebase 同步失敗', message: storeError },
        { label: '資料夾同步失敗', message: folders.error },
        { label: 'YT 字幕同步失敗', message: ytSubtitles.error },
        { label: '閱讀測驗同步失敗', message: readingTests.error },
      ]}
      backButtonClassName={backButtonClassName}
    >
      <AppErrorBoundary key={page} onBack={pageStack.length ? goUp : null}>
        <Suspense fallback={<LoadingScreen text="載入頁面中" />}>
          {views[page]}
        </Suspense>
      </AppErrorBoundary>
    </AppShell>
  );
}
