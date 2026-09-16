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
  PracticePage,
  normalizeRecords,
  practiceAnswerSpeech,
  recordsFromSnapshot,
  subtitleWordMatches,
  useAuthUser,
} from './AppRuntime.jsx';
import { LoadingScreen, LoginPage } from './AppDialogs.jsx';
import { AppWorkspace } from './AppWorkspace.jsx';
function App() {
  const { loading: authLoading, user } = useAuthUser();
  const [practiceSet, setPracticeSet] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => todayString());
  const handleTopNavigate = useCallback((nextPage) => {
    if (nextPage === 'calendar') setSelectedDate(todayString());
  }, []);
  const navigation = useAppNavigation('home', handleTopNavigate);

  if (authLoading) return <LoadingScreen text="正在確認登入狀態" />;
  if (!user) return <LoginPage />;
  return (
    <AppDataProvider user={user} page={navigation.page} practiceKind={practiceSet?.kind}>
      <AppWorkspace
        user={user}
        practiceSet={practiceSet}
        setPracticeSet={setPracticeSet}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        navigation={navigation}
      />
    </AppDataProvider>
  );
}

export {
  PracticePage,
  attemptDate,
  buildStudyAutoPlaySpeechSequence,
  buildJsonImportDraft,
  createId,
  createRecordsFromImportEntries,
  dailyGrammarSchedule,
  dailyRecognitionSchedule,
  dailyWrongTermQuestions,
  excludeLearnedQuestions,
  findPreferredSpeechVoice,
  findImportConflict,
  familiarityLevel,
  familiarityScore,
  matchesFamiliarityLevels,
  filterItemsByFolderSelection,
  folderFilterWordIds,
  folderMembershipChanges,
  initialPracticeDirection,
  formatSingleWordJson,
  parseSingleWordEditJson,
  selectedFoldersFirst,
  wordFolderIds,
  folderTagLabel,
  groupFoldersByTag,
  groupYoutubeSubtitlesByTag,
  isTransientFirestoreError,
  markReviewDateComplete,
  isDailyWordReviewComplete,
  isSelfGradeAnswerMode,
  formatGrammarExamplesText,
  formatTaggedNoteText,
  formatPairLines,
  normalizeGrammarNote,
  grammarPracticeQuestions,
  studyCardDoubleTapAction,
  normalizeFolder,
  normalizeYoutubeSubtitle,
  isLearnedFolder,
  isUnfamiliarFolder,
  isSystemFolder,
  itemMatchesSearch,
  lowestFamiliarityTermQuestions,
  compareItemsByKoreanAlphabet,
  normalizeKoreanKey,
  normalizeRecords,
  parseGrammarExamplesText,
  parseReadingTestsJson,
  parseTaggedNoteText,
  parseYoutubeSubtitleJson,
  parseYoutubeSubtitleSrt,
  parsePairLines,
  practiceAnswerSpeech,
  practiceMistakeReviewQuestions,
  formatReadingTestsJson,
  normalizeReadingTest,
  nextRecognitionRevealState,
  recordOrder,
  recordAnswer,
  recordDailyReviewAnswer,
  recordDailyRecognitionAnswer,
  recordDailyWrongReviewAnswer,
  recordsFromSnapshot,
  resolveImportConflictDraft,
  shouldInitializeDailyRecognition,
  shouldAutoPronouncePracticePrompt,
  shouldRecordPracticeResults,
  shouldShowStudyChinese,
  subtitleEntryAtTime,
  subtitleWordMatches,
  toggleFolderGroupSelection,
  formatYoutubeSubtitleSrt,
  youtubeVideoId,
  youtubeSubtitleTagLabel,
  naverDictionaryUrl,
};

export default App;
