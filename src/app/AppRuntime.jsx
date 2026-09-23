import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppDataProvider, useAppData } from './AppDataProvider.jsx';
import { AppShell } from './AppShell.jsx';
import { useAppNavigation } from './navigation.js';
import {
  findPreferredSpeechVoice,
  SPEECH_VOICE_STORAGE_KEY,
  speakText,
} from '../audio/speech.js';
import {
  playResultSound,
  practiceAnswerSpeech,
  speakAnswer,
  speakPracticeAnswer,
  waitFor,
} from '../features/sessions/shared/useSessionAudio.js';
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
import { arrayUnion, collection, doc, getDocsFromCache, onSnapshot, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore';
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
  attemptsFromSegmentsSnapshot,
  mergeReviewAttempts,
  reviewAttemptSegmentsRef,
  reviewDayRef,
} from '../repositories/reviewDaysRepository.js';
import {
  isTransientFirestoreError,
  retryFirestoreWrite,
} from '../repositories/firestoreWriteRepository.js';
import { persistFirestoreStoreChanges } from '../repositories/reviewStoreRepository.js';
import {
  formatReadingTestsJson,
  normalizeReadingTest,
  parseReadingTestsJson,
} from '../reading/model.js';
import { attemptDate, emptyStore } from '../review-engine/store.js';
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
import NotesNotebookPage from '../features/notes/pages/NotesNotebookPage.jsx';
import { PracticePage } from '../features/sessions/practice/PracticePage.jsx';
import { ReadingTestPage } from '../features/reading/pages/ReadingTestPage.jsx';
import ReadingTestsPage from '../features/reading/pages/ReadingTestsPage.jsx';
import { YoutubeSubtitleReader } from '../features/subtitles/pages/YoutubeSubtitleReader.jsx';
import YoutubeSubtitlesPage from '../features/subtitles/pages/YoutubeSubtitlesPage.jsx';
import { StudyPage } from '../features/sessions/study/StudyPage.jsx';

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
const signOutUser = () => signOut(auth);
const signInUser = (email, password) => signInWithEmailAndPassword(auth, email, password);
const createUser = (email, password) => createUserWithEmailAndPassword(auth, email, password);

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
    syncDelayed: false,
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
    if (!pending) return;
    setState((current) => ({
      ...current,
      syncDelayed: false,
      error: '',
      progress: `正在同步 ${pending} 筆離線操作...`,
    }));
    try {
      await setFirestoreNetworkEnabled(true);
      await waitForFirestoreSync();
      clearOfflinePendingWrites();
      setState((current) => ({
        ...current,
        pendingWrites: 0,
        syncDelayed: false,
        progress: '離線操作已同步',
        error: '',
      }));
    } catch (error) {
      setState((current) => ({ ...current, error: error.message || '離線操作同步失敗' }));
    }
  }, [user]);

  useEffect(() => {
    if (!state.online || state.manual || !state.pendingWrites || state.error) return undefined;
    const timeoutId = setTimeout(() => {
      setState((current) => current.pendingWrites && current.online && !current.manual
        ? { ...current, syncDelayed: true }
        : current);
    }, 15_000);
    return () => clearTimeout(timeoutId);
  }, [state.online, state.manual, state.pendingWrites, state.error]);

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
    const updateStatus = (event) => setState((current) => {
      const pendingWrites = event.detail?.pendingWrites ?? offlinePendingWrites();
      return {
        ...current,
        manual: event.detail?.manualOffline ?? current.manual,
        pendingWrites,
        ready: event.detail?.offlineReady || current.ready,
        error: event.detail?.syncError ?? (event.detail?.queuedLabel ? '' : current.error),
        syncDelayed: pendingWrites && !event.detail?.queuedLabel ? current.syncDelayed : false,
        progress: event.detail?.queuedLabel && pendingWrites
          ? `正在同步 ${pendingWrites} 筆離線操作...`
          : current.progress,
      };
    });
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

  return { ...state, active: !state.online || state.manual, prepare, toggleManual, checkSync: syncPendingWrites };
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
        await persistFirestoreStoreChanges(user.uid, persistedStoreRef.current, next, FIRESTORE_SCHEMA_VERSION);
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
  // A local delete snapshot can remove item before serverTimestamp resolves
  // deletedAt. Keep that pending tombstone out of the word domain meanwhile.
  const normalizedRecords = normalizeRecordSet(records.filter((record) => record?.item));
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
      pos: item.pos || '',
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


export { CONTENT_SCHEMA_VERSION, FIRESTORE_SCHEMA_VERSION, MAX_ATOMIC_RECORD_WRITES, FONT_SCALE_STORAGE_KEY, FONT_SCALE_MIN, FONT_SCALE_MAX, SPEECH_SAMPLE_TEXT, createUser, dateLabel, monthTitle, signInUser, signOutUser, useAuthUser, useOfflineMode, subtitleWordMatches, recordsFromSnapshot, mergeRecordSnapshot, reviewSettingsRef, useFirestoreStore, normalizeRecords, waitFor, speakAnswer, practiceAnswerSpeech, speakPracticeAnswer, playResultSound, NotesNotebookPage, PracticePage, ReadingTestPage, ReadingTestsPage, YoutubeSubtitleReader, YoutubeSubtitlesPage, StudyPage };
