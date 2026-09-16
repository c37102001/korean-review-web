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
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { arrayUnion, collection, doc, FieldPath, getDocsFromCache, onSnapshot, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore';
import { auth, db, prepareOfflineFirestoreData, setFirestoreNetworkEnabled, waitForFirestoreSync } from '../firebase.js';
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

const NotesNotebookPage = lazy(() => import('../features/notes/pages/NotesNotebookPage.jsx'));
const PracticePage = lazy(() => import('../features/sessions/SessionPages.jsx').then((module) => ({ default: module.PracticePage })));
const ReadingTestPage = lazy(() => import('../features/reading/pages/ReadingTestPage.jsx').then((module) => ({ default: module.ReadingTestPage })));
const ReadingTestsPage = lazy(() => import('../features/reading/pages/ReadingTestsPage.jsx'));
const YoutubeSubtitleReader = lazy(() => import('../features/subtitles/pages/YoutubeSubtitleReader.jsx').then((module) => ({ default: module.YoutubeSubtitleReader })));
const YoutubeSubtitlesPage = lazy(() => import('../features/subtitles/pages/YoutubeSubtitlesPage.jsx'));
const StudyPage = lazy(() => import('../features/sessions/SessionPages.jsx').then((module) => ({ default: module.StudyPage })));

const CONTENT_SCHEMA_VERSION = 2;
const FIRESTORE_SCHEMA_VERSION = 3;
const MAX_ATOMIC_RECORD_WRITES = 450;
const FONT_SCALE_STORAGE_KEY = 'korean-review-font-scale-v1';
const FONT_SCALE_MIN = 80;
const FONT_SCALE_MAX = 150;
const SPEECH_SAMPLE_TEXT = {
  ko: '오늘도 즐겁게 한국어를 공부해요.',
  zh: '今天也一起開心地學習韓文。',
};

const dateLabel = (date) => new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T00:00:00`));
const monthTitle = (date) => new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long' }).format(date);

function useAuthUser() {
  const [authState, setAuthState] = useState({ loading: true, user: null });
  useEffect(() => onAuthStateChanged(auth, (user) => setAuthState({ loading: false, user })), []);
  return authState;
}

function useOfflineMode(user) {
  const [state, setState] = useState(() => ({
    online: typeof navigator === 'undefined' || navigator.onLine !== false,
    manual: manualOfflineEnabled(),
    pendingWrites: offlinePendingWrites(),
    ready: offlineReadyState(user?.uid),
    preparing: false,
    switching: false,
    progress: '',
    error: '',
  }));

  useEffect(() => {
    setState((current) => ({
      ...current,
      manual: manualOfflineEnabled(),
      ready: offlineReadyState(user?.uid),
      pendingWrites: offlinePendingWrites(),
    }));
  }, [user?.uid]);

  const syncPendingWrites = useCallback(async () => {
    if (!user || navigator.onLine === false || manualOfflineEnabled()) return;
    const pending = offlinePendingWrites();
    setState((current) => ({
      ...current,
      progress: pending ? `正在同步 ${pending} 筆離線操作...` : current.progress,
    }));
    try {
      await waitForFirestoreSync();
      clearOfflinePendingWrites();
      setState((current) => ({
        ...current,
        pendingWrites: 0,
        progress: pending ? '離線操作已同步' : current.progress,
        error: '',
      }));
    } catch (error) {
      setState((current) => ({ ...current, error: error.message || '離線操作同步失敗' }));
    }
  }, [user]);

  useEffect(() => {
    const updateConnection = async () => {
      const online = navigator.onLine !== false;
      const manual = manualOfflineEnabled();
      setState((current) => ({
        ...current,
        online,
        manual,
        progress: online && !manual && current.pendingWrites ? '正在同步離線操作...' : current.progress,
      }));
      if (!online || manual || !user) return;
      await syncPendingWrites();
    };
    const updateStatus = (event) => setState((current) => ({
      ...current,
      manual: event.detail?.manualOffline ?? current.manual,
      pendingWrites: event.detail?.pendingWrites ?? offlinePendingWrites(),
      ready: event.detail?.offlineReady || current.ready,
      error: event.detail?.syncError ?? current.error,
    }));
    const updateStoredMode = async (event) => {
      if (event.key !== MANUAL_OFFLINE_STORAGE_KEY) return;
      const manual = manualOfflineEnabled();
      await setFirestoreNetworkEnabled(!manual);
      setState((current) => ({ ...current, manual }));
      if (!manual) await syncPendingWrites();
    };
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    window.addEventListener('storage', updateStoredMode);
    window.addEventListener(OFFLINE_STATUS_EVENT, updateStatus);
    updateConnection();
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
      window.removeEventListener('storage', updateStoredMode);
      window.removeEventListener(OFFLINE_STATUS_EVENT, updateStatus);
    };
  }, [syncPendingWrites, user]);

  const prepare = useCallback(async ({ forceFull = false } = {}) => {
    if (!user) throw new Error('請先登入');
    if (navigator.onLine === false || manualOfflineEnabled()) throw new Error('請先連線並關閉主動離線模式，才能更新離線資料');
    setState((current) => ({ ...current, preparing: true, progress: forceFull ? '正在完整重建離線資料...' : '正在更新離線資料...', error: '' }));
    try {
      if ('serviceWorker' in navigator) {
        let registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
        if (!registration && import.meta.env.PROD) {
          registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
            scope: import.meta.env.BASE_URL,
          });
        }
        if (registration) await navigator.serviceWorker.ready;
      } else if (import.meta.env.PROD) {
        throw new Error('此瀏覽器不支援離線網頁');
      }
      const result = await prepareOfflineFirestoreData(user.uid, todayString(), ({ current, total, label, cached }) => {
        setState((value) => ({ ...value, progress: `${cached ? '確認本機資料' : '下載文字資料'} ${current}/${total}：${label}` }));
      }, { forceFull });
      try {
        await navigator.storage?.persist?.();
      } catch {
        // Persistent storage permission is optional; IndexedDB remains available without it.
      }
      const ready = markOfflineReady(user.uid, result);
      setState((current) => ({
        ...current,
        ready,
        preparing: false,
        progress: result.downloadedCount
          ? `離線資料已就緒，本次下載 ${result.downloadedCount} 筆文件`
          : `離線資料已是最新，共 ${result.documentCount} 筆快取文件`,
      }));
      return result;
    } catch (error) {
      setState((current) => ({
        ...current,
        preparing: false,
        error: error.message || '準備離線資料失敗',
        progress: '',
      }));
      throw error;
    }
  }, [user]);

  const toggleManual = useCallback(async (enabled) => {
    if (!user) throw new Error('請先登入');
    const next = enabled === true;
    setState((current) => ({ ...current, switching: true, error: '', progress: next ? '正在切換為主動離線...' : '正在恢復資料同步...' }));
    try {
      if (next) {
        if (!offlineReadyState(user.uid)) await prepare();
        await setFirestoreNetworkEnabled(false);
        setManualOfflineEnabled(true);
        setState((current) => ({
          ...current,
          manual: true,
          switching: false,
          progress: '主動離線已開啟，接下來只使用此裝置資料',
        }));
        return;
      }
      setManualOfflineEnabled(false);
      await setFirestoreNetworkEnabled(true);
      setState((current) => ({
        ...current,
        manual: false,
        switching: false,
        progress: navigator.onLine === false ? '已關閉主動離線，等待網路恢復後同步' : '正在同步本機修改...',
      }));
      await syncPendingWrites();
    } catch (error) {
      if (next) setManualOfflineEnabled(false);
      setState((current) => ({
        ...current,
        manual: manualOfflineEnabled(),
        switching: false,
        error: error.message || '切換離線模式失敗',
      }));
      throw error;
    }
  }, [prepare, syncPendingWrites, user]);

  return { ...state, active: !state.online || state.manual, prepare, toggleManual };
}

const subtitleWordMatches = koreanTextMatches;

function recordsFromSnapshot(snap) {
  return sortRecords(activeRecordDocuments(snap.docs));
}

function mergeRecordSnapshot(records, snap) {
  return sortRecords(mergeRecordDocuments(records, snap.docs));
}

const reviewSettingsRef = (uid) => doc(db, 'users', uid, 'settings', 'review');

async function persistCompletedReviewDate(uid, date) {
  await retryFirestoreWrite(() => setDoc(reviewSettingsRef(uid), {
    schemaVersion: FIRESTORE_SCHEMA_VERSION,
    completedReviewDates: arrayUnion(date),
    updatedAt: serverTimestamp(),
  }, { merge: true }));
}

function useFirestoreStore(user) {
  const [state, setState] = useState({ loading: true, error: '', store: emptyStore() });
  const storeRef = useRef(emptyStore());
  const persistedStoreRef = useRef(emptyStore());
  const writeQueueRef = useRef(Promise.resolve());
  const pendingWritesRef = useRef(0);
  const deferredRemoteRef = useRef(new Map());

  const applyRemoteStore = useCallback((updater) => {
    const next = updater(storeRef.current);
    persistedStoreRef.current = updater(persistedStoreRef.current);
    storeRef.current = next;
    setState((current) => ({ ...current, store: next }));
  }, []);

  const applyOrDeferRemote = useCallback((key, updater) => {
    if (pendingWritesRef.current > 0) {
      deferredRemoteRef.current.set(key, updater);
      return;
    }
    applyRemoteStore(updater);
  }, [applyRemoteStore]);

  const flushDeferredRemote = useCallback(() => {
    if (pendingWritesRef.current > 0 || !deferredRemoteRef.current.size) return;
    const updaters = [...deferredRemoteRef.current.values()];
    deferredRemoteRef.current.clear();
    updaters.forEach(applyRemoteStore);
  }, [applyRemoteStore]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribers = [];
    async function load() {
      if (!user) return;
      setState((current) => ({ ...current, loading: true, error: '' }));
      try {
        const initial = new Map();
        let initialized = false;
        const today = todayString();
        const applySnapshot = (key, value) => {
          initial.set(key, value);
          if (!initialized && ['records', 'settings', 'progress', 'attemptsLegacy', 'attemptsSegments'].every((name) => initial.has(name))) {
            initialized = true;
            const loadedStore = {
              ...emptyStore(),
              ...initial.get('settings'),
              ...initial.get('progress'),
              attempts: mergeReviewAttempts(initial.get('attemptsLegacy'), initial.get('attemptsSegments')),
              customRecords: initial.get('records'),
            };
            storeRef.current = loadedStore;
            persistedStoreRef.current = loadedStore;
            if (!cancelled) setState({ loading: false, error: '', store: loadedStore });
          }
        };
        const listen = (key, reference, parseSnapshot, applyRemote, section = key) => {
          unsubscribers.push(onSnapshot(reference, { includeMetadataChanges: true }, (snap) => {
            if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) markOfflineSectionReady(user.uid, section);
            const value = parseSnapshot(snap);
            if (!initialized) {
              applySnapshot(key, value);
              return;
            }
            if (!cancelled) applyOrDeferRemote(key, (current) => applyRemote(current, value));
          }, (error) => {
            if (cancelled) return;
            if (!initialized) {
              setState({ loading: false, error: error.message, store: emptyStore() });
              return;
            }
            setState((current) => ({ ...current, error: error.message }));
          }));
        };
        const recordsReference = collection(db, 'users', user.uid, 'records');
        const checkpoint = recordSyncCheckpoint(user.uid);
        let useIncrementalRecords = Boolean(checkpoint);
        if (useIncrementalRecords) {
          try {
            const cachedSnapshot = await getDocsFromCache(recordsReference);
            if (!cachedSnapshot.size) useIncrementalRecords = false;
            else applySnapshot('records', recordsFromSnapshot(cachedSnapshot));
          } catch {
            useIncrementalRecords = false;
          }
        }
        if (cancelled) return;
        if (useIncrementalRecords) {
          const changesReference = query(
            recordsReference,
            where('updatedAt', '>', new Timestamp(checkpoint.seconds, checkpoint.nanoseconds)),
          );
          unsubscribers.push(onSnapshot(changesReference, { includeMetadataChanges: true }, (snap) => {
            if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) {
              markOfflineSectionReady(user.uid, 'records');
              updateRecordSyncCheckpoint(user.uid, snap.docs);
            }
            const applyChanges = (records) => mergeRecordSnapshot(records, snap);
            if (!initialized) {
              applySnapshot('records', applyChanges(initial.get('records') || []));
              return;
            }
            if (!cancelled) applyOrDeferRemote('records', (current) => ({ ...current, customRecords: applyChanges(current.customRecords) }));
          }, (error) => {
            if (!cancelled) setState((current) => ({ ...current, loading: false, error: error.message }));
          }));
        } else {
          unsubscribers.push(onSnapshot(recordsReference, { includeMetadataChanges: true }, (snap) => {
            if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) {
              markOfflineSectionReady(user.uid, 'records');
              updateRecordSyncCheckpoint(user.uid, snap.docs);
            }
            const value = recordsFromSnapshot(snap);
            if (!initialized) applySnapshot('records', value);
            else if (!cancelled) applyOrDeferRemote('records', (current) => ({ ...current, customRecords: value }));
          }, (error) => {
            if (cancelled) return;
            if (!initialized) setState({ loading: false, error: error.message, store: emptyStore() });
            else setState((current) => ({ ...current, error: error.message }));
          }));
        }
        listen(
          'settings',
          reviewSettingsRef(user.uid),
          (snap) => {
            const settings = snap.exists() ? snap.data() : {};
            return {
              completedReviewDates: settings.completedReviewDates || [],
              starred: settings.starred || [],
              recognition: settings.recognition || null,
            };
          },
          (current, settings) => ({
            ...current,
            completedReviewDates: [...new Set([
              ...(current.completedReviewDates || []),
              ...(settings.completedReviewDates || []),
            ])].sort(),
            starred: settings.starred || [],
            recognition: settings.recognition || null,
          }),
          'reviewSettings',
        );
        listen(
          'progress',
          collection(db, 'users', user.uid, 'progressShards'),
          (snap) => {
            const stats = {};
            const progress = {};
            snap.docs.forEach((documentSnap) => {
              Object.entries(documentSnap.data().entries || {}).forEach(([questionId, data]) => {
                if (data.stats) stats[questionId] = data.stats;
                if (data.progress) progress[questionId] = data.progress;
              });
            });
            return { stats, progress };
          },
          (current, progress) => ({ ...current, ...progress }),
          'progress',
        );
        listen(
          'attemptsLegacy',
          reviewDayRef(db, user.uid, today),
          (snap) => (snap.exists() ? snap.data().attempts || [] : []),
          (current, todayAttempts) => {
            const otherAttempts = (current.attempts || []).filter((attempt) => attemptDate(attempt) !== today);
            return {
              ...current,
              attempts: mergeReviewAttempts(todayAttempts, otherAttempts),
            };
          },
          `reviewDay:${today}`,
        );
        listen(
          'attemptsSegments',
          reviewAttemptSegmentsRef(db, user.uid, today),
          attemptsFromSegmentsSnapshot,
          (current, todayAttempts) => ({
            ...current,
            attempts: mergeReviewAttempts(current.attempts, todayAttempts),
          }),
          `reviewAttemptSegments:${today}`,
        );
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error.message, store: emptyStore() });
      }
    }
    load();
    return () => {
      cancelled = true;
      deferredRemoteRef.current.clear();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [user, applyOrDeferRemote]);

  const update = useCallback(async (updater) => {
    if (!user) return;
    const next = updater(storeRef.current);
    storeRef.current = next;
    setState((current) => ({ ...current, store: next }));
    pendingWritesRef.current += 1;
    writeQueueRef.current = writeQueueRef.current
      .catch(() => {})
      .then(async () => {
        await persistFirestoreStoreChanges(user.uid, persistedStoreRef.current, next);
        persistedStoreRef.current = next;
      });
    const pendingWrite = writeQueueRef.current;
    try {
      await pendingWrite;
    } catch (error) {
      setState((current) => ({ ...current, error: error.message || 'Firebase 寫入失敗' }));
      throw error;
    } finally {
      pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
      flushDeferredRemote();
    }
  }, [user, flushDeferredRemote]);

  const markDateComplete = useCallback(async (date) => {
    if (!user) return;
    const next = markReviewDateComplete(storeRef.current, date);
    storeRef.current = next;
    setState((current) => ({ ...current, store: next }));
    pendingWritesRef.current += 1;
    writeQueueRef.current = writeQueueRef.current
      .catch(() => {})
      .then(async () => {
        await persistCompletedReviewDate(user.uid, date);
        persistedStoreRef.current = markReviewDateComplete(persistedStoreRef.current, date);
      });
    const pendingWrite = writeQueueRef.current;
    try {
      await pendingWrite;
    } catch (error) {
      setState((current) => ({ ...current, error: error.message || '完成紀錄寫入失敗' }));
      throw error;
    } finally {
      pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
      flushDeferredRemote();
    }
  }, [user, flushDeferredRemote]);

  return [state.store, update, state.loading, state.error, markDateComplete];
}

function normalizeRecords(records) {
  const normalizedRecords = normalizeRecordSet(records);
  const items = normalizedRecords.map((record, index) => ({
    ...record.item,
    id: record.id,
    date: record.date,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    order: recordOrder(record),
    index,
    zh: wordChineseSummary(record.item),
  }));

  const questions = [];
  const addExampleQuestion = (item, example, id) => {
    questions.push({
      id,
      itemId: item.id,
      date: item.date,
      kind: 'example',
      pos: '例句',
      ko: example.ko,
      zh: example.zh,
      source: item,
    });
  };
  items.forEach((item) => {
    questions.push({
      id: item.id,
      itemId: item.id,
      date: item.date,
      kind: 'term',
      pos: item.pos || '未分類',
      ko: item.ko,
      zh: item.zh,
      source: item,
    });
    (item.meanings || []).forEach((meaning) => {
      (meaning.examples || []).forEach((example) => {
        addExampleQuestion(item, example, example.id);
      });
    });
  });
  return { items, questions };
}


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

function speakPracticeAnswer(question, useChinese = false, onError = () => {}) {
  const speech = practiceAnswerSpeech(question, useChinese);
  if (!speech.text.trim()) { onError('這題沒有可朗讀的答案文字。'); return; }
  if (!window.speechSynthesis) { onError('此瀏覽器不支援語音播放。'); return; }
  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  const preferred = findPreferredSpeechVoice(voices, readSpeechVoicePreferences()[speechLanguageKey(speech.lang)], speech.lang);
  const voice = preferred
    || voices.find((candidate) => normalizeSpeechLanguage(candidate.lang) === normalizeSpeechLanguage(speech.lang))
    || voices.find((candidate) => normalizeSpeechLanguage(candidate.lang).startsWith(useChinese ? 'zh' : 'ko'));
  const utterance = configureSpeechUtterance(new SpeechSynthesisUtterance(speech.text), speech.lang, voice);
  utterance.onerror = (event) => {
    if (['canceled', 'interrupted'].includes(event.error)) return;
    onError(`${useChinese ? '中文' : '韓文'}語音播放失敗（${event.error || 'unknown'}）。請在首頁「語音設定」試聽並選擇可用聲音。`);
  };
  synth.cancel();
  synth.resume();
  synth.speak(utterance);
}

function playResultSound(correct) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const now = context.currentTime;
  const notes = correct
    ? [
        { frequency: 660, start: 0, duration: 0.12 },
        { frequency: 880, start: 0.13, duration: 0.16 },
      ]
    : [
        { frequency: 220, start: 0, duration: 0.16 },
        { frequency: 165, start: 0.14, duration: 0.18 },
      ];
  notes.forEach(({ frequency, start, duration }) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = correct ? 'sine' : 'sawtooth';
    oscillator.frequency.setValueAtTime(frequency, now + start);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(correct ? 0.12 : 0.08, now + start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + duration + 0.02);
  });
  window.setTimeout(() => context.close(), 520);
}

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

function AppWorkspace({
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
    home: <HomePage store={store} items={items} questions={dailyQuestions} dueQuestionsForToday={todayDailyQuestions} wrongQuestionsForToday={todayWrongQuestions} optionalPractice={optionalPractice} grammarNotes={grammar.notes} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onWriteRecords={updateLearningRecords} folders={folders.folders} offlineMode={offlineMode} fontScale={fontScale} onFontScaleChange={setFontScale} />,
    calendar: <CalendarPage store={store} items={items} selectedDate={selectedDate} setSelectedDate={setSelectedDate} onOpenNotes={() => navChild('dateNotes')} />,
    dateNotes: <NotesPage store={store} updateStore={updateStore} items={items.filter((item) => item.date === selectedDate)} questions={questions.filter((q) => q.date === selectedDate)} date={selectedDate} allItems={items} folders={folders.folders} onAssignFolders={folders.addWordsToFolders} onCreateFolderAndAssign={folders.createFolderAndAssign} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onUpdateRecords={updateLearningRecords} onDeleteRecord={deleteLearningRecordFromStore} onDeleteRecords={deleteLearningRecordsFromStore} />,
    study: <StudyPage store={store} updateStore={updateStore} set={studySet || createStudySession(items, '全部內容')} allItems={items} folders={folders.folders} onUpdateRecord={updateLearningRecord} onBack={pageStack.length ? goUp : null} learnedWordIds={learnedWordIds} unfamiliarWordIds={unfamiliarWordIds} onToggleLearned={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(learnedFolder?.id || SYSTEM_LEARNED_FOLDER_ID, [itemId])} onToggleUnfamiliar={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(unfamiliarFolder?.id || SYSTEM_UNFAMILIAR_FOLDER_ID, [itemId])} />,
    practice: <PracticePage store={store} updateStore={updateStore} set={practiceSet || createDailyReviewSession(todayDailyQuestions)} allItems={items} folders={folders.folders} onUpdateRecord={updateLearningRecord} learnedWordIds={learnedWordIds} unfamiliarWordIds={unfamiliarWordIds} onToggleLearned={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(learnedFolder?.id || SYSTEM_LEARNED_FOLDER_ID, [itemId])} onToggleUnfamiliar={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(unfamiliarFolder?.id || SYSTEM_UNFAMILIAR_FOLDER_ID, [itemId])} />,
    notebook: <NotebookPage store={store} updateStore={updateStore} items={items} questions={questions} folders={folders.folders} onAssignFolders={folders.addWordsToFolders} onCreateFolderAndAssign={folders.createFolderAndAssign} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onUpdateRecords={updateLearningRecords} onDeleteRecord={deleteLearningRecordFromStore} onDeleteRecords={deleteLearningRecordsFromStore} />,
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
      onLogout={() => signOut(auth)}
      status={<OfflineStatusBar offlineMode={offlineMode} />}
      errors={[
        { label: 'Firebase 同步失敗', message: storeError },
        { label: '資料夾同步失敗', message: folders.error },
        { label: 'YT 字幕同步失敗', message: ytSubtitles.error },
        { label: '閱讀測驗同步失敗', message: readingTests.error },
      ]}
      backButtonClassName={backButtonClassName}
    >
      <Suspense fallback={<LoadingScreen text="載入頁面中" />}>
        {views[page]}
      </Suspense>
    </AppShell>
  );
}

function OfflineStatusBar({ offlineMode }) {
  const { online, manual, pendingWrites, preparing, progress, error } = offlineMode;
  const offline = !online || manual;
  if (!offline && !pendingWrites && !preparing && !error) return null;
  const label = offline
    ? `${manual ? '主動離線模式' : '離線模式'}${offlineMode.ready ? '' : ' · 此裝置尚未完成離線資料準備'}${pendingWrites ? ` · ${pendingWrites} 筆操作等待同步` : ''}`
    : error || progress || `正在同步 ${pendingWrites} 筆離線操作`;
  return (
    <div className={`offline-status-bar ${offline ? 'offline' : ''} ${error ? 'error' : ''}`} role="status">
      {offline ? <CloudOff size={18} /> : <CloudDownload size={18} />}
      <span>{label}</span>
    </div>
  );
}

function LoadingScreen({ text }) {
  return (
    <section className="login-page">
      <div className="panel login-card">
        <div className="brand"><Sparkles size={24} /> 韓文筆記</div>
        <p>{text}...</p>
      </div>
    </section>
  );
}

function LoginPage() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const switchMode = (next) => { setMode(next); setError(''); };

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="login-page">
      <form className="panel login-card" onSubmit={submit}>
        <div className="brand"><Sparkles size={24} /> 韓文筆記</div>
        <h1>{mode === 'login' ? '登入後開始測驗' : '建立新帳號'}</h1>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label>
          密碼
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required minLength={6} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary wide" disabled={loading}>
          {loading ? (mode === 'login' ? '登入中…' : '建立中…') : (mode === 'login' ? '登入' : '建立帳號')}
        </button>
        <button type="button" className="text-link" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '還沒有帳號？建立新帳號' : '已有帳號？返回登入'}
        </button>
      </form>
    </section>
  );
}

function VoiceSettingsModal({ onClose }) {
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [voices, setVoices] = useState([]);
  const [preferences, setPreferences] = useState(() => {
    const stored = readSpeechVoicePreferences();
    return { ko: stored.ko || null, zh: stored.zh || null };
  });

  useEffect(() => {
    if (!speechSupported) return undefined;
    const refreshVoices = () => setVoices(window.speechSynthesis.getVoices());
    refreshVoices();
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
      window.speechSynthesis.cancel();
    };
  }, [speechSupported]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const close = () => {
    window.speechSynthesis?.cancel();
    onClose();
  };
  const voicePreference = (voice) => ({
    name: voice.name,
    lang: voice.lang,
    voiceURI: voice.voiceURI,
  });
  const preferenceMatches = (preference, voice) => Boolean(preference && (
    (preference.voiceURI && preference.voiceURI === voice.voiceURI)
    || (
      preference.name === voice.name
      && normalizeSpeechLanguage(preference.lang) === normalizeSpeechLanguage(voice.lang)
    )
  ));
  const chooseVoice = (languageKey, lang, voice) => {
    setPreferences((current) => ({
      ...current,
      [languageKey]: voice ? voicePreference(voice) : null,
    }));
    speakText(SPEECH_SAMPLE_TEXT[languageKey], lang, voice);
  };
  const save = () => {
    window.localStorage.setItem(SPEECH_VOICE_STORAGE_KEY, JSON.stringify(preferences));
    close();
  };
  const groups = [
    { key: 'ko', label: '韓文語音', lang: 'ko-KR' },
    { key: 'zh', label: '中文語音', lang: 'zh-TW' },
  ];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="voice-settings-title">
      <div className="modal-panel voice-settings-panel">
        <button className="modal-close" onClick={close} aria-label="關閉"><X size={18} /></button>
        <div className="voice-settings-head">
          <span className="eyebrow">Speech</span>
          <h2 id="voice-settings-title">語音設定</h2>
          <p>設定只儲存在這台裝置，選擇語音時會立即試聽。</p>
        </div>

        {!speechSupported ? (
          <div className="voice-empty">這個瀏覽器不支援網頁語音播放。</div>
        ) : (
          <div className="voice-language-list">
            {groups.map((group) => {
              const languageVoices = voices
                .filter((voice) => normalizeSpeechLanguage(voice.lang).startsWith(group.key))
                .sort((left, right) => Number(right.default) - Number(left.default) || left.name.localeCompare(right.name));
              return (
                <section className="voice-language-section" key={group.key}>
                  <div className="voice-language-head">
                    <h3>{group.label}</h3>
                    <span>{languageVoices.length} 種</span>
                  </div>
                  <p className="voice-sample" lang={group.lang}>{SPEECH_SAMPLE_TEXT[group.key]}</p>
                  <div className="voice-options">
                    <div className={`voice-option ${!preferences[group.key] ? 'selected' : ''}`}>
                      <label>
                        <input
                          type="radio"
                          name={`voice-${group.key}`}
                          checked={!preferences[group.key]}
                          onChange={() => chooseVoice(group.key, group.lang, null)}
                        />
                        <span><strong>系統預設</strong><small>由瀏覽器自動選擇</small></span>
                      </label>
                      <button className="voice-preview-button" onClick={() => speakText(SPEECH_SAMPLE_TEXT[group.key], group.lang, null)} aria-label={`試聽${group.label}系統預設`} title="試聽"><Volume2 size={17} /></button>
                    </div>
                    {languageVoices.map((voice) => {
                      const selected = preferenceMatches(preferences[group.key], voice);
                      return (
                        <div className={`voice-option ${selected ? 'selected' : ''}`} key={`${voice.voiceURI}-${voice.lang}`}>
                          <label>
                            <input
                              type="radio"
                              name={`voice-${group.key}`}
                              checked={selected}
                              onChange={() => chooseVoice(group.key, group.lang, voice)}
                            />
                            <span>
                              <strong>{voice.name}</strong>
                              <small>{voice.lang} · {voice.localService === false ? '網路語音' : '裝置語音'}{voice.default ? ' · 預設' : ''}</small>
                            </span>
                          </label>
                          <button className="voice-preview-button" onClick={() => speakText(SPEECH_SAMPLE_TEXT[group.key], group.lang, voice)} aria-label={`試聽 ${voice.name}`} title="試聽"><Volume2 size={17} /></button>
                        </div>
                      );
                    })}
                    {!languageVoices.length && <div className="voice-empty">這台裝置沒有可用的{group.label}。</div>}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <div className="actions voice-settings-actions">
          <button onClick={close}>取消</button>
          <button className="primary" onClick={save} disabled={!speechSupported}>儲存設定</button>
        </div>
      </div>
    </div>
  );
}

export function OptionalPracticeModal({ store, questions, grammarQuestions, folders, practicePools = {}, onCreate, onClose }) {
  const [kind, setKind] = useState('listening');
  const [count, setCount] = useState(10);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('word');
  const [levels, setLevels] = useState([]);
  const [folderIds, setFolderIds] = useState([]);
  const [direction, setDirection] = useState('ko-zh');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const grammarGroups = [...new Map(grammarQuestions.map((q) => [q.itemId, q.source])).values()]
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id));
  const [grammarId, setGrammarId] = useState(() => {
    const seen = new Set(practicePools.grammar || []);
    return grammarGroups.find((note) => grammarQuestions.some((q) => q.itemId === note.id && !seen.has(q.id)))?.id || grammarGroups[0]?.id || '';
  });
  const labels = { words: '單字練習', listening: '單字例句聽力練習', reading: '單字例句閱讀練習', grammar: '文法例句練習' };
  const folderWords = folderFilterWordIds(folders, folderIds);
  const pool = kind === 'grammar' ? grammarQuestions.filter((q) => q.itemId === grammarId) : questions.filter((question) => {
    if (question.kind !== (kind === 'words' ? 'term' : 'example')) return false;
    if (kind !== 'words') return true;
    const stats = aggregateItemStats(store, questions.filter((q) => q.itemId === question.itemId).map((q) => q.id));
    return itemMatchesSearch(question.source, query, scope)
      && matchesFamiliarityLevels(stats.level, levels, stats.score)
      && (!folderWords || folderWords.has(question.itemId));
  });
  const requestedCount = kind === 'words' ? Number(count) : kind === 'grammar' ? pool.length : 10;
  const toggle = (setter, value) => setter((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]);
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const title = kind === 'grammar' ? `${labels[kind]} · ${grammarGroups.find((note) => note.id === grammarId)?.title || ''}` : labels[kind];
      await onCreate({ id: createId(), kind, title, direction, createdAt: new Date().toISOString() }, pool.map((q) => q.id), requestedCount);
      onClose();
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="新增練習">
    <form className="modal-panel optional-practice-modal" onSubmit={submit}>
      <button type="button" className="modal-close" aria-label="關閉" disabled={saving} onClick={onClose}><X size={18} /></button>
      <h2>新增練習</h2>
      <div className="form-grid">
        <label>練習類型<select value={kind} onChange={(event) => { setKind(event.target.value); setCount(event.target.value === 'words' ? 50 : 10); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {kind === 'words' && <label>題數<input type="number" min="1" max="500" required value={count} onChange={(event) => setCount(event.target.value)} /></label>}
        {kind === 'grammar' && <label>文法<select value={grammarId} onChange={(event) => setGrammarId(event.target.value)}>{grammarGroups.map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}</select></label>}
      </div>
      {kind === 'words' && <>
        <div className="word-search-tools optional-practice-search">
          <label className="search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={scope === 'word' ? '搜尋韓文單字或中文意思' : '搜尋單字、例句、筆記或相關詞'} /></label>
          <SearchScopeControl value={scope} onChange={setScope} />
        </div>
        <div className="form-grid optional-practice-filter-grid">
          <label>方向<select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="ko-zh">韓翻中</option><option value="zh-ko">中翻韓</option></select></label>
          <MultiSelectFilter label="熟悉度" options={FAMILIARITY_FILTER_OPTIONS} selectedValues={levels} onToggle={(value) => toggle(setLevels, value)} onClear={() => setLevels([])} />
          <GroupedFolderMultiSelect folders={folders} selectedValues={folderIds} onToggle={(value) => toggle(setFolderIds, value)} onToggleGroup={(ids) => setFolderIds((current) => toggleFolderGroupSelection(current, ids))} onClear={() => setFolderIds([])} />
        </div>
      </>}
      <p>可用 {pool.length} 題 · 本次最多 {requestedCount} 題</p>
      {error && <div className="form-error">{error}</div>}
      <div className="actions"><button type="button" disabled={saving} onClick={onClose}>取消</button><button className="primary" disabled={saving || !pool.length}>{saving ? '新增中' : '新增練習'}</button></div>
    </form>
  </div>;
}

function HomePage({ store, items, questions, dueQuestionsForToday, wrongQuestionsForToday, optionalPractice, grammarNotes, onPractice, onStudy, onAddRecords, onUpdateRecord, onWriteRecords, folders = [], offlineMode, fontScale, onFontScaleChange }) {
  const [addOpen, setAddOpen] = useState(false);
  const [practiceCreatorOpen, setPracticeCreatorOpen] = useState(false);
  const [practiceError, setPracticeError] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const today = todayString();
  const due = dueQuestionsForToday;
  const wrongReview = due.length ? [] : wrongQuestionsForToday;
  const wrongReviewItems = [...new Map(
    wrongReview
      .filter((question) => question.source?.id)
      .map((question) => [question.source.id, question.source]),
  ).values()];
  const grammarQuestions = grammarPracticeQuestions(grammarNotes.filter((note) => note.category !== NOTE_CATEGORY_VOCABULARY));
  const questionById = new Map([...questions, ...grammarQuestions].map((question) => [question.id, question]));
  const practiceTasks = optionalPractice.tasks.map((task) => ({
    ...task,
    questions: task.ids.filter((id) => !task.answeredIds.includes(id)).map((id) => questionById.get(id)).filter(Boolean),
  }));
  const totalPending = due.length;
  const tasks = groupTasks(store, due, today);
  const answeredToday = store.attempts.filter((attempt) => attemptDate(attempt) === today);
  const correctToday = answeredToday.filter((attempt) => attempt.correct).length;
  const weak = lowestFamiliarityTermQuestions(store, questions, 30);
  const unfamiliarCount = unfamiliarTermQuestionCount(store, questions);
  const mastered = questions.filter((question) => getStats(store, question.id).level === '已熟悉').length;
  const progress = totalPending ? Math.max(0, Math.round((answeredToday.length / (answeredToday.length + totalPending)) * 100)) : 100;
  const startNextDailyTask = () => {
    if (due.length) onPractice(due, '今日測驗', { dueOnly: true, dailyReview: true });
  };

  return (
    <section className="page">
      <div className="hero">
        <div>
          <span className="eyebrow">Today · {dateLabel(today)}</span>
          <h1>今天練韓文</h1>
          <p>{due.length} 題單字待複習，完成即可取得火焰。</p>
          <div className="actions home-actions">
            <button className="primary" disabled={!totalPending} onClick={startNextDailyTask}><Dumbbell size={18} /> 今日測驗</button>
            <button onClick={() => setAddOpen(true)}><Plus size={18} /> 新增單字</button>
            <button onClick={() => setPracticeCreatorOpen(true)} disabled={optionalPractice.loading}><Plus size={18} /> 新增練習</button>
            <ActionMenu label="設定" icon={Settings} className="home-settings-menu">
              <button type="button" onClick={() => setVoiceSettingsOpen(true)}><Volume2 size={18} /> 語音</button>
              <div className="font-scale-control menu-control" aria-label="網頁字體大小" data-menu-keep-open>
                <span>字體 {fontScale}%</span>
                <button type="button" data-menu-keep-open onClick={() => onFontScaleChange((current) => Math.max(FONT_SCALE_MIN, current - 5))} disabled={fontScale <= FONT_SCALE_MIN} title="縮小字體" aria-label="縮小字體"><Minus size={18} /></button>
                <button type="button" data-menu-keep-open onClick={() => onFontScaleChange((current) => Math.min(FONT_SCALE_MAX, current + 5))} disabled={fontScale >= FONT_SCALE_MAX} title="放大字體" aria-label="放大字體"><Plus size={18} /></button>
              </div>
              <label className={`manual-offline-toggle menu-control ${offlineMode.manual ? 'active' : ''}`} title="開啟後只使用本機快取，所有修改會在關閉時同步">
                <span>{offlineMode.manual ? <WifiOff size={18} /> : <Wifi size={18} />} 主動離線</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={offlineMode.manual}
                  disabled={offlineMode.switching || offlineMode.preparing}
                  onChange={(event) => offlineMode.toggleManual(event.target.checked).catch(() => {})}
                  aria-label="主動離線模式"
                />
                <i aria-hidden="true" />
              </label>
              <button
                type="button"
                onClick={() => offlineMode.prepare().catch(() => {})}
                disabled={offlineMode.preparing || offlineMode.switching || !offlineMode.online || offlineMode.manual}
                title={offlineMode.ready?.completedAt ? `上次更新：${new Date(offlineMode.ready.completedAt).toLocaleString('zh-TW')}` : '下載所有文字資料供離線使用'}
              >
                <CloudDownload size={18} /> {offlineMode.preparing ? '準備中...' : offlineMode.ready ? '更新離線資料' : '下載離線資料'}
              </button>
              {offlineMode.ready && (
                <button
                  type="button"
                  onClick={() => offlineMode.prepare({ forceFull: true }).catch(() => {})}
                  disabled={offlineMode.preparing || offlineMode.switching || !offlineMode.online || offlineMode.manual}
                  title="忽略既有快取，從 Firebase 完整重新下載所有文字資料"
                >
                  <RotateCcw size={18} /> 重新下載全部
                </button>
              )}
            </ActionMenu>
          </div>
        </div>
        <div className="hero-meter">
          <div className="ring" style={{ '--progress': `${progress}%` }}>{progress}%</div>
          <span>今日完成度</span>
        </div>
      </div>

      <div className="stats-grid">
        <Stat icon={<Target />} label="待測驗" value={`${totalPending} 題`} />
        <Stat icon={<Check />} label="今日答對" value={`${correctToday}/${answeredToday.length || 0}`} />
        <Stat icon={<Trophy />} label="已熟悉" value={`${mastered} 題`} />
        <Stat icon={<Flame />} label="不熟悉" value={`${unfamiliarCount} 題`} />
      </div>

      {addOpen && (
        <AddItemsModal
          title="新增單字"
          date={today}
          lockedDate
          allItems={items}
          folders={folders}
          onAddRecords={onAddRecords}
          onUpdateRecord={onUpdateRecord}
          onWriteRecords={onWriteRecords}
          onEditExisting={(item) => {
            setAddOpen(false);
            setEditingItem(item);
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
      {editingItem && (
        <AddItemsModal
          title="編輯單字"
          date={editingItem.date}
          lockedDate
          editItem={editingItem}
          allItems={items}
          folders={folders}
          onUpdateRecord={onUpdateRecord}
          onClose={() => setEditingItem(null)}
        />
      )}
      {voiceSettingsOpen && <VoiceSettingsModal onClose={() => setVoiceSettingsOpen(false)} />}

      <div className="split">
        <div className="panel">
          <div className="panel-title"><h2>測驗與練習</h2><span>未完成練習會保留</span></div>
          {(optionalPractice.error || practiceError) && <div className="form-error">{optionalPractice.error || practiceError}</div>}
          {practiceCreatorOpen && <OptionalPracticeModal store={store} questions={questions} grammarQuestions={grammarQuestions} folders={folders} practicePools={optionalPractice.pools} onClose={() => setPracticeCreatorOpen(false)} onCreate={optionalPractice.create} />}
          <div className="task-list">
            {!!wrongReview.length && (
              <div className="task-card wrong-review-task-card">
                <div>
                  <span className="badge danger">自主加強</span>
                  <h3>今日答錯題目</h3>
                  <p>今日答錯的 {wrongReview.length} 個單字 · 不紀錄結果，可重複練習</p>
                </div>
                <div className="actions wrong-review-actions">
                  <button className="small" disabled={!wrongReviewItems.length} onClick={() => onStudy(wrongReviewItems, '今日答錯題目')}><BookOpen size={16} /> 學習</button>
                  <button className="primary small" onClick={() => onPractice(
                    wrongReview,
                    '今日答錯題目',
                    { dueOnly: true, repeatable: true, wrongReview: true, allowAlphabeticalOrder: true },
                  )}><Dumbbell size={16} /> 測驗</button>
                </div>
              </div>
            )}
            {practiceTasks.map((task) => <div className="task-card" key={task.id}>
              <div><span className="badge">自由練習</span><h3>{task.title}</h3><p>剩餘 {task.questions.length} 題</p></div>
              <div className="actions">
                <button className="primary small" disabled={!task.questions.length} onClick={() => onPractice(task.questions, task.title, {
                  dueOnly: true, optionalKind: task.kind, direction: task.direction,
                  onOptionalAnswer: (questionId, correct) => optionalPractice.answer(task.id, questionId, correct),
                  onComplete: () => optionalPractice.remove(task.id),
                })}>開始</button>
                <button aria-label="移除練習" title="移除練習" onClick={async () => {
                  if (!window.confirm('移除這組練習？')) return;
                  try { await optionalPractice.remove(task.id); } catch (error) { setPracticeError(error.message); }
                }}><Trash2 size={16} /></button>
              </div>
            </div>)}
            {tasks.map((task) => (
              <div className="task-card" key={task.id}>
                <div>
                  <span className={task.overdue ? 'badge danger' : 'badge'}>{task.overdue ? '逾期' : '今日'}</span>
                  <h3>{dateLabel(task.studyDate)} 的內容</h3>
                  <p>到期日 {task.dueDate} · {task.questions.length} 題 · 未完成</p>
                </div>
                <button className="primary small" onClick={() => onPractice(
                  task.questions,
                  `${task.studyDate} 測驗`,
                  { dueOnly: true, dailyReview: true },
                )}>開始</button>
              </div>
            ))}
            {!tasks.length && !practiceTasks.length && !wrongReview.length && <div className="empty">目前沒有待完成任務</div>}
          </div>
        </div>
        <div className="panel weak-practice-panel">
          <button
            className="primary wide"
            disabled={!weak.length}
            onClick={() => onPractice(weak, '不熟悉加強', { dueOnly: true, direction: 'ko-zh' })}
          >
            <Flame size={18} /> 測驗不熟悉內容 · {weak.length} 題
          </button>
        </div>
      </div>
    </section>
  );
}

function Stat({ icon, label, value }) {
  return <div className="stat">{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function CalendarPage({ store, items, selectedDate, setSelectedDate, onOpenNotes }) {
  const [cursor, setCursor] = useState(new Date(`${selectedDate}T00:00:00`));
  const completedDates = new Set(store.completedReviewDates || []);
  const streaks = calculateReviewStreaks(store.completedReviewDates || []);
  useEffect(() => {
    setCursor(new Date(`${selectedDate}T00:00:00`));
  }, [selectedDate]);
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const days = [];
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const today = todayString();
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = toDateKey(date);
    days.push({
      key,
      day: date.getDate(),
      current: date.getMonth() === cursor.getMonth(),
      hasStudy: items.some((item) => item.date === key),
      isToday: key === today,
      hasCompletedReview: completedDates.has(key),
    });
  }
  const selectedItems = items.filter((item) => item.date === selectedDate);
  const openDate = (date) => {
    setSelectedDate(date);
    onOpenNotes();
  };

  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Calendar</span><h1>學習日曆</h1></div>
        <div className="month-controls">
          <button className="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft /></button>
          <strong>{monthTitle(cursor)}</strong>
          <button className="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight /></button>
          <button className="today-jump" onClick={() => {
            const todayDate = todayString();
            setCursor(new Date(`${todayDate}T00:00:00`));
            setSelectedDate(todayDate);
          }}>今天</button>
        </div>
      </div>
      <div className="calendar-layout">
        <div className="calendar-grid">
          {['日', '一', '二', '三', '四', '五', '六'].map((d) => <b key={d}>{d}</b>)}
          {days.map((day) => (
            <button
              key={day.key}
              className={`day ${day.current ? '' : 'muted'} ${day.hasStudy ? 'has-study' : ''} ${day.isToday ? 'today' : ''} ${day.key === selectedDate ? 'selected' : ''}`}
              onClick={() => setSelectedDate(day.key)}
              onDoubleClick={() => openDate(day.key)}
            >
              <span>{day.day}</span>
              {day.hasCompletedReview && <span className="day-flame"><Flame /></span>}
            </button>
          ))}
        </div>
        <div className="panel">
          <div className="calendar-streaks">
            <div>
              <span>目前連勝</span>
              <strong><Flame size={18} /> {streaks.current} 天</strong>
            </div>
            <div>
              <span>歷史最長</span>
              <strong><Trophy size={18} /> {streaks.best} 天</strong>
            </div>
          </div>
          <div className="panel-title"><h2>{selectedDate}</h2><span>{selectedItems.length} 筆內容</span></div>
          {selectedItems.slice(0, 5).map((item) => <NotePreview key={item.id} item={item} />)}
          <div className="calendar-day-actions">
            <button className="primary wide" onClick={() => openDate(selectedDate)}>查看日期</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function NotesPage({ store, updateStore, items, questions, date, allItems, folders = [], onAssignFolders, onCreateFolderAndAssign, onPractice, onStudy, onAddRecords, onUpdateRecord, onUpdateRecords, onDeleteRecord, onDeleteRecords }) {
  const [exportOpen, setExportOpen] = useState(false);
  const [jsonEditOpen, setJsonEditOpen] = useState(false);
  const starredSet = new Set(store.starred || []);
  const collection = useWordCollection({
    items,
    questions,
    store,
    folders,
    sourceKey: date,
    resetFolderFiltersOnSourceChange: true,
  });
  const dialogs = useWordCollectionDialogs(date);
  const toggleFolderTag = (folderIds) => collection.setSelectedFolderIds((current) => toggleFolderGroupSelection(current, folderIds));
  const deleteDateItems = async () => {
    if (!items.length) return;
    const confirmed = window.confirm(`確定要刪除 ${date} 的 ${items.length} 筆單字嗎？這不會刪除其他日期的單字。`);
    if (!confirmed) return;
    await onDeleteRecords(items.map((item) => item.id));
    collection.setSelectedIds([]);
  };
  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Notes · {dateLabel(date)}</span><h1>日期筆記</h1></div>
        <div className="actions notebook-actions">
          <button className="add-date-button" onClick={dialogs.openAdd}><Plus size={18} /> 新增</button>
          <button disabled={!collection.filteredItems.length} onClick={() => onStudy(collection.filteredItems, `${date} 學習`)}><BookOpen size={18} /> 學習</button>
          <button className="primary" disabled={!collection.filteredQuestions.length} onClick={() => onPractice(collection.filteredQuestions, `${date} 測驗`)}><Dumbbell size={18} /> 測驗</button>
          <ActionMenu>
            <button disabled={!items.length} onClick={() => setExportOpen(true)}><Download size={18} /> 匯出 JSON</button>
            <button disabled={!items.length} onClick={() => setJsonEditOpen(true)}><Pencil size={18} /> 修改 JSON</button>
            <button className="danger-soft" disabled={!items.length} onClick={deleteDateItems}><Trash2 size={18} /> 刪除本日單字</button>
          </ActionMenu>
        </div>
      </div>
      {exportOpen && <ExportJsonModal items={items} title={`匯出 ${date} JSON`} onClose={() => setExportOpen(false)} />}
      {jsonEditOpen && (
        <EditJsonModal
          items={items}
          allItems={allItems}
          date={date}
          onSave={async (records) => {
            await onUpdateRecords(records);
            setJsonEditOpen(false);
          }}
          onClose={() => setJsonEditOpen(false)}
        />
      )}
      {dialogs.addOpen && (
        <AddItemsModal
          title="新增單字"
          date={date}
          lockedDate
          allItems={allItems}
          folders={folders}
          onAddRecords={onAddRecords}
          onUpdateRecord={onUpdateRecord}
          onWriteRecords={onUpdateRecords}
          onEditExisting={(item) => {
            dialogs.closeAdd();
            dialogs.openEditor(item);
          }}
          onClose={dialogs.closeAdd}
        />
      )}
      {dialogs.editingWord && (
        <AddItemsModal
          title="編輯單字"
          date={dialogs.editingWord.date}
          lockedDate
          editItem={dialogs.editingWord}
          allItems={allItems}
          folders={folders}
          onUpdateRecord={onUpdateRecord}
          onDeleteRecord={onDeleteRecord}
          onClose={dialogs.closeEditor}
        />
      )}
      {dialogs.viewingWord && (
        <ItemDetailModal
          item={dialogs.viewingWord}
          allItems={allItems}
          isStarred={starredSet.has(dialogs.viewingWord.id)}
          onToggleStar={() => toggleStarredItem(updateStore, dialogs.viewingWord.id)}
          onOpenItem={dialogs.openViewer}
          onEdit={dialogs.editFromViewer}
          onDelete={onDeleteRecord}
          onClose={dialogs.closeViewer}
        />
      )}
      <div className="date-folder-filter-row">
        <GroupedFolderMultiSelect
          folders={folders}
          selectedValues={collection.selectedFolderIds}
          onToggle={collection.toggleFolder}
          onToggleGroup={toggleFolderTag}
          onClear={() => collection.setSelectedFolderIds([])}
          includeUnfiled
          unfiledCount={collection.unfiledCount}
        />
        <span>{collection.selectedFolderIds.length ? `顯示 ${collection.totalCount} / ${items.length} 筆` : `共 ${items.length} 筆`}</span>
      </div>
      <WordCollectionView
        collection={collection}
        folders={folders}
        starredIds={starredSet}
        onToggleStar={(word) => toggleStarredItem(updateStore, word.id)}
        onSpeak={speakText}
        onOpen={dialogs.openViewer}
        onEdit={dialogs.openEditor}
        onDelete={onDeleteRecord}
        onAssignFolders={onAssignFolders}
        onCreateFolderAndAssign={onCreateFolderAndAssign}
        onDeleteRecords={onDeleteRecords}
        emptyMessage="這個日期沒有符合資料夾篩選的單字"
      />
    </section>
  );
}

function NotePreview({ item }) {
  return <div className="mini"><strong>{item.ko}</strong><span>{item.zh}</span></div>;
}

function buildNotebookExport(items) {
  const cleanItems = items.map((item) => {
    const {
      date,
      index,
      order,
      createdAt,
      updatedAt,
      total,
      rate,
      score,
      level,
      zh,
      ...content
    } = item;
    return { date, order, ...content };
  });
  return JSON.stringify({ schemaVersion: CONTENT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: cleanItems }, null, 2);
}

function downloadNotebookJson(jsonText) {
  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `korean-notes-backup-${todayString()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


function ExportJsonModal({ items, title = '匯出 JSON', onClose }) {
  const [copied, setCopied] = useState(false);
  const jsonText = useMemo(() => buildNotebookExport(items), [items]);
  const copyJson = async () => {
    await copyText(jsonText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel export-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="export-head">
          <div>
            <span className="eyebrow">Backup</span>
            <h2>{title}</h2>
          </div>
          <div className="actions">
            <button onClick={copyJson}><Copy size={17} /> {copied ? '已複製' : '複製'}</button>
            <button className="primary" onClick={() => downloadNotebookJson(jsonText)}><Download size={17} /> 下載</button>
          </div>
        </div>
        <pre className="json-code"><code>{jsonText}</code></pre>
      </div>
    </div>
  );
}

function EditJsonModal({ items, allItems, date, onSave, onClose }) {
  const initialJson = useMemo(() => buildNotebookExport(items), [items]);
  const scopeText = date || '全部單字';
  const [jsonText, setJsonText] = useState(initialJson);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [pendingReview, setPendingReview] = useState(null);
  const [saving, setSaving] = useState(false);
  const copyJson = async () => {
    await copyText(jsonText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const reviewJson = () => {
    setError('');
    setPendingReview(null);
    try {
      const records = createUpdateRecordsFromEditedJson(jsonText, date, items, allItems);
      const changes = summarizeEditedJsonChanges(items, records);
      setPendingReview({ records, changes });
    } catch (saveError) {
      setError(saveError.message || 'JSON 內容無法儲存');
    }
  };
  const confirmSave = async () => {
    if (!pendingReview) return;
    setError('');
    setSaving(true);
    try {
      const records = createUpdateRecordsFromEditedJson(jsonText, date, items, allItems);
      await onSave(records);
    } catch (saveError) {
      setError(saveError.message || 'JSON 內容無法儲存');
      setSaving(false);
      setPendingReview(null);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel export-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="export-head">
          <div>
            <span className="eyebrow">Edit JSON · {scopeText}</span>
            <h2>修改 JSON 內容</h2>
          </div>
          <div className="actions">
            <button onClick={copyJson}><Copy size={17} /> {copied ? '已複製' : '複製'}</button>
            <button className="primary" disabled={saving} onClick={reviewJson}><Check size={17} /> 檢查變更</button>
          </div>
        </div>
        <textarea
          className="json-editor"
          value={jsonText}
          onChange={(event) => {
            setJsonText(event.target.value);
            setPendingReview(null);
            setError('');
          }}
          spellCheck={false}
        />
        {error && <div className="json-edit-error">{error}</div>}
        {pendingReview && (
          <div className="json-change-review">
            <div>
              <strong>即將修改 {pendingReview.changes.length} 張單字卡</strong>
              <span>{pendingReview.changes.length ? '請確認以下變更後再送出。' : 'JSON 內容和目前資料相同，沒有需要送出的變更。'}</span>
            </div>
            {!!pendingReview.changes.length && (
              <div className="json-change-list">
                {pendingReview.changes.map((change) => (
                  <div className="json-change-row" key={change.id}>
                    <strong>{change.beforeKo === change.afterKo ? change.afterKo : `${change.beforeKo} → ${change.afterKo}`}</strong>
                    <span>{change.fields.join('、')}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="actions json-review-actions">
              <button onClick={() => setPendingReview(null)}>返回編輯</button>
              <button className="danger-button" onClick={onClose}>放棄</button>
              <button className="primary" disabled={saving || !pendingReview.changes.length} onClick={confirmSave}>
                <Check size={17} /> {saving ? '送出中' : '確認送出'}
              </button>
            </div>
          </div>
        )}
        <p className="json-edit-note">請保留每張卡片的 id 和 date。這裡只修改{date ? ` ${date} ` : ' '}既有單字，不新增、刪除或移動日期。</p>
      </div>
    </div>
  );
}

function FolderNameModal({ folder, tagSuggestions = [], onSave, onClose }) {
  const [name, setName] = useState(folder?.name || '');
  const [tag, setTag] = useState(folder?.tag || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave({ ...folder, name, tag });
      onClose();
    } catch (saveError) {
      setError(saveError.message || '資料夾儲存失敗');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="folder-name-title">
      <form className="modal-panel folder-name-modal" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="folder-editor-head">
          <span className="eyebrow">Folder</span>
          <h2 id="folder-name-title">{folder ? '編輯資料夾' : '新增資料夾'}</h2>
        </div>
        <div className="folder-editor-fields">
          <label>
            <span>資料夾名稱</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus={!isSystemFolder(folder)} required disabled={isSystemFolder(folder)} />
          </label>
          <label>
            <span>標籤</span>
            <input value={tag} onChange={(event) => setTag(event.target.value)} maxLength={40} list="folder-tag-options" placeholder="留空會歸類為無標籤" autoFocus={isSystemFolder(folder)} />
          </label>
        </div>
        <datalist id="folder-tag-options">{tagSuggestions.map((option) => <option value={option} key={option} />)}</datalist>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions folder-editor-actions">
          <button type="button" disabled={saving} onClick={onClose}>取消</button>
          <button className="primary" disabled={saving}><Check size={17} /> {saving ? '儲存中' : '儲存'}</button>
        </div>
      </form>
    </div>
  );
}

function FolderOverviewCard({ folder, itemById, itemIds, onOpen, onEdit, onDelete, onTogglePinned }) {
  const count = (folder.wordIds || []).filter((id) => itemIds.has(id)).length;
  const previews = (folder.wordIds || []).map((id) => itemById.get(id)).filter(Boolean).slice(0, 4);
  return (
    <article className="folder-card" onClick={() => onOpen(folder.id)}>
      <div className="folder-card-head">
        <span className="folder-icon"><FolderOpen size={25} /></span>
        <div className="card-actions">
          {isSystemFolder(folder) && <span className={`system-folder-badge ${isUnfamiliarFolder(folder) ? 'unfamiliar' : ''}`}>系統資料夾</span>}
          <button
            type="button"
            className={`edit-icon-button pin-icon-button ${folder.pinned ? 'active' : ''}`}
            title={folder.pinned ? '取消釘選' : '釘選到最上方'}
            aria-label={folder.pinned ? '取消釘選資料夾' : '釘選資料夾'}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePinned(folder);
            }}
          >
            <Pin size={15} />
          </button>
          <EditIconButton label={isSystemFolder(folder) ? '編輯標籤' : '編輯資料夾'} onClick={() => onEdit(folder)} />
          {!isSystemFolder(folder) && <button className="edit-icon-button delete-icon-button" title="刪除資料夾" aria-label="刪除資料夾" onClick={(event) => { event.stopPropagation(); onDelete(folder); }}><Trash2 size={15} /></button>}
        </div>
      </div>
      <h2>{folder.name}</h2>
      <span className="folder-tag-chip">{folderTagLabel(folder)}</span>
      <p>{isLearnedFolder(folder) ? `${count} 個單字 · 不會出現在每日測驗` : isUnfamiliarFolder(folder) ? `${count} 個單字 · 方便集中複習` : `${count} 個單字`}</p>
      <div className="folder-preview">
        {previews.length ? previews.map((item) => <span key={item.id}>{item.ko}</span>) : <span>尚未加入單字</span>}
      </div>
    </article>
  );
}

function FoldersPage({ folders, items, loading, error, onSave, onDelete, onOpen }) {
  const [editingFolder, setEditingFolder] = useState(undefined);
  const [actionError, setActionError] = useState('');
  const [collapsedTags, setCollapsedTags] = useState(() => new Set());
  const itemIds = new Set(items.map((item) => item.id));
  const pinnedFolders = folders.filter((folder) => folder.pinned);
  const folderGroups = groupFoldersByTag(folders.filter((folder) => !folder.pinned));
  const tagSuggestions = groupFoldersByTag(folders).filter((group) => group.label !== UNTAGGED_FOLDER_LABEL).map((group) => group.label);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const removeFolder = async (folder) => {
    if (isSystemFolder(folder)) return;
    if (!window.confirm(`確定要刪除資料夾「${folder.name}」嗎？單字本中的單字不會被刪除。`)) return;
    await onDelete(folder.id);
  };
  const togglePinned = async (folder) => {
    setActionError('');
    try {
      await onSave({ ...folder, pinned: !folder.pinned });
    } catch (pinError) {
      setActionError(pinError.message || `${folder.pinned ? '取消釘選' : '釘選'}資料夾失敗`);
    }
  };
  const renderFolderCard = (folder) => (
    <FolderOverviewCard
      key={folder.id}
      folder={folder}
      itemById={itemById}
      itemIds={itemIds}
      onOpen={onOpen}
      onEdit={setEditingFolder}
      onDelete={removeFolder}
      onTogglePinned={togglePinned}
    />
  );
  const toggleTag = (tag) => setCollapsedTags((current) => {
    const next = new Set(current);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    return next;
  });
  const renderFolderGroup = (group, { key, title, mark }) => {
    const collapsed = collapsedTags.has(key);
    return (
      <section className={`folder-tag-group ${collapsed ? 'collapsed' : ''}`} key={key}>
        <div className="folder-tag-group-head">
          <button
            type="button"
            className="folder-tag-group-toggle"
            aria-expanded={!collapsed}
            onClick={() => toggleTag(key)}
            title={collapsed ? `展開${title}` : `收合${title}`}
          >
            <span className="folder-tag-group-heading"><span className="folder-tag-mark">{mark}</span><h2>{title}</h2></span>
            <ChevronDown size={18} />
          </button>
          <span>{group.folders.length} 個資料夾</span>
        </div>
        {!collapsed && <div className="folder-grid">{group.folders.map(renderFolderCard)}</div>}
      </section>
    );
  };
  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Folders</span><h1>資料夾</h1></div>
        <div className="actions notebook-actions">
          <button className="primary" onClick={() => setEditingFolder(null)}><FolderPlus size={18} /> 新增資料夾</button>
        </div>
      </div>
      {(error || actionError) && <div className="form-error">{actionError || error}</div>}
      {loading ? <div className="empty">正在載入資料夾...</div> : folders.length ? (
        <div className="folder-tag-groups">
          {!!pinnedFolders.length && (
            renderFolderGroup(
              { folders: pinnedFolders },
              { key: '__pinned__', title: '置頂資料夾', mark: <><Pin size={12} /> 已釘選</> },
            )
          )}
          {folderGroups.map((group) => (
            renderFolderGroup(group, { key: group.label, title: group.label, mark: '標籤' })
          ))}
        </div>
      ) : <div className="empty folder-empty"><Folder size={32} /><strong>還沒有資料夾</strong><span>建立第一個資料夾，將同類型單字集中學習。</span></div>}
      {editingFolder !== undefined && <FolderNameModal folder={editingFolder} tagSuggestions={tagSuggestions} onSave={onSave} onClose={() => setEditingFolder(undefined)} />}
    </section>
  );
}

function AddExistingWordsModal({ folder, items, onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const [searchScope, setSearchScope] = useState('word');
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const existingIds = new Set(folder.wordIds);
  const selectedSet = new Set(selectedIds);
  const results = items
    .filter((item) => !existingIds.has(item.id))
    .filter((item) => itemMatchesSearch(item, query, searchScope))
    .slice(0, 100);
  const toggle = (itemId) => setSelectedIds((current) => (
    current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
  ));
  const save = async () => {
    if (!selectedIds.length) return;
    setSaving(true);
    setError('');
    try {
      await onAdd(folder.id, selectedIds);
      onClose();
    } catch (saveError) {
      setError(saveError.message || '加入資料夾失敗');
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-existing-title">
      <div className="modal-panel add-existing-modal">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <span className="eyebrow">Add reference</span>
        <h2 id="add-existing-title">加入現有單字到「{folder.name}」</h2>
        <div className="word-search-tools folder-word-search">
          <label className="search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchScope === 'word' ? '搜尋韓文單字或中文意思' : '搜尋韓文、中文、例句、筆記或相關詞'} autoFocus /></label>
          <SearchScopeControl value={searchScope} onChange={setSearchScope} />
        </div>
        <div className="existing-word-results">
          {results.map((item) => (
            <label className={selectedSet.has(item.id) ? 'selected' : ''} key={item.id}>
              <input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggle(item.id)} />
              <strong>{item.ko}</strong><span>{item.zh}</span><small>{item.date}</small>
            </label>
          ))}
          {!results.length && <div className="empty">沒有可加入的符合單字</div>}
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="folder-selection-footer">
          <span>已選擇 {selectedIds.length} 個單字</span>
          <button className="primary" disabled={!selectedIds.length || saving} onClick={save}>{saving ? '加入中' : '加入資料夾'}</button>
        </div>
      </div>
    </div>
  );
}

function FolderDetailPage({ folder, folders, store, updateStore, items, questions, onSaveFolder, onDeleteFolder, onAddWords, onAssignFolders, onCreateFolderAndAssign, onRemoveWords, onPractice, onStudy, onAddRecords, onUpdateRecord, onUpdateRecords, onDeleteRecord, onDeleteRecords, onBack }) {
  const [addExistingOpen, setAddExistingOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const starredSet = new Set(store.starred || []);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const sourceFolderWordIds = folder?.wordIds || [];
  const folderItems = useMemo(
    () => sourceFolderWordIds.map((id) => itemById.get(id)).filter(Boolean),
    [sourceFolderWordIds, itemById],
  );
  const staleIds = sourceFolderWordIds.filter((id) => !itemById.has(id));
  const collection = useWordCollection({
    items: folderItems,
    questions,
    store,
    folders,
    sourceKey: folder?.id || '',
    pageSize: 30,
  });
  const dialogs = useWordCollectionDialogs(folder?.id || '');
  const folderItemIds = new Set(folderItems.map((item) => item.id));
  const folderQuestions = questions.filter((question) => folderItemIds.has(question.itemId));

  if (!folder) return <section className="page"><div className="empty">找不到這個資料夾，可能已在其他裝置刪除。</div></section>;

  const deleteFolder = async () => {
    if (isSystemFolder(folder)) return;
    if (!window.confirm(`確定要刪除資料夾「${folder.name}」嗎？其中 ${folderItems.length} 個單字仍會保留在單字本。`)) return;
    await onDeleteFolder(folder.id);
    onBack();
  };

  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Folder · {folderTagLabel(folder)} · {folderItems.length} 個單字</span><h1>{folder.name}</h1></div>
        <div className="actions notebook-actions">
          <button onClick={dialogs.openAdd}><Plus size={18} /> 新增</button>
          <button onClick={() => onStudy(folderItems, `${folder.name} 學習`)} disabled={!folderItems.length}><BookOpen size={18} /> 學習</button>
          <button className="primary" onClick={() => onPractice(folderQuestions, `${folder.name} 測驗`, { allowResultRecording: true })} disabled={!folderQuestions.length}><Dumbbell size={18} /> 測驗</button>
          <ActionMenu>
            <button onClick={() => setAddExistingOpen(true)}><Link2 size={18} /> 加入現有單字</button>
            <button onClick={() => setRenameOpen(true)}><Pencil size={18} /> {isSystemFolder(folder) ? '編輯標籤' : '編輯資料夾'}</button>
            <button onClick={() => setExportOpen(true)} disabled={!folderItems.length}><Download size={18} /> 匯出 JSON</button>
            {!isSystemFolder(folder) && <button className="danger-soft" onClick={deleteFolder}><Trash2 size={17} /> 刪除資料夾</button>}
          </ActionMenu>
        </div>
      </div>
      <div className="word-search-tools folder-word-search">
        <label className="search"><Search size={18} /><input value={collection.query} onChange={(event) => collection.setQuery(event.target.value)} placeholder={collection.searchScope === 'word' ? '搜尋韓文單字或中文意思' : '搜尋這個資料夾中的全部卡片內容'} /></label>
        <SearchScopeControl value={collection.searchScope} onChange={collection.setSearchScope} />
      </div>
      {!!staleIds.length && <button className="text-link" onClick={() => onRemoveWords(folder.id, staleIds)}>清理 {staleIds.length} 個不存在的單字 reference</button>}
      {exportOpen && <ExportJsonModal items={folderItems} title={`匯出 ${folder.name} JSON`} onClose={() => setExportOpen(false)} />}
      {renameOpen && <FolderNameModal folder={folder} tagSuggestions={[...new Set(folders.map((entry) => entry.tag).filter(Boolean))]} onSave={onSaveFolder} onClose={() => setRenameOpen(false)} />}
      {addExistingOpen && <AddExistingWordsModal folder={folder} items={items} onAdd={onAddWords} onClose={() => setAddExistingOpen(false)} />}
      {dialogs.addOpen && (
        <AddItemsModal
          title={`新增單字到 ${folder.name}`}
          date={todayString()}
          allItems={items}
          folders={folders}
          initialFolderIds={[folder.id]}
          requiredFolderIds={[folder.id]}
          onAddRecords={onAddRecords}
          onUpdateRecord={onUpdateRecord}
          onWriteRecords={onUpdateRecords}
          onEditExisting={(item) => { dialogs.closeAdd(); dialogs.openViewer(item); }}
          onClose={dialogs.closeAdd}
        />
      )}
      {dialogs.editingWord && <AddItemsModal title="編輯單字" date={dialogs.editingWord.date} lockedDate editItem={dialogs.editingWord} allItems={items} folders={folders} onUpdateRecord={onUpdateRecord} onClose={dialogs.closeEditor} />}
      {dialogs.viewingWord && (
        <ItemDetailModal
          item={dialogs.viewingWord}
          allItems={items}
          isStarred={starredSet.has(dialogs.viewingWord.id)}
          onToggleStar={() => toggleStarredItem(updateStore, dialogs.viewingWord.id)}
          onOpenItem={dialogs.openViewer}
          onEdit={dialogs.editFromViewer}
          onDelete={onDeleteRecord}
          onClose={dialogs.closeViewer}
        />
      )}
      <WordCollectionView
        collection={collection}
        folders={folders}
        starredIds={starredSet}
        onToggleStar={(word) => toggleStarredItem(updateStore, word.id)}
        onSpeak={speakText}
        onOpen={dialogs.openViewer}
        onEdit={dialogs.openEditor}
        onDelete={(itemId) => onRemoveWords(folder.id, [itemId])}
        deleteLabel="從資料夾移除"
        deleteConfirmMessage={(word) => `確定要將「${word.ko}」從資料夾移除嗎？單字本中的卡片不會被刪除。`}
        onAssignFolders={onAssignFolders}
        onCreateFolderAndAssign={onCreateFolderAndAssign}
        onDeleteRecords={onDeleteRecords}
        currentFolder={folder}
        onRemoveFromCurrentFolder={onRemoveWords}
        emptyMessage={collection.query ? '找不到符合的單字' : '這個資料夾還沒有單字'}
        showPagination
      />
    </section>
  );
}

function NotebookPage({ store, updateStore, items, questions, folders = [], onAssignFolders, onCreateFolderAndAssign, onPractice, onStudy, onAddRecords, onUpdateRecord, onUpdateRecords, onDeleteRecord, onDeleteRecords }) {
  const [exportOpen, setExportOpen] = useState(false);
  const [jsonEditOpen, setJsonEditOpen] = useState(false);
  const [showLearned, setShowLearned] = useState(false);
  const starredSet = new Set(store.starred || []);
  const learnedFolder = folders.find(isLearnedFolder);
  const learnedWordIds = useMemo(() => new Set(learnedFolder?.wordIds || []), [learnedFolder]);
  const notebookItems = useMemo(
    () => showLearned ? items : items.filter((item) => !learnedWordIds.has(item.id)),
    [items, learnedWordIds, showLearned],
  );
  const collection = useWordCollection({
    items: notebookItems,
    questions,
    store,
    folders,
    sourceKey: `notebook-${showLearned}`,
    defaultSort: 'latest',
    pageSize: 30,
  });
  const dialogs = useWordCollectionDialogs('notebook');
  const toggleFolderTag = (folderIds) => collection.setSelectedFolderIds((current) => toggleFolderGroupSelection(current, folderIds));

  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Notebook</span><h1>單字本</h1></div>
        <div className="actions notebook-actions">
          <button className="add-date-button" onClick={dialogs.openAdd}><Plus size={18} /> 新增</button>
          <button onClick={() => onStudy(collection.filteredItems, '篩選結果')} disabled={!collection.filteredItems.length} title="學習目前篩選出的單字"><BookOpen size={18} /> 學習</button>
          <button className="primary" onClick={() => onPractice(collection.filteredQuestions, '篩選結果測驗', { allowResultRecording: true })} disabled={!collection.filteredQuestions.length} title="測驗目前篩選出的單字"><Dumbbell size={18} /> 測驗</button>
          <ActionMenu>
            <button
              type="button"
              className={`learned-visibility-button ${showLearned ? 'active' : ''}`}
              aria-pressed={showLearned}
              title={`${showLearned ? '目前顯示' : '目前隱藏'} ${learnedWordIds.size} 個已學習單字`}
              onClick={() => setShowLearned((current) => !current)}
            >
              {showLearned ? <Eye size={18} /> : <EyeOff size={18} />}
              {showLearned ? '顯示已學習' : '隱藏已學習'}
            </button>
            <button onClick={() => setExportOpen(true)}><Download size={18} /> 匯出 JSON</button>
            <button onClick={() => setJsonEditOpen(true)}><Pencil size={18} /> 修改 JSON</button>
          </ActionMenu>
        </div>
      </div>
      {exportOpen && <ExportJsonModal items={items} onClose={() => setExportOpen(false)} />}
      {jsonEditOpen && (
        <EditJsonModal
          items={items}
          allItems={items}
          onSave={async (records) => {
            await onUpdateRecords(records);
            setJsonEditOpen(false);
          }}
          onClose={() => setJsonEditOpen(false)}
        />
      )}
      <div className="filters">
        <div className="word-search-tools filter-search-tools">
          <label className="search"><Search size={18} /><input value={collection.query} onChange={(e) => collection.setQuery(e.target.value)} placeholder={collection.searchScope === 'word' ? '搜尋韓文單字或中文意思' : '搜尋單字、例句、筆記或相關詞'} /></label>
          <SearchScopeControl value={collection.searchScope} onChange={collection.setSearchScope} />
        </div>
        <MultiSelectFilter
          label="熟悉度"
          options={FAMILIARITY_FILTER_OPTIONS}
          selectedValues={collection.selectedLevels}
          onToggle={collection.toggleLevel}
          onClear={() => collection.setSelectedLevels([])}
        />
        <GroupedFolderMultiSelect
          folders={folders}
          selectedValues={collection.selectedFolderIds}
          onToggle={collection.toggleFolder}
          onToggleGroup={toggleFolderTag}
          onClear={() => collection.setSelectedFolderIds([])}
          includeUnfiled
          unfiledCount={collection.unfiledCount}
        />
        <select value={collection.sort} onChange={(e) => collection.setSort(e.target.value)}>
          <option value="latest">最新</option>
          <option value="alphabetical">韓文字母</option>
          <option value="score">低分優先</option>
        </select>
      </div>
      {dialogs.addOpen && (
        <AddItemsModal
          title="新增單字"
          date={todayString()}
          allItems={items}
          folders={folders}
          onAddRecords={onAddRecords}
          onUpdateRecord={onUpdateRecord}
          onWriteRecords={onUpdateRecords}
          onEditExisting={(item) => {
            dialogs.closeAdd();
            dialogs.openEditor(item);
          }}
          onClose={dialogs.closeAdd}
        />
      )}
      {dialogs.editingWord && (
        <AddItemsModal
          title="編輯單字"
          date={dialogs.editingWord.date}
          lockedDate
          editItem={dialogs.editingWord}
          allItems={items}
          folders={folders}
          onUpdateRecord={onUpdateRecord}
          onClose={dialogs.closeEditor}
        />
      )}
      {dialogs.viewingWord && (
        <ItemDetailModal
          item={dialogs.viewingWord}
          allItems={items}
          isStarred={starredSet.has(dialogs.viewingWord.id)}
          onToggleStar={() => toggleStarredItem(updateStore, dialogs.viewingWord.id)}
          onOpenItem={dialogs.openViewer}
          onEdit={dialogs.editFromViewer}
          onDelete={onDeleteRecord}
          onClose={dialogs.closeViewer}
        />
      )}
      <WordCollectionView
        collection={collection}
        folders={folders}
        starredIds={starredSet}
        onToggleStar={(word) => toggleStarredItem(updateStore, word.id)}
        onSpeak={speakText}
        onOpen={dialogs.openViewer}
        onEdit={dialogs.openEditor}
        onDelete={onDeleteRecord}
        onAssignFolders={onAssignFolders}
        onCreateFolderAndAssign={onCreateFolderAndAssign}
        onDeleteRecords={onDeleteRecords}
        emptyMessage="找不到符合的單字"
        showPagination="always"
      />
    </section>
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
