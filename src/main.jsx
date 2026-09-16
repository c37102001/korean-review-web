import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useOptionalPractice } from './practice/optionalPractice.js';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  BookMarked,
  CalendarDays,
  Captions,
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
  Highlighter,
  LibraryBig,
  ListChecks,
  Link2,
  LogOut,
  Minus,
  MoreHorizontal,
  NotebookPen,
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
import { arrayRemove, arrayUnion, collection, deleteField, doc, FieldPath, getDocsFromCache, onSnapshot, query, serverTimestamp, setDoc, Timestamp, where, writeBatch } from 'firebase/firestore';
import { auth, db, prepareOfflineFirestoreData, setFirestoreNetworkEnabled, waitForFirestoreSync } from './firebase.js';
import {
  defaultLearnedFolder,
  defaultUnfamiliarFolder,
  folderTagLabel,
  groupFoldersByTag,
  isLearnedFolder,
  isSystemFolder,
  isUnfamiliarFolder,
  normalizeFolder,
  READING_SOURCE_FOLDER_ID,
  READING_SOURCE_FOLDER_NAME,
  SYSTEM_LEARNED_FOLDER_ID,
  SYSTEM_LEARNED_FOLDER_NAME,
  SYSTEM_UNFAMILIAR_FOLDER_ID,
  SYSTEM_UNFAMILIAR_FOLDER_NAME,
  systemFolderRank,
  toggleFolderGroupSelection,
  UNTAGGED_FOLDER_LABEL,
  YT_SOURCE_FOLDER_ID,
  YT_SOURCE_FOLDER_NAME,
} from './folders/model.js';
import {
  activeRecordDocuments,
  mergeRecordDocuments,
  recordSyncCheckpoint,
  updateRecordSyncCheckpoint,
} from './firestoreSync.js';
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
} from './offlineSupport.js';
import {
  formatGrammarExamplesText,
  formatTaggedNoteText,
  normalizeGrammarNote,
  NOTE_CATEGORY_GRAMMAR,
  NOTE_CATEGORY_VOCABULARY,
  parseGrammarExamplesText,
  parseTaggedNoteText,
} from './notes/model.js';
import {
  createReviewAttemptWriteOperations,
  attemptsFromSegmentsSnapshot,
  mergeReviewAttempts,
  reviewAttemptSegmentsRef,
  reviewDayRef,
} from './repositories/reviewDaysRepository.js';
import { subscribeToIncrementalCollection } from './repositories/incrementalCollectionRepository.js';
import { attemptDate, emptyStore, progressShardId } from './review-engine/store.js';
import { createId } from './shared/id.js';
import { firestoreTimestampIso } from './shared/firestoreTimestamp.js';
import {
  groupYoutubeSubtitlesByTag,
  naverDictionaryUrl,
  normalizeYoutubeSubtitle,
  subtitleEntryAtTime,
  subtitleTagLabel as youtubeSubtitleTagLabel,
  YOUTUBE_EMBED_ORIGIN,
  youtubeVideoId,
  YT_SUBTITLE_MODE_JSON,
  YT_SUBTITLE_MODE_SRT,
} from './subtitles/model.js';
import { recordOrder, sortRecords } from './words/records.js';
import './styles.css';

const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 90];
const DAILY_RECOGNITION_LIMIT = 50;
const DAILY_RECOGNITION_MODE = 'daily-recognition';
const DAILY_GRAMMAR_MODE = 'daily-grammar';
const DAILY_WRONG_REVIEW_MODE = 'daily-wrong-review';
const CONTENT_SCHEMA_VERSION = 2;
const FIRESTORE_SCHEMA_VERSION = 3;
const MAX_ATOMIC_RECORD_WRITES = 450;
const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/gu;
const SPEECH_VOICE_STORAGE_KEY = 'korean-review-speech-voices-v1';
const FONT_SCALE_STORAGE_KEY = 'korean-review-font-scale-v1';
const FONT_SCALE_MIN = 80;
const FONT_SCALE_MAX = 150;
const SPEECH_SAMPLE_TEXT = {
  ko: '오늘도 즐겁게 한국어를 공부해요.',
  zh: '今天也一起開心地學習韓文。',
};
const MARKDOWN_PLUGINS = [remarkGfm];

let youtubeIframeApiPromise = null;

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('瀏覽器不支援複製');
}

function ActionMenu({ label = '更多', icon: MenuIcon = MoreHorizontal, children, className = '' }) {
  const detailsRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!detailsRef.current?.contains(event.target)) detailsRef.current?.removeAttribute('open');
    };
    const closeWithEscape = (event) => {
      if (event.key === 'Escape') detailsRef.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [open]);

  return (
    <details ref={detailsRef} className={`action-menu ${className}`.trim()} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><MenuIcon size={18} /><span>{label}</span><ChevronDown className="action-menu-chevron" size={15} /></summary>
      <div className="action-menu-popover" onClick={(event) => {
        if (event.target.closest('button, a') && !event.target.closest('[data-menu-keep-open]')) {
          detailsRef.current?.removeAttribute('open');
        }
      }}>
        {children}
      </div>
    </details>
  );
}

function loadYoutubeIframeApi() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('目前無法載入 YouTube 播放器'));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeIframeApiPromise) return youtubeIframeApiPromise;
  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube 播放器初始化失敗'));
    };
    let script = document.querySelector('script[data-youtube-iframe-api]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.youtubeIframeApi = 'true';
      document.head.appendChild(script);
    }
    script.addEventListener('error', () => {
      youtubeIframeApiPromise = null;
      reject(new Error('YouTube 播放器載入失敗'));
    }, { once: true });
  });
  return youtubeIframeApiPromise;
}

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const todayString = () => toDateKey(new Date());
const addDays = (date, days) => {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return toDateKey(next);
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

function normalizeReadingTest(input, fallbackId = '') {
  const options = Array.isArray(input?.options)
    ? input.options.map((option, index) => ({
      id: String(option?.id || index + 1),
      ko: String(option?.ko || '').trim(),
      zh: String(option?.zh || '').trim(),
    }))
    : [];
  return {
    id: String(input?.id || fallbackId),
    passage: {
      ko: String(input?.passage?.ko || '').trim(),
      zh: String(input?.passage?.zh || '').trim(),
    },
    question: {
      ko: String(input?.question?.ko || '').trim(),
      zh: String(input?.question?.zh || '').trim(),
    },
    options,
    answer: String(input?.answer || '').trim(),
    learned: input?.learned === true,
    order: Number.isSafeInteger(input?.order) ? input.order : 0,
    createdAt: firestoreTimestampIso(input?.createdAt),
    updatedAt: firestoreTimestampIso(input?.updatedAt),
  };
}

function validateReadingTest(test, index = 0) {
  const label = `第 ${index + 1} 題`;
  if (!test.passage.ko || !test.passage.zh) throw new Error(`${label}的 passage 必須包含 ko 與 zh`);
  if (!test.question.ko || !test.question.zh) throw new Error(`${label}的 question 必須包含 ko 與 zh`);
  if (test.options.length < 2) throw new Error(`${label}至少需要兩個選項`);
  const optionIds = test.options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length) throw new Error(`${label}的選項 id 不可重複`);
  const incompleteOption = test.options.findIndex((option) => !option.ko || !option.zh);
  if (incompleteOption >= 0) throw new Error(`${label}的第 ${incompleteOption + 1} 個選項必須包含 id、ko 與 zh`);
  if (!optionIds.includes(test.answer)) throw new Error(`${label}的 answer 必須是其中一個選項 id`);
  return test;
}

function parseReadingTestsJson(text, existingTests = []) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch {
    throw new Error('閱讀測驗 JSON 格式無法解析');
  }
  if (!parsed || !Array.isArray(parsed.data)) throw new Error('閱讀測驗 JSON 必須是包含 data 陣列的物件');
  if (!parsed.data.length) throw new Error('data 至少需要一題閱讀測驗');
  const existingById = new Map(existingTests.map((test) => [test.id, test]));
  const tests = parsed.data.map((entry, index) => {
    const existing = entry?.id ? existingById.get(String(entry.id)) : null;
    const id = String(entry?.id || createId());
    return validateReadingTest(normalizeReadingTest({
      ...existing,
      ...entry,
      id,
      order: Number.isSafeInteger(entry?.order) ? entry.order : index,
      createdAt: entry?.createdAt || existing?.createdAt || '',
    }, id), index);
  });
  const ids = tests.map((test) => test.id);
  if (new Set(ids).size !== ids.length) throw new Error('同一份 JSON 中的閱讀題目 id 不可重複');
  return tests;
}

function formatReadingTestsJson(tests = []) {
  return JSON.stringify({
    schemaVersion: 1,
    data: tests.map((test) => ({
      ...(test.id ? { id: test.id } : {}),
      passage: test.passage,
      question: test.question,
      options: test.options,
      answer: test.answer,
      learned: test.learned === true,
      ...(Number.isSafeInteger(test.order) ? { order: test.order } : {}),
    })),
  }, null, 2);
}

function subtitleEntryIds(entries, existingEntries = []) {
  const usedIds = new Set();
  return entries.map((entry, index) => {
    const exact = existingEntries.find((current) => (
      !usedIds.has(current.id)
      && current.ko === entry.ko
      && current.zh === entry.zh
      && current.startMs === entry.startMs
    ));
    if (exact) {
      usedIds.add(exact.id);
      return { ...entry, id: exact.id };
    }
    const samePosition = existingEntries[index];
    if (samePosition?.id && !usedIds.has(samePosition.id)) {
      usedIds.add(samePosition.id);
      return { ...entry, id: samePosition.id };
    }
    return { ...entry, id: createId() };
  });
}

function parseYoutubeSubtitleJson(text, existingEntries = []) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch {
    throw new Error('字幕 JSON 格式無法解析');
  }
  if (!parsed || !Array.isArray(parsed.data)) throw new Error('字幕 JSON 必須是包含 data 陣列的物件');
  const entries = parsed.data.map((entry, index) => {
    const ko = String(entry?.ko || '').trim();
    const zh = String(entry?.zh || '').trim();
    if (!ko || !zh) throw new Error(`第 ${index + 1} 句必須同時包含 ko 與 zh`);
    return { ko, zh, startMs: null, endMs: null };
  });
  if (!entries.length) throw new Error('字幕 JSON 至少需要一個句子');
  return subtitleEntryIds(entries, existingEntries);
}

function parseSrtTimestamp(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number(match[4]);
}

function formatSrtTimestamp(value) {
  const milliseconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const fraction = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(fraction).padStart(3, '0')}`;
}

function parseYoutubeSubtitleSrt(text, existingEntries = []) {
  const blocks = String(text || '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).filter(Boolean);
  const entries = blocks.map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (/^\d+$/.test(lines[0])) lines.shift();
    const timing = lines.shift()?.match(/^(.+?)\s+-->\s+(.+?)(?:\s+.*)?$/);
    if (!timing) throw new Error(`第 ${index + 1} 段缺少有效的 SRT 時間戳`);
    const startMs = parseSrtTimestamp(timing[1]);
    const endMs = parseSrtTimestamp(timing[2]);
    if (startMs === null || endMs === null) throw new Error(`第 ${index + 1} 段的時間戳格式不正確`);
    if (lines.length < 2) throw new Error(`第 ${index + 1} 段必須提供韓文與中文各一行`);
    return {
      ko: lines[0].replace(/<[^>]+>/g, ''),
      zh: lines.slice(1).join(' ').replace(/<[^>]+>/g, ''),
      startMs,
      endMs,
    };
  });
  if (!entries.length) throw new Error('SRT 至少需要一段字幕');
  return subtitleEntryIds(entries, existingEntries);
}

function formatYoutubeSubtitleJson(entries = []) {
  return JSON.stringify({ data: entries.map(({ ko, zh }) => ({ ko, zh })) }, null, 2);
}

function formatYoutubeSubtitleSrt(entries = []) {
  return entries.map((entry, index) => [
    index + 1,
    `${formatSrtTimestamp(entry.startMs)} --> ${formatSrtTimestamp(entry.endMs)}`,
    entry.ko,
    entry.zh,
  ].join('\n')).join('\n\n');
}

function subtitleWordMatches(text, words = []) {
  const source = String(text || '');
  const byKorean = new Map();
  words.forEach((word) => {
    const ko = String(word?.ko || '').trim();
    if (ko && !byKorean.has(ko)) byKorean.set(ko, word);
  });
  const candidates = [...byKorean.entries()]
    .map(([ko, word]) => ({ ko, word }))
    .sort((left, right) => right.ko.length - left.ko.length || left.ko.localeCompare(right.ko, 'ko'));
  const found = [];
  candidates.forEach((candidate) => {
    let start = source.indexOf(candidate.ko);
    while (start >= 0) {
      found.push({ start, end: start + candidate.ko.length, word: candidate.word });
      start = source.indexOf(candidate.ko, start + candidate.ko.length);
    }
  });
  return found
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .reduce((accepted, match) => {
      const previous = accepted[accepted.length - 1];
      if (!previous || match.start >= previous.end) accepted.push(match);
      return accepted;
    }, []);
}

function useGrammarNotes(user, enabled = true) {
  const [state, setState] = useState({
    notes: [],
    review: null,
    loading: false,
    reviewLoading: false,
    error: '',
  });

  useEffect(() => {
    if (!user || !enabled) {
      setState({ notes: [], review: null, loading: false, reviewLoading: false, error: '' });
      return undefined;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    return subscribeToIncrementalCollection({
      db,
      uid: user.uid,
      collectionName: 'grammarNotes',
      onData: (documents) => {
        const notes = documents
          .map((note) => normalizeGrammarNote(note, note.id))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.title.localeCompare(b.title));
        setState((current) => ({ ...current, notes, loading: false, error: '' }));
      },
      onError: (error) => setState((current) => ({ ...current, loading: false, error: error.message })),
    });
  }, [user, enabled]);

  useEffect(() => {
    if (!user || !enabled) return undefined;
    setState((current) => ({ ...current, reviewLoading: true }));
    return onSnapshot(
      doc(db, 'users', user.uid, 'settings', 'grammarReview'),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) markOfflineSectionReady(user.uid, 'grammarReview');
        setState((current) => ({
          ...current,
          review: snapshot.exists() ? snapshot.data() : null,
          reviewLoading: false,
        }));
      },
      (error) => setState((current) => ({ ...current, reviewLoading: false, error: error.message })),
    );
  }, [user, enabled]);

  const save = useCallback(async (input) => {
    if (!user) throw new Error('尚未登入');
    const id = input.id || createId();
    const now = new Date().toISOString();
    const note = normalizeGrammarNote({
      ...input,
      id,
      createdAt: input.createdAt || now,
      updatedAt: now,
    }, id);
    if (!note.title) throw new Error('請輸入筆記標題');
    await retryFirestoreWrite(() => setDoc(doc(db, 'users', user.uid, 'grammarNotes', id), {
      ...note,
      updatedAt: serverTimestamp(),
    }));
    return note;
  }, [user]);

  const remove = useCallback(async (id) => {
    if (!user) throw new Error('尚未登入');
    await retryFirestoreWrite(() => setDoc(doc(db, 'users', user.uid, 'grammarNotes', id), {
      id,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      title: deleteField(),
      notes: deleteField(),
      examples: deleteField(),
      category: deleteField(),
      createdAt: deleteField(),
      pinned: deleteField(),
    }, { merge: true }));
  }, [user]);

  const completeReview = useCallback(async (note, date = todayString()) => {
    if (!user) throw new Error('尚未登入');
    const review = {
      lastCompletedGrammarId: note.id,
      lastCompletedCreatedAt: note.createdAt || '',
      completedDate: date,
      updatedAt: new Date().toISOString(),
    };
    await retryFirestoreWrite(() => setDoc(
      doc(db, 'users', user.uid, 'settings', 'grammarReview'),
      review,
      { merge: true },
    ));
    return review;
  }, [user]);

  return { ...state, save, remove, completeReview };
}

function useYoutubeSubtitles(user, enabled = true) {
  const [state, setState] = useState({ notes: [], loading: false, error: '' });

  useEffect(() => {
    if (!user || !enabled) {
      setState({ notes: [], loading: false, error: '' });
      return undefined;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    return subscribeToIncrementalCollection({
      db,
      uid: user.uid,
      collectionName: 'ytSubtitles',
      onData: (documents) => {
        const notes = documents
          .map((note) => normalizeYoutubeSubtitle(note, note.id))
          .filter((note) => note.title)
          .sort((left, right) => (right.updatedAt || right.createdAt || '').localeCompare(left.updatedAt || left.createdAt || '') || left.title.localeCompare(right.title));
        setState({ notes, loading: false, error: '' });
      },
      onError: (error) => setState((current) => ({ ...current, loading: false, error: error.message })),
    });
  }, [user, enabled]);

  const save = useCallback(async (input) => {
    if (!user) throw new Error('尚未登入');
    const id = input.id || createId();
    const now = new Date().toISOString();
    const note = normalizeYoutubeSubtitle({
      ...input,
      id,
      createdAt: input.createdAt || now,
      updatedAt: now,
    }, id);
    if (!note.title) throw new Error('請輸入字幕筆記標題');
    if (!note.entries.length) throw new Error('請至少加入一個字幕句子');
    if (note.youtubeUrl && !note.videoId) throw new Error('YouTube 連結格式無法辨識，請使用 youtube.com 或 youtu.be 連結');
    await retryFirestoreWrite(() => setDoc(doc(db, 'users', user.uid, 'ytSubtitles', id), {
      ...note,
      updatedAt: serverTimestamp(),
    }));
    return note;
  }, [user]);

  const remove = useCallback(async (id) => {
    if (!user) throw new Error('尚未登入');
    await retryFirestoreWrite(() => setDoc(doc(db, 'users', user.uid, 'ytSubtitles', id), {
      id,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      title: deleteField(),
      entries: deleteField(),
      youtubeUrl: deleteField(),
      videoId: deleteField(),
      mode: deleteField(),
      tag: deleteField(),
      createdAt: deleteField(),
      learned: deleteField(),
      pinned: deleteField(),
    }, { merge: true }));
  }, [user]);

  return { ...state, save, remove };
}

function useReadingTests(user, enabled = true) {
  const [state, setState] = useState({ tests: [], loading: false, error: '' });

  useEffect(() => {
    if (!user || !enabled) {
      setState({ tests: [], loading: false, error: '' });
      return undefined;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    return subscribeToIncrementalCollection({
      db,
      uid: user.uid,
      collectionName: 'readingTests',
      onData: (documents) => {
        const tests = documents
          .map((test) => normalizeReadingTest(test, test.id))
          .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || '') || left.order - right.order || left.id.localeCompare(right.id));
        setState({ tests, loading: false, error: '' });
      },
      onError: (error) => setState((current) => ({ ...current, loading: false, error: error.message })),
    });
  }, [user, enabled]);

  const saveMany = useCallback(async (inputs) => {
    if (!user) throw new Error('尚未登入');
    if (!inputs.length) throw new Error('沒有可儲存的閱讀題目');
    if (inputs.length > MAX_ATOMIC_RECORD_WRITES) throw new Error(`一次最多可以匯入 ${MAX_ATOMIC_RECORD_WRITES} 題`);
    const now = new Date().toISOString();
    const tests = inputs.map((input, index) => validateReadingTest(normalizeReadingTest({
      ...input,
      id: input.id || createId(),
      order: Number.isSafeInteger(input.order) ? input.order : index,
      createdAt: input.createdAt || now,
      updatedAt: now,
    }, input.id), index));
    await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      tests.forEach((test) => batch.set(doc(db, 'users', user.uid, 'readingTests', test.id), {
        ...test,
        updatedAt: serverTimestamp(),
      }));
      await batch.commit();
    });
    return tests;
  }, [user]);

  const save = useCallback(async (input) => (await saveMany([input]))[0], [saveMany]);

  const remove = useCallback(async (id) => {
    if (!user) throw new Error('尚未登入');
    await retryFirestoreWrite(() => setDoc(doc(db, 'users', user.uid, 'readingTests', id), {
      id,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      passage: deleteField(),
      question: deleteField(),
      options: deleteField(),
      answer: deleteField(),
      learned: deleteField(),
      order: deleteField(),
      createdAt: deleteField(),
    }, { merge: true }));
  }, [user]);

  return { ...state, save, saveMany, remove };
}

function useWordFolders(user, enabled = true) {
  const [state, setState] = useState({ folders: [], loading: false, error: '' });

  useEffect(() => {
    if (!user || !enabled) {
      setState({ folders: [], loading: false, error: '' });
      return undefined;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    return subscribeToIncrementalCollection({
      db,
      uid: user.uid,
      collectionName: 'folders',
      onData: (documents) => {
        let folders = documents
          .map((folder) => normalizeFolder(folder, folder.id))
          .filter((folder) => folder.name)
          .sort((a, b) => systemFolderRank(a) - systemFolderRank(b) || (b.createdAt || '').localeCompare(a.createdAt || '') || a.name.localeCompare(b.name));
        const missingSystemFolders = [];
        if (!folders.some(isLearnedFolder)) missingSystemFolders.push(defaultLearnedFolder());
        if (!folders.some(isUnfamiliarFolder)) missingSystemFolders.push(defaultUnfamiliarFolder());
        if (missingSystemFolders.length) {
          folders = [...missingSystemFolders, ...folders].sort((a, b) => systemFolderRank(a) - systemFolderRank(b) || (b.createdAt || '').localeCompare(a.createdAt || '') || a.name.localeCompare(b.name));
          missingSystemFolders.forEach((folder) => {
            retryFirestoreWrite(() => setDoc(doc(db, 'users', user.uid, 'folders', folder.id), {
              ...folder,
              updatedAt: serverTimestamp(),
            }))
              .catch((error) => setState((current) => ({ ...current, error: `建立${folder.name}資料夾失敗：${error.message}` })));
          });
        }
        setState({ folders, loading: false, error: '' });
      },
      onError: (error) => setState((current) => ({ ...current, loading: false, error: error.message })),
    });
  }, [user, enabled]);

  const save = useCallback(async (input) => {
    if (!user) throw new Error('尚未登入');
    const id = input?.id || createId();
    const existing = state.folders.find((folder) => folder.id === id);
    const systemFolder = isSystemFolder(existing || input);
    const name = systemFolder ? String(existing?.name || input?.name || '').trim() : String(input?.name || '').trim();
    if (!name) throw new Error('請輸入資料夾名稱');
    const duplicate = state.folders.find((folder) => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase() && folder.id !== input?.id);
    if (duplicate) throw new Error(`已經有名為「${name}」的資料夾`);
    const now = new Date().toISOString();
    const folder = normalizeFolder({
      ...existing,
      ...input,
      id,
      name,
      wordIds: existing?.wordIds || input?.wordIds || [],
      createdAt: existing?.createdAt || input?.createdAt || now,
      updatedAt: now,
    }, id);
    await retryFirestoreWrite(() => setDoc(doc(db, 'users', user.uid, 'folders', id), {
      ...folder,
      updatedAt: serverTimestamp(),
    }));
    return folder;
  }, [user, state.folders]);

  const remove = useCallback(async (folderId) => {
    if (!user) throw new Error('尚未登入');
    if (isSystemFolder(state.folders.find((folder) => folder.id === folderId) || { id: folderId })) {
      throw new Error('系統資料夾無法刪除');
    }
    await retryFirestoreWrite(() => setDoc(doc(db, 'users', user.uid, 'folders', folderId), {
      id: folderId,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      name: deleteField(),
      wordIds: deleteField(),
      tag: deleteField(),
      createdAt: deleteField(),
      pinned: deleteField(),
    }, { merge: true }));
  }, [user, state.folders]);

  const addWords = useCallback(async (folderId, wordIds) => {
    if (!user) throw new Error('尚未登入');
    const ids = [...new Set(wordIds.filter(Boolean).map(String))];
    if (!ids.length) return;
    await retryFirestoreWrite(() => setDoc(doc(db, 'users', user.uid, 'folders', folderId), {
      wordIds: arrayUnion(...ids),
      updatedAt: serverTimestamp(),
    }, { merge: true }));
  }, [user]);

  const removeWords = useCallback(async (folderId, wordIds) => {
    if (!user) throw new Error('尚未登入');
    const ids = [...new Set(wordIds.filter(Boolean).map(String))];
    if (!ids.length) return;
    await retryFirestoreWrite(() => setDoc(doc(db, 'users', user.uid, 'folders', folderId), {
      wordIds: arrayRemove(...ids),
      updatedAt: serverTimestamp(),
    }, { merge: true }));
  }, [user]);

  const addWordsToFolders = useCallback(async (folderIds, wordIds) => {
    if (!user) throw new Error('尚未登入');
    const targetFolderIds = [...new Set(folderIds.filter(Boolean).map(String))];
    const ids = [...new Set(wordIds.filter(Boolean).map(String))];
    if (!targetFolderIds.length || !ids.length) return;
    if (targetFolderIds.length > 500) throw new Error('一次最多可以更新 500 個資料夾');
    await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      targetFolderIds.forEach((folderId) => batch.set(
        doc(db, 'users', user.uid, 'folders', folderId),
        { wordIds: arrayUnion(...ids), updatedAt: serverTimestamp() },
        { merge: true },
      ));
      await batch.commit();
    });
  }, [user]);

  const createFolderAndAssign = useCallback(async (nameInput, wordIds, additionalFolderIds = [], tagInput = '') => {
    if (!user) throw new Error('尚未登入');
    const name = String(nameInput || '').trim();
    if (!name) throw new Error('請輸入新資料夾名稱');
    if ([SYSTEM_LEARNED_FOLDER_NAME, SYSTEM_UNFAMILIAR_FOLDER_NAME].includes(name)) {
      throw new Error(`「${name}」是系統保留資料夾`);
    }
    const duplicate = state.folders.find((folder) => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate) throw new Error(`已經有名為「${name}」的資料夾，請直接勾選它`);
    const ids = [...new Set(wordIds.filter(Boolean).map(String))];
    if (!ids.length) throw new Error('請先選取要加入的單字');
    const targetFolderIds = [...new Set(additionalFolderIds.filter(Boolean).map(String))];
    if (targetFolderIds.length + 1 > 500) throw new Error('這次更新的資料夾數量超過 Firebase 單次批次上限');
    const now = new Date().toISOString();
    const folder = normalizeFolder({
      id: createId(),
      name,
      tag: String(tagInput || '').trim(),
      wordIds: ids,
      createdAt: now,
      updatedAt: now,
    });
    await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', user.uid, 'folders', folder.id), {
        ...folder,
        updatedAt: serverTimestamp(),
      });
      targetFolderIds.forEach((folderId) => batch.set(
        doc(db, 'users', user.uid, 'folders', folderId),
        { wordIds: arrayUnion(...ids), updatedAt: serverTimestamp() },
        { merge: true },
      ));
      await batch.commit();
    });
    return folder;
  }, [user, state.folders]);

  return { ...state, save, remove, addWords, removeWords, addWordsToFolders, createFolderAndAssign };
}

function recordsFromSnapshot(snap) {
  return sortRecords(activeRecordDocuments(snap.docs));
}

function mergeRecordSnapshot(records, snap) {
  return sortRecords(mergeRecordDocuments(records, snap.docs));
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let firestoreWritesBlockedUntil = 0;
let firestoreQuotaError = null;

function isFirestoreQuotaExceeded(error) {
  return /quota exceeded/i.test(error?.message || '');
}

function isTransientFirestoreError(error) {
  if (isFirestoreQuotaExceeded(error)) return false;
  const code = String(error?.code || '').replace(/^firestore\//, '');
  return ['aborted', 'deadline-exceeded', 'resource-exhausted', 'unavailable'].includes(code)
    || /quota|too many requests|temporar|network|offline/i.test(error?.message || '');
}

async function retryFirestoreWrite(operation, maxAttempts = 4) {
  if (isBrowserOffline()) return queueOfflineWrite(operation, 'Firebase 資料');
  if (Date.now() < firestoreWritesBlockedUntil && firestoreQuotaError) throw firestoreQuotaError;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let timeoutId;
    try {
      const pendingWrite = Promise.resolve().then(operation);
      const result = await Promise.race([
        pendingWrite,
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve({ timedOut: true }), 8000);
        }),
      ]);
      if (result?.timedOut) return trackOfflineWrite(pendingWrite, 'Firebase 資料');
      firestoreWritesBlockedUntil = 0;
      firestoreQuotaError = null;
      return result;
    } catch (error) {
      lastError = error;
      if (isFirestoreQuotaExceeded(error)) {
        firestoreWritesBlockedUntil = Date.now() + 60_000;
        firestoreQuotaError = error;
        throw error;
      }
      if (!isTransientFirestoreError(error) || attempt === maxAttempts) throw error;
      await wait(500 * (2 ** (attempt - 1)));
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError;
}

const reviewSettingsRef = (uid) => doc(db, 'users', uid, 'settings', 'review');

async function commitFirestoreOperations(operations, chunkSize = 400) {
  for (let start = 0; start < operations.length; start += chunkSize) {
    const chunk = operations.slice(start, start + chunkSize);
    await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      chunk.forEach((operation) => operation(batch));
      await batch.commit();
    });
  }
}

async function persistFirestoreStoreChanges(uid, previous, next) {
  const operations = [];
  const changedEntriesByShard = new Map();
  const questionIds = new Set([
    ...Object.keys(previous.stats || {}),
    ...Object.keys(previous.progress || {}),
    ...Object.keys(next.stats || {}),
    ...Object.keys(next.progress || {}),
  ]);
  questionIds.forEach((questionId) => {
    const previousValue = { stats: previous.stats?.[questionId] || null, progress: previous.progress?.[questionId] || null };
    const nextValue = { stats: next.stats?.[questionId] || null, progress: next.progress?.[questionId] || null };
    if (JSON.stringify(previousValue) === JSON.stringify(nextValue)) return;
    const shardId = progressShardId(questionId);
    if (!changedEntriesByShard.has(shardId)) changedEntriesByShard.set(shardId, new Map());
    changedEntriesByShard.get(shardId).set(questionId, nextValue.stats || nextValue.progress ? nextValue : null);
  });
  changedEntriesByShard.forEach((entries, shardId) => {
    const ref = doc(db, 'users', uid, 'progressShards', shardId);
    const fieldValues = [];
    entries.forEach((entry, questionId) => {
      fieldValues.push(new FieldPath('entries', questionId), entry || deleteField());
    });
    fieldValues.push('updatedAt', serverTimestamp());
    operations.push((batch) => batch.update(ref, ...fieldValues));
  });

  const previousAttemptIds = new Set((previous.attempts || []).map((attempt) => attempt.id));
  const addedAttempts = (next.attempts || []).filter((attempt) => !previousAttemptIds.has(attempt.id));
  operations.push(...createReviewAttemptWriteOperations(db, uid, previous.attempts, addedAttempts));

  const previousCompletedDates = new Set(previous.completedReviewDates || []);
  const addedCompletedDates = (next.completedReviewDates || []).filter((date) => !previousCompletedDates.has(date));
  const settingsChanged = addedCompletedDates.length
    || JSON.stringify(previous.starred || []) !== JSON.stringify(next.starred || [])
    || JSON.stringify(previous.recognition || null) !== JSON.stringify(next.recognition || null);
  if (settingsChanged) {
    const settingsUpdate = { schemaVersion: FIRESTORE_SCHEMA_VERSION, updatedAt: serverTimestamp() };
    if (addedCompletedDates.length) settingsUpdate.completedReviewDates = arrayUnion(...addedCompletedDates);
    if (JSON.stringify(previous.starred || []) !== JSON.stringify(next.starred || [])) settingsUpdate.starred = next.starred || [];
    if (JSON.stringify(previous.recognition || null) !== JSON.stringify(next.recognition || null)) settingsUpdate.recognition = next.recognition || null;
    operations.push((batch) => batch.set(reviewSettingsRef(uid), settingsUpdate, { merge: true }));
  }
  await commitFirestoreOperations(operations);
}

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

function normalizeKoreanKey(value) {
  return String(value || '').trim().normalize('NFC');
}

function buildRecordLookup(records) {
  const byId = new Map();
  const byKo = new Map();
  records.forEach((record) => {
    byId.set(record.id, record.id);
    if (record.item?.ko) byKo.set(normalizeKoreanKey(record.item.ko), record.id);
  });
  return { byId, byKo };
}

function resolveRelatedIds(related, lookup) {
  if (!Array.isArray(related)) return [];
  return [...new Set(related.map((entry) => {
    if (typeof entry === 'string') return lookup.byId.get(entry) || lookup.byKo.get(normalizeKoreanKey(entry)) || entry.trim();
    if (entry?.id) return lookup.byId.get(entry.id) || entry.id;
    if (entry?.ko) return lookup.byKo.get(normalizeKoreanKey(entry.ko)) || entry.ko.trim();
    return '';
  }).filter(Boolean))];
}

function normalizeExample(example, fallbackId) {
  return {
    id: example.id || fallbackId,
    ko: example.ko || '',
    zh: example.zh || '',
  };
}

function normalizeItemToV2(item, recordId, lookup = buildRecordLookup([])) {
  if (!Array.isArray(item.meanings) || !item.meanings.length) {
    throw new Error(`單字「${item.ko || recordId}」缺少 meanings`);
  }

  const meanings = item.meanings.map((meaning, meaningIndex) => {
    const meaningId = meaning.id || `${recordId}-${meaningIndex}`;
    const examples = (meaning.examples || []).map((example, exampleIndex) => normalizeExample(example, `${meaningId}-ex-${exampleIndex}`));
    return {
      id: meaningId,
      zh: meaning.zh || '',
      ...(meaning.pattern ? { pattern: meaning.pattern } : {}),
      examples,
    };
  });

  return {
    ko: item.ko,
    ...(item.pos ? { pos: item.pos } : {}),
    meanings,
    ...(item.notes?.length ? { notes: item.notes } : {}),
    related: resolveRelatedIds(item.related, lookup),
  };
}

function normalizeRecordSet(records) {
  const lookup = buildRecordLookup(records);
  return records.map((record) => ({
    ...record,
    item: normalizeItemToV2(record.item, record.id, lookup),
  }));
}

function itemZh(item) {
  return (item.meanings || []).map((meaning) => meaning.zh).filter(Boolean).join('；');
}

function itemExamples(item) {
  return (item.meanings || []).flatMap((meaning) => meaning.examples || []);
}

function displayRelated(item, allItems = []) {
  const byId = new Map(allItems.map((entry) => [entry.id, entry]));
  return (item.related || []).map((id) => byId.get(id)).filter(Boolean);
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
    zh: itemZh(record.item),
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

function readJsonImportDocument(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 格式錯誤，請確認括號、逗號和引號是否正確');
  }
  if (!Array.isArray(parsed) && parsed?.schemaVersion !== undefined && parsed.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    throw new Error(`JSON schemaVersion 需要是 ${CONTENT_SCHEMA_VERSION}`);
  }
  const data = Array.isArray(parsed) ? parsed : parsed.data;
  if (!Array.isArray(data)) throw new Error('JSON 需要是 { "data": [...] } 或陣列格式');
  return data;
}

function buildJsonImportDraft(text, targetDate) {
  const data = readJsonImportDocument(text);
  if (!data.length) throw new Error('JSON 至少需要包含 1 筆單字');
  const entries = data.map((item, index) => {
    try {
      validateImportItem(item, index);
      return { index, action: 'add', recordId: item.id || `${targetDate}-custom-${createId()}`, item };
    } catch (validationError) {
      return null;
    }
  });
  const invalid = data.map((item, index) => {
    try {
      validateImportItem(item, index);
      return null;
    } catch (validationError) {
      return { index, text: JSON.stringify(item, null, 2), error: validationError.message };
    }
  }).filter(Boolean);
  return { targetDate, entries, invalid, conflict: null, message: '' };
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 需要是物件`);
}

function assertString(value, label, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw new Error(`${label} 是必填`);
    return;
  }
  if (typeof value !== 'string') throw new Error(`${label} 需要是文字`);
  if (required && !value.trim()) throw new Error(`${label} 不可以空白`);
}

function assertSafeInteger(value, label) {
  if (value !== undefined && !Number.isSafeInteger(value)) throw new Error(`${label} 需要是安全整數`);
}

function assertNoUnsupportedKeys(value, allowedKeys, label) {
  const unsupported = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unsupported.length) throw new Error(`${label} 有不支援的欄位：${unsupported.join('、')}`);
}

function assertUniqueIds(values, label) {
  const ids = values.map((value) => value.id).filter(Boolean);
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicated.length) throw new Error(`${label} 有重複 id：${[...new Set(duplicated)].join('、')}`);
}

function validateImportItem(item, itemIndex) {
  const label = `第 ${itemIndex + 1} 筆資料`;
  assertPlainObject(item, label);
  assertNoUnsupportedKeys(item, ['id', 'date', 'order', 'ko', 'pos', 'meanings', 'notes', 'related'], label);
  assertString(item.id, `${label} 的 id`);
  assertString(item.date, `${label} 的 date`);
  assertSafeInteger(item.order, `${label} 的 order`);
  assertString(item.ko, `${label} 的 ko`, { required: true });
  assertString(item.pos, `${label} 的 pos`);

  if (!Array.isArray(item.meanings) || !item.meanings.length) throw new Error(`${label} 需要 meanings，而且至少要有 1 個 meaning`);
  assertUniqueIds(item.meanings, `${label} 的 meanings`);
  item.meanings.forEach((meaning, meaningIndex) => {
    const meaningLabel = `${label} 的第 ${meaningIndex + 1} 個 meaning`;
    assertPlainObject(meaning, meaningLabel);
    assertNoUnsupportedKeys(meaning, ['id', 'zh', 'pattern', 'examples'], meaningLabel);
    assertString(meaning.id, `${meaningLabel} 的 id`);
    assertString(meaning.zh, `${meaningLabel} 的 zh`, { required: true });
    assertString(meaning.pattern, `${meaningLabel} 的 pattern`);
    if (meaning.examples === undefined) return;
    if (!Array.isArray(meaning.examples)) throw new Error(`${meaningLabel} 的 examples 需要是陣列`);
    assertUniqueIds(meaning.examples, `${meaningLabel} 的 examples`);
    meaning.examples.forEach((example, exampleIndex) => {
      const exampleLabel = `${meaningLabel} 的第 ${exampleIndex + 1} 個 example`;
      assertPlainObject(example, exampleLabel);
      assertNoUnsupportedKeys(example, ['id', 'ko', 'zh'], exampleLabel);
      assertString(example.id, `${exampleLabel} 的 id`);
      assertString(example.ko, `${exampleLabel} 的 ko`, { required: true });
      assertString(example.zh, `${exampleLabel} 的 zh`, { required: true });
    });
  });

  if (item.notes !== undefined) {
    if (!Array.isArray(item.notes)) throw new Error(`${label} 的 notes 需要是文字陣列`);
    item.notes.forEach((note, noteIndex) => assertString(note, `${label} 的第 ${noteIndex + 1} 則 note`, { required: true }));
  }
  if (item.related !== undefined) {
    if (!Array.isArray(item.related)) throw new Error(`${label} 的 related 需要是文字陣列`);
    item.related.forEach((related, relatedIndex) => assertString(related, `${label} 的第 ${relatedIndex + 1} 個 related`, { required: true }));
  }
}

function linesToArray(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function parsePairLines(text) {
  const lines = linesToArray(text);
  if (!lines.length) return [];

  // Keep old saved/pasted input usable while the editor now emits line pairs.
  if (lines.every((line) => line.includes('|'))) {
    return lines.map((line, index) => {
      const [ko, ...rest] = line.split('|');
      const zh = rest.join('|').trim();
      if (!ko.trim() || !zh) throw new Error(`第 ${index + 1} 個例句需要韓文和中文`);
      return { ko: ko.trim(), zh };
    });
  }

  if (lines.length % 2 !== 0) {
    throw new Error(`第 ${Math.floor(lines.length / 2) + 1} 個例句缺少中文翻譯`);
  }
  const examples = [];
  for (let index = 0; index < lines.length; index += 2) {
    examples.push({ ko: lines[index], zh: lines[index + 1] });
  }
  return examples;
}

function formatPairLines(examples = []) {
  return examples
    .filter((example) => example.ko || example.zh)
    .map((example) => `${example.ko || ''}\n${example.zh || ''}`)
    .join('\n\n');
}

function createRecordsForDate(date, rawItems, existingItems = []) {
  const now = new Date().toISOString();
  const orderBase = Date.now() * 1000;
  const records = rawItems.map((item, index) => ({
    id: item.id || `${date}-custom-${createId()}`,
    date: item.date || date,
    order: Number.isSafeInteger(item.order) ? item.order : orderBase + index,
    item,
    createdAt: item.createdAt || now,
  }));
  const lookupRecords = [
    ...existingItems.map((item) => ({ id: item.id, item })),
    ...records,
  ];
  const lookup = buildRecordLookup(lookupRecords);
  const knownIds = new Set(lookupRecords.map((record) => record.id));
  const normalized = records.map((record) => ({
    ...record,
    item: normalizeItemToV2(record.item, record.id, lookup),
  }));
  const missingRelated = normalized.flatMap((record) => (record.item.related || []).filter((id) => !knownIds.has(id)));
  if (missingRelated.length) throw new Error(`找不到相關單字：${[...new Set(missingRelated)].join('、')}`);
  return normalized;
}

function createRecordsFromImportEntries(entries, date, existingItems = [], forceDate = false) {
  const now = new Date().toISOString();
  const orderBase = Date.now() * 1000;
  const addRecords = entries.filter((entry) => entry.action === 'add').map((entry) => ({
    id: entry.recordId || entry.item.id,
    date: forceDate ? date : entry.item.date || date,
    order: Number.isSafeInteger(entry.item.order) ? entry.item.order : orderBase + entry.index,
    item: entry.item,
    createdAt: entry.item.createdAt || now,
  }));
  const updateRecords = entries.filter((entry) => entry.action === 'update').map((entry) => ({
    id: entry.existing.id,
    date: entry.existing.date,
    order: Number.isSafeInteger(entry.item.order) ? entry.item.order : orderBase + entry.index,
    item: entry.item,
    createdAt: entry.existing.createdAt || now,
    updatedAt: now,
  }));
  const lookupRecords = [
    ...existingItems.map((item) => ({ id: item.id, item })),
    ...addRecords,
    ...updateRecords,
  ];
  const lookup = buildRecordLookup(lookupRecords);
  const knownIds = new Set(lookupRecords.map((record) => record.id));
  const normalize = (record) => ({
    ...record,
    item: normalizeItemToV2(record.item, record.id, lookup),
  });
  const normalizedAdds = addRecords.map(normalize);
  const normalizedUpdates = updateRecords.map(normalize);
  const missingRelated = [...normalizedAdds, ...normalizedUpdates].flatMap((record) => (record.item.related || []).filter((id) => !knownIds.has(id)));
  if (missingRelated.length) throw new Error(`找不到相關單字：${[...new Set(missingRelated)].join('、')}`);
  return { addRecords: normalizedAdds, updateRecords: normalizedUpdates };
}

function createUpdateRecordsFromEditedJson(text, date, selectedItems, allItems = []) {
  const data = readJsonImportDocument(text);
  data.forEach(validateImportItem);
  const scopeLabel = date ? '這一天' : '目前匯出的';
  const selectedById = new Map(selectedItems.map((item) => [item.id, item]));
  const expectedIds = new Set(selectedItems.map((item) => item.id));
  const editedIds = data.map((item) => item.id).filter(Boolean);
  const duplicateIds = editedIds.filter((id, index) => editedIds.indexOf(id) !== index);
  if (duplicateIds.length) throw new Error(`JSON 中有重複 id：${[...new Set(duplicateIds)].join('、')}`);
  const missingIds = [...expectedIds].filter((id) => !editedIds.includes(id));
  const extraIds = editedIds.filter((id) => !expectedIds.has(id));
  if (missingIds.length) throw new Error(`缺少${scopeLabel}原本的單字 id：${missingIds.join('、')}`);
  if (extraIds.length) throw new Error(`不能在這裡新增或修改${scopeLabel}範圍外的單字 id：${extraIds.join('、')}`);

  const koById = new Map();
  data.forEach((item) => {
    const original = selectedById.get(item.id);
    const expectedDate = date || original?.date;
    if (!item.date) throw new Error(`單字「${item.ko}」需要保留 date`);
    if (item.date !== expectedDate) throw new Error(`單字「${item.ko}」的 date 必須維持 ${expectedDate}`);
    const normalizedKo = normalizeKoreanKey(item.ko);
    const existingId = koById.get(normalizedKo);
    if (existingId && existingId !== item.id) throw new Error(`JSON 中有重複韓文單字：${normalizedKo}`);
    koById.set(normalizedKo, item.id);
  });
  const duplicateExisting = allItems.find((item) => !expectedIds.has(item.id) && koById.has(normalizeKoreanKey(item.ko)));
  if (duplicateExisting) throw new Error(`韓文單字「${duplicateExisting.ko}」已存在於其他單字卡，請不要改成重複單字。`);

  const now = new Date().toISOString();
  const records = data.map((item) => {
    const original = selectedById.get(item.id);
    const recordDate = date || original.date;
    return {
      id: original.id,
      date: recordDate,
      order: Number.isSafeInteger(item.order) ? item.order : recordOrder(original),
      item: { ...item, date: recordDate },
      createdAt: original.createdAt || now,
      updatedAt: now,
    };
  });
  const editedIdSet = new Set(records.map((record) => record.id));
  const lookupRecords = [
    ...allItems.filter((item) => !editedIdSet.has(item.id)).map((item) => ({ id: item.id, item })),
    ...records,
  ];
  const lookup = buildRecordLookup(lookupRecords);
  const knownIds = new Set(lookupRecords.map((record) => record.id));
  const normalized = records.map((record) => ({
    ...record,
    item: normalizeItemToV2(record.item, record.id, lookup),
  }));
  const missingRelated = normalized.flatMap((record) => (record.item.related || []).filter((id) => !knownIds.has(id)));
  if (missingRelated.length) throw new Error(`找不到相關單字：${[...new Set(missingRelated)].join('、')}`);
  return normalized;
}

function comparableItemSnapshot(item) {
  return {
    order: item.order,
    ko: item.ko || '',
    pos: item.pos || '',
    meanings: item.meanings || [],
    notes: item.notes || [],
    related: item.related || [],
  };
}

function jsonEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function summarizeEditedJsonChanges(originalItems, records) {
  const originalById = new Map(originalItems.map((item) => [item.id, item]));
  return records.map((record) => {
    const original = originalById.get(record.id);
    const next = { ...record.item, id: record.id, date: record.date, order: record.order };
    const fields = [];
    if (!jsonEqual(original?.order, next.order)) fields.push('排序');
    if (!jsonEqual(original?.ko, next.ko)) fields.push('韓文');
    if (!jsonEqual(original?.pos || '', next.pos || '')) fields.push('詞性');
    if (!jsonEqual(original?.meanings || [], next.meanings || [])) fields.push('意思/例句');
    if (!jsonEqual(original?.notes || [], next.notes || [])) fields.push('筆記');
    if (!jsonEqual(original?.related || [], next.related || [])) fields.push('相關詞');
    if (!fields.length && jsonEqual(comparableItemSnapshot(original), comparableItemSnapshot(next))) return null;
    return {
      id: record.id,
      beforeKo: original?.ko || record.id,
      afterKo: next.ko || record.id,
      fields,
    };
  }).filter(Boolean);
}

function findMissingImportRelated(entries, existingItems = []) {
  const activeEntries = entries.filter(Boolean);
  const knownIds = new Set(existingItems.map((item) => item.id).filter(Boolean));
  const knownKo = new Set(existingItems.map((item) => normalizeKoreanKey(item.ko)).filter(Boolean));
  activeEntries.forEach((entry) => {
    const entryId = entry.action === 'update' ? entry.existing?.id : entry.recordId;
    if (entryId) knownIds.add(entryId);
    if (entry.item.ko) knownKo.add(normalizeKoreanKey(entry.item.ko));
  });
  return activeEntries.map((entry, position) => {
    const missing = (entry.item.related || [])
      .map((related) => related.trim())
      .filter((related) => related && !knownIds.has(related) && !knownKo.has(normalizeKoreanKey(related)));
    if (!missing.length) return null;
    return { position, ko: entry.item.ko, missing: [...new Set(missing)] };
  }).filter(Boolean);
}

function clearMissingImportRelated(entries, missingRelated) {
  const missingByPosition = new Map(missingRelated.map((issue) => [issue.position, new Set(issue.missing)]));
  return entries.filter(Boolean).map((entry, position) => {
    const missingSet = missingByPosition.get(position);
    if (!missingSet) return entry;
    const nextRelated = (entry.item.related || []).filter((related) => !missingSet.has(related.trim()));
    const nextItem = { ...entry.item };
    if (nextRelated.length) nextItem.related = nextRelated;
    else delete nextItem.related;
    return { ...entry, item: nextItem };
  });
}

function findImportConflict(entries, existingItems = []) {
  const activeEntries = entries.map((entry, position) => (entry ? { ...entry, position } : null)).filter(Boolean);
  for (let index = 0; index < activeEntries.length; index += 1) {
    const current = activeEntries[index];
    const currentKo = normalizeKoreanKey(current.item.ko);
    const duplicateIndex = activeEntries.findIndex((entry, candidateIndex) => candidateIndex < index && (
      entry.recordId === current.recordId || normalizeKoreanKey(entry.item.ko) === currentKo
    ));
    if (duplicateIndex >= 0) {
      const other = activeEntries[duplicateIndex];
      return {
        type: 'input',
        reason: other.recordId === current.recordId ? 'id' : 'ko',
        leftRecordId: other.recordId,
        rightRecordId: current.recordId,
        leftEntryIndex: other.position,
        rightEntryIndex: current.position,
        left: other.item,
        right: current.item,
        editText: JSON.stringify(mergeImportItems(other.item, current.item), null, 2),
        error: '',
      };
    }
    if (current.action === 'add') {
      const existing = existingItems.find((item) => item.id === current.recordId || normalizeKoreanKey(item.ko) === currentKo);
      if (existing) {
        return {
          type: 'existing',
          reason: existing.id === current.recordId ? 'id' : 'ko',
          entryIndex: current.position,
          existing,
          incoming: current.item,
          editText: JSON.stringify(mergeImportItems(existing, current.item), null, 2),
          error: '',
        };
      }
    }
  }
  return null;
}

function findUpdateKoreanCollision(entries, existingItems = []) {
  for (const entry of entries.filter(Boolean)) {
    if (entry.action !== 'update') continue;
    const collision = existingItems.find((item) => (
      item.id !== entry.existing.id && normalizeKoreanKey(item.ko) === normalizeKoreanKey(entry.item.ko)
    ));
    if (collision) return { entry, collision };
  }
  return null;
}

function stripGeneratedIdsFromMeaning(meaning) {
  const { id, examples = [], ...content } = meaning;
  return {
    ...content,
    examples: examples.map((example) => {
      const { id: exampleId, ...exampleContent } = example;
      return exampleContent;
    }),
  };
}

function mergeImportItems(left, right) {
  const notes = [...new Set([...(left.notes || []), ...(right.notes || [])].filter(Boolean))];
  const related = [...new Set([...(left.related || []), ...(right.related || [])].filter(Boolean))];
  return {
    ko: right.ko || left.ko,
    ...(right.pos || left.pos ? { pos: right.pos || left.pos } : {}),
    meanings: [
      ...(left.meanings || []).map(stripGeneratedIdsFromMeaning),
      ...(right.meanings || []).map(stripGeneratedIdsFromMeaning),
    ],
    ...(notes.length ? { notes } : {}),
    ...(related.length ? { related } : {}),
  };
}

function parseEditedImportItem(text, label = '編輯後的單字') {
  let item;
  try {
    item = JSON.parse(text);
  } catch {
    throw new Error(`${label} JSON 格式錯誤`);
  }
  validateImportItem(item, 0);
  return item;
}

function formatSingleWordJson(item) {
  const content = {
    ko: item.ko,
    ...(item.pos ? { pos: item.pos } : {}),
    meanings: (item.meanings || []).map((meaning) => ({
      zh: meaning.zh,
      ...(meaning.pattern ? { pattern: meaning.pattern } : {}),
      examples: (meaning.examples || []).map(({ ko, zh }) => ({ ko, zh })),
    })),
    notes: item.notes || [],
    ...(item.related?.length ? { related: item.related } : {}),
  };
  return JSON.stringify({ schemaVersion: CONTENT_SCHEMA_VERSION, data: [content] }, null, 2);
}

function parseSingleWordEditJson(text, original, allItems = []) {
  const data = readJsonImportDocument(text);
  if (data.length !== 1) throw new Error('編輯單字的 data 必須只包含 1 筆單字');
  const input = data[0];
  validateImportItem(input, 0);
  if (input.id && input.id !== original.id) throw new Error('不能修改這張單字卡的 ID');
  if (input.date && input.date !== original.date) throw new Error('請使用日期欄位修改日期');
  const collision = allItems.find((item) => item.id !== original.id && normalizeKoreanKey(item.ko) === normalizeKoreanKey(input.ko));
  if (collision) throw new Error(`韓文「${input.ko}」與既有單字重複，請編輯既有單字卡`);
  const usedMeaningIds = new Set();
  const meanings = input.meanings.map((meaning, index) => {
    const previous = (original.meanings || []).find((entry) => (
      !usedMeaningIds.has(entry.id) && (meaning.id ? entry.id === meaning.id : entry.zh === meaning.zh)
    )) || (!usedMeaningIds.has(original.meanings?.[index]?.id) ? original.meanings?.[index] : null);
    const id = previous?.id || `${original.id}-meaning-${createId()}`;
    usedMeaningIds.add(id);
    const usedExampleIds = new Set();
    return {
      ...meaning,
      id,
      examples: (meaning.examples || []).map((example) => {
        const existing = (previous?.examples || []).find((entry) => (
          !usedExampleIds.has(entry.id) && (example.id ? entry.id === example.id : entry.ko === example.ko && entry.zh === example.zh)
        ));
        const exampleId = existing?.id || `${id}-ex-${createId()}`;
        usedExampleIds.add(exampleId);
        return { ...example, id: exampleId };
      }),
    };
  });
  const lookup = buildRecordLookup(allItems.map((item) => ({ id: item.id, item })));
  const item = normalizeItemToV2({ ...input, ko: input.ko.trim(), meanings }, original.id, lookup);
  if (item.related.some((id) => id === original.id || !allItems.some((entry) => entry.id === id))) {
    throw new Error('相關詞必須是其他已存在的單字卡');
  }
  return item;
}

function resolveImportConflictDraft(draft, choice, allItems = []) {
  const conflict = draft.conflict;
  if (!conflict) throw new Error('目前沒有需要處理的衝突');
  const nextEntries = [...draft.entries];
  const keptExistingIds = [...new Set(draft.keptExistingIds || [])];
  const editedItem = choice === 'edit' ? parseEditedImportItem(conflict.editText, '最終結果') : null;
  if (conflict.type === 'existing') {
    if (choice === 'existing') {
      keptExistingIds.push(conflict.existing.id);
      nextEntries[conflict.entryIndex] = null;
    } else {
      const item = choice === 'incoming' ? conflict.incoming : choice === 'merge' ? mergeImportItems(conflict.existing, conflict.incoming) : editedItem;
      nextEntries[conflict.entryIndex] = { index: conflict.entryIndex, action: 'update', recordId: conflict.existing.id, existing: conflict.existing, item };
    }
  } else if (choice === 'left') {
    nextEntries[conflict.rightEntryIndex] = null;
  } else if (choice === 'right') {
    nextEntries[conflict.leftEntryIndex] = { ...nextEntries[conflict.rightEntryIndex], index: conflict.leftEntryIndex };
    nextEntries[conflict.rightEntryIndex] = null;
  } else {
    const item = choice === 'merge' ? mergeImportItems(conflict.left, conflict.right) : editedItem;
    nextEntries[conflict.leftEntryIndex] = {
      ...nextEntries[conflict.leftEntryIndex],
      recordId: choice === 'edit' && editedItem.id ? editedItem.id : nextEntries[conflict.leftEntryIndex].recordId,
      item,
    };
    nextEntries[conflict.rightEntryIndex] = null;
  }
  const activeEntries = nextEntries.filter(Boolean);
  const updateCollision = findUpdateKoreanCollision(activeEntries, allItems);
  if (updateCollision) throw new Error(`最終結果「${updateCollision.entry.item.ko}」會和既有單字重複`);
  const nextConflict = findImportConflict(activeEntries, allItems);
  const nextMissingRelated = nextConflict ? [] : findMissingImportRelated(activeEntries, allItems);
  return {
    ...draft,
    entries: activeEntries,
    keptExistingIds: [...new Set(keptExistingIds)],
    conflict: nextConflict,
    missingRelated: nextMissingRelated.length ? nextMissingRelated : null,
    message: nextConflict ? '已處理一組重複單字，請繼續處理下一組' : nextMissingRelated.length ? '重複單字已處理，請處理找不到的關聯詞' : '所有問題都已處理，可以匯入',
  };
}

async function writeLearningRecords(uid, records, onProgress, folderIds = [], additionalFolderWordIds = [], foldersToCreate = [], folderPatches = [], removeFolderIds = []) {
  let queuedOffline = isBrowserOffline();
  const uniqueFolderIds = [...new Set(folderIds)].filter(Boolean);
  const extraWordIds = [...new Set(additionalFolderWordIds)].filter(Boolean);
  const newFolders = foldersToCreate.filter((folder) => folder?.id && folder?.name);
  const normalizedFolderPatches = folderPatches
    .filter((patch) => patch?.id)
    .map((patch) => ({ id: String(patch.id), data: patch.data || {} }));
  const uniqueRemoveFolderIds = [...new Set(removeFolderIds)].filter(Boolean);
  if (!records.length && (!uniqueFolderIds.length || !extraWordIds.length) && !newFolders.length && !normalizedFolderPatches.length && !uniqueRemoveFolderIds.length) return;
  if (records.length > MAX_ATOMIC_RECORD_WRITES) {
    throw new Error(`一次最多可以寫入 ${MAX_ATOMIC_RECORD_WRITES} 筆單字，請縮小匯入範圍`);
  }
  if (records.length + uniqueFolderIds.length + newFolders.length + normalizedFolderPatches.length + uniqueRemoveFolderIds.length > 500) throw new Error('單字與資料夾更新超過 Firebase 單次批次上限');
  const newFolderIds = newFolders.map((folder) => folder.id);
  const patchedFolderIds = normalizedFolderPatches.map((patch) => patch.id);
  const allFolderIds = [...uniqueFolderIds, ...newFolderIds, ...patchedFolderIds];
  if (new Set(newFolderIds).size !== newFolderIds.length || new Set(patchedFolderIds).size !== patchedFolderIds.length || new Set(allFolderIds).size !== allFolderIds.length) {
    throw new Error('資料夾寫入資料有重複 ID');
  }
  if (uniqueRemoveFolderIds.some((folderId) => allFolderIds.includes(folderId))) {
    throw new Error('同一個資料夾不能同時加入及移除單字');
  }
  const lookup = buildRecordLookup(records);
  const normalizedRecords = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    onProgress?.({
      phase: 'preparing',
      current: index + 1,
      total: records.length,
      ko: record.item?.ko || record.id,
      detail: `正在整理第 ${index + 1}/${records.length} 筆：${record.item?.ko || record.id}`,
    });
    normalizedRecords.push({ ...record, item: normalizeItemToV2(record.item, record.id, lookup) });
    if (onProgress) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const recordIds = [...new Set([...normalizedRecords.map((record) => record.id), ...extraWordIds])];
  if (recordIds.some((recordId) => !recordId)) throw new Error('寫入資料缺少必要的單字 ID');
  if (new Set(recordIds).size !== recordIds.length) throw new Error('寫入資料中含有重複的單字 ID');
  const normalizedNewFolders = newFolders.map((folder) => normalizeFolder({
    ...folder,
    wordIds: [...new Set([...(folder.wordIds || []), ...recordIds])],
  }, folder.id));
  onProgress?.({
    phase: 'uploading',
    current: records.length,
    total: records.length,
    detail: `已準備 ${records.length} 筆，正在以單一批次送往 Firebase，等待伺服器確認`,
  });
  const uploadStartedAt = Date.now();
  const waitingTimer = onProgress ? setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - uploadStartedAt) / 1000));
    onProgress({
      phase: 'uploading',
      current: records.length,
      total: records.length,
      detail: `Firebase 批次已送出，已等待 ${elapsedSeconds} 秒；請保持視窗開啟`,
    });
  }, 5000) : null;
  try {
    const writeResult = await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      normalizedRecords.forEach((record) => batch.set(
        doc(db, 'users', uid, 'records', record.id),
        { ...record, updatedAt: serverTimestamp() },
      ));
      uniqueFolderIds.forEach((folderId) => batch.set(
        doc(db, 'users', uid, 'folders', folderId),
        { wordIds: arrayUnion(...recordIds), updatedAt: serverTimestamp() },
        { merge: true },
      ));
      uniqueRemoveFolderIds.forEach((folderId) => batch.set(
        doc(db, 'users', uid, 'folders', folderId),
        { wordIds: arrayRemove(...recordIds), updatedAt: serverTimestamp() },
        { merge: true },
      ));
      normalizedNewFolders.forEach((folder) => batch.set(
        doc(db, 'users', uid, 'folders', folder.id),
        { ...folder, updatedAt: serverTimestamp() },
      ));
      normalizedFolderPatches.forEach((patch) => batch.set(
        doc(db, 'users', uid, 'folders', patch.id),
        { ...patch.data, wordIds: arrayUnion(...recordIds), updatedAt: serverTimestamp() },
        { merge: true },
      ));
      await batch.commit();
    });
    if (writeResult?.queuedOffline) queuedOffline = true;
  } finally {
    if (waitingTimer) clearInterval(waitingTimer);
  }
  onProgress?.({
    phase: 'success',
    current: records.length,
    total: records.length,
    detail: queuedOffline
      ? `已將 ${records.length} 筆變更儲存在此裝置，恢復連線後會自動同步`
      : `Firebase 已確認完成 ${records.length} 筆寫入`,
  });
}

async function writeSourceLearningRecords(uid, records, folders, { folderId, folderName, tag }, { markLearned = false } = {}) {
  const learnedFolderId = folders.find(isLearnedFolder)?.id || SYSTEM_LEARNED_FOLDER_ID;
  const targetFolderIds = markLearned ? [learnedFolderId] : [];
  const matchingFolder = folders.find((folder) => !isSystemFolder(folder) && folder.name.toLocaleLowerCase() === folderName.toLocaleLowerCase());
  if (matchingFolder) {
    return writeLearningRecords(uid, records, undefined, targetFolderIds, [], [], [{
      id: matchingFolder.id,
      data: { tag },
    }]);
  }
  const now = new Date().toISOString();
  const folder = normalizeFolder({
    id: folderId,
    name: folderName,
    tag,
    wordIds: records.map((record) => record.id),
    createdAt: now,
    updatedAt: now,
  });
  return writeLearningRecords(uid, records, undefined, targetFolderIds, [], [folder]);
}

async function writeYoutubeSubtitleLearningRecords(uid, records, folders = [], options = {}) {
  return writeSourceLearningRecords(uid, records, folders, {
    folderId: YT_SOURCE_FOLDER_ID,
    folderName: YT_SOURCE_FOLDER_NAME,
    tag: YT_SOURCE_FOLDER_NAME,
  }, options);
}

async function writeReadingTestLearningRecords(uid, records, folders = [], options = {}) {
  return writeSourceLearningRecords(uid, records, folders, {
    folderId: READING_SOURCE_FOLDER_ID,
    folderName: READING_SOURCE_FOLDER_NAME,
    tag: READING_SOURCE_FOLDER_NAME,
  }, options);
}

async function writeLearningRecord(uid, record, onProgress, folderIds = []) {
  await writeLearningRecords(uid, [record], onProgress, folderIds);
}

async function deleteLearningRecords(uid, recordIds, folders = []) {
  const ids = [...new Set(recordIds.filter(Boolean))];
  if (!ids.length) return;
  const affectedFolders = folders.filter((folder) => folder.wordIds.some((wordId) => ids.includes(wordId)));
  if (ids.length + affectedFolders.length > 500) throw new Error('這次刪除超過 Firebase 單次批次上限，請縮小選取範圍');
  await retryFirestoreWrite(async () => {
    const batch = writeBatch(db);
    ids.forEach((recordId) => batch.set(
      doc(db, 'users', uid, 'records', recordId),
      {
        id: recordId,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        item: deleteField(),
        date: deleteField(),
        createdAt: deleteField(),
        order: deleteField(),
      },
      { merge: true },
    ));
    affectedFolders.forEach((folder) => batch.set(
      doc(db, 'users', uid, 'folders', folder.id),
      { wordIds: arrayRemove(...ids), updatedAt: serverTimestamp() },
      { merge: true },
    ));
    await batch.commit();
  });
}

async function deleteLearningRecord(uid, recordId, folders = []) {
  await deleteLearningRecords(uid, [recordId], folders);
}

function getStats(store, id) {
  const stats = store.stats[id] || { total: 0, correct: 0, wrong: 0 };
  const score = familiarityScore(stats);
  return { ...stats, score, level: familiarityLevel(score) };
}

function rankTermQuestionsByFamiliarity(store, questions = []) {
  const questionIdsByItem = new Map();
  questions.forEach((question) => {
    if (!question?.itemId) return;
    const ids = questionIdsByItem.get(question.itemId) || [];
    ids.push(question.id);
    questionIdsByItem.set(question.itemId, ids);
  });
  const seenItems = new Set();
  return questions
    .filter((question) => {
      if (question.kind !== 'term' || seenItems.has(question.itemId)) return false;
      seenItems.add(question.itemId);
      return true;
    })
    .map((question) => ({
      question,
      score: aggregateItemStats(store, questionIdsByItem.get(question.itemId) || [question.id]).score,
    }))
    .sort((left, right) => (
      left.score - right.score
      || compareQuestionsByKoreanAlphabet(left.question, right.question)
    ));
}

function lowestFamiliarityTermQuestions(store, questions = [], limit = 30) {
  return rankTermQuestionsByFamiliarity(store, questions)
    .slice(0, Math.max(0, limit))
    .map(({ question }) => question);
}

function unfamiliarTermQuestionCount(store, questions = []) {
  return rankTermQuestionsByFamiliarity(store, questions)
    .filter(({ score }) => score < 0)
    .length;
}

function familiarityScore(stats = {}) {
  const correct = Number(stats.correct) || 0;
  const wrong = Number.isFinite(Number(stats.wrong))
    ? Number(stats.wrong)
    : Math.max(0, (Number(stats.total) || 0) - correct);
  return correct - wrong;
}

function familiarityLevel(score) {
  if (score < 0) return '不熟悉';
  if (score >= 5) return '已熟悉';
  if (score >= 3) return '熟悉';
  return '學習中';
}

const FAMILIARITY_FILTER_OPTIONS = [
  { value: 'score-negative-1', label: '熟悉度 -1' },
  { value: 'score-negative-2', label: '熟悉度 -2' },
  { value: 'score-negative-3', label: '熟悉度 -3' },
  { value: 'score-negative-4-or-less', label: '熟悉度 -4 以下' },
  { value: '學習中', label: '學習中' },
  { value: '熟悉', label: '熟悉' },
  { value: '已熟悉', label: '已熟悉' },
];

function familiarityFilterValue(level, score) {
  if (level !== '不熟悉') return level;
  if (score === -1) return 'score-negative-1';
  if (score === -2) return 'score-negative-2';
  if (score === -3) return 'score-negative-3';
  return 'score-negative-4-or-less';
}

function matchesFamiliarityLevels(level, selectedLevels = [], score = 0) {
  return !selectedLevels.length || selectedLevels.includes(familiarityFilterValue(level, score));
}

function folderFilterWordIds(folders = [], selectedFolderIds = []) {
  if (!selectedFolderIds.length) return null;
  const selected = new Set(selectedFolderIds);
  return new Set(
    folders
      .filter((folder) => selected.has(folder.id))
      .flatMap((folder) => folder.wordIds || []),
  );
}

const UNFILED_FOLDER_FILTER_ID = '__unfiled__';

function filterItemsByFolderSelection(items = [], folders = [], selectedFolderIds = []) {
  if (!selectedFolderIds.length) return items;
  const selected = new Set(selectedFolderIds);
  const selectedFolderWordIds = folderFilterWordIds(
    folders,
    selectedFolderIds.filter((folderId) => folderId !== UNFILED_FOLDER_FILTER_ID),
  ) || new Set();
  const allFolderWordIds = selected.has(UNFILED_FOLDER_FILTER_ID)
    ? new Set(folders.flatMap((folder) => folder.wordIds || []))
    : null;

  return items.filter((item) => (
    selectedFolderWordIds.has(item.id)
    || (allFolderWordIds && !allFolderWordIds.has(item.id))
  ));
}

function wordFolderIds(folders = [], wordId) {
  if (!wordId) return [];
  return folders
    .filter((folder) => (folder.wordIds || []).includes(wordId))
    .map((folder) => folder.id);
}

function selectedFoldersFirst(folders = [], selectedFolderIds = []) {
  const selected = new Set(selectedFolderIds);
  return folders
    .map((folder, index) => ({ folder, index }))
    .sort((left, right) => (
      Number(selected.has(right.folder.id)) - Number(selected.has(left.folder.id))
      || left.index - right.index
    ))
    .map(({ folder }) => folder);
}

function folderMembershipChanges(folders = [], wordId, desiredFolderIds = []) {
  const currentSet = new Set(wordFolderIds(folders, wordId));
  const desiredSet = new Set(desiredFolderIds);
  return {
    add: [...desiredSet].filter((folderId) => !currentSet.has(folderId)),
    remove: [...currentSet].filter((folderId) => !desiredSet.has(folderId)),
  };
}

function aggregateItemStats(store, questionIds) {
  const stats = questionIds.map((id) => getStats(store, id));
  const total = stats.reduce((sum, current) => sum + (current.total || 0), 0);
  const correct = stats.reduce((sum, current) => sum + (current.correct || 0), 0);
  const wrong = stats.reduce((sum, current) => (
    sum + (Number.isFinite(Number(current.wrong)) ? Number(current.wrong) : Math.max(0, (current.total || 0) - (current.correct || 0)))
  ), 0);
  const score = correct - wrong;
  return { total, correct, wrong, score, level: familiarityLevel(score) };
}

function getProgress(store, question) {
  const saved = store.progress[question.id];
  if (saved) return saved;
  return {
    stage: 0,
    nextDue: addDays(question.date, REVIEW_INTERVALS[0]),
    lastResult: null,
    lastAnsweredAt: null,
  };
}

function dueQuestions(store, questions, date = todayString()) {
  return questions.filter((question) => getProgress(store, question).nextDue <= date);
}

function orderReviewQuestions(questions) {
  const kindRank = { term: 0, example: 1 };
  return [...questions].sort((a, b) => {
    const kindDiff = (kindRank[a.kind] ?? 99) - (kindRank[b.kind] ?? 99);
    if (kindDiff) return kindDiff;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const aIndex = a.source?.index ?? 0;
    const bIndex = b.source?.index ?? 0;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.id.localeCompare(b.id);
  });
}

function reviewQuestions(questions) {
  return orderReviewQuestions(questions.filter((question) => question.kind === 'term' || question.kind === 'example'));
}

function folderWordIdsInclude(wordIds, itemId) {
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) return false;
  if (wordIds instanceof Set) return wordIds.has(normalizedItemId);
  return Array.isArray(wordIds) && wordIds.some((wordId) => String(wordId || '').trim() === normalizedItemId);
}

function excludeLearnedQuestions(questions, learnedWordIds = []) {
  return questions.filter((question) => !folderWordIdsInclude(learnedWordIds, question.itemId));
}

function dailyReviewQuestions(store, questions, date = todayString()) {
  const terms = questions.filter((question) => question.kind === 'term');
  return orderReviewQuestions(dueQuestions(store, terms, date));
}

function dailyWrongTermQuestions(store, questions, date = todayString()) {
  const termById = new Map(
    questions
      .filter((question) => question.kind === 'term')
      .map((question) => [question.id, question]),
  );
  const wrongIds = new Set();
  [...(store.attempts || [])]
    .filter((attempt) => attemptDate(attempt) === date)
    .sort((left, right) => String(left.time || '').localeCompare(String(right.time || '')))
    .forEach((attempt) => {
      const questionId = String(attempt.questionId || '');
      if (!questionId) return;
      if (attempt.mode === DAILY_WRONG_REVIEW_MODE) {
        if (attempt.correct) wrongIds.delete(questionId);
        else wrongIds.add(questionId);
        return;
      }
      if (attempt.correct === false) wrongIds.add(questionId);
    });
  return [...wrongIds]
    .map((questionId) => termById.get(questionId))
    .filter(Boolean)
    .sort(compareQuestionsByKoreanAlphabet);
}

function seedFromString(text) {
  return [...text].reduce((seed, char) => ((seed * 31) + char.charCodeAt(0)) % 233280, 17);
}

function replayRoundAttempts(attempts, questionIds) {
  const correctIds = new Set();
  const pendingWrongIds = new Set();
  let roundCompletedOn = '';
  [...attempts].sort((a, b) => (a.time || '').localeCompare(b.time || '')).forEach((attempt) => {
    if (!questionIds.has(attempt.questionId)) return;
    if (attempt.correct) {
      correctIds.add(attempt.questionId);
      pendingWrongIds.delete(attempt.questionId);
    } else {
      correctIds.delete(attempt.questionId);
      pendingWrongIds.add(attempt.questionId);
    }
    if (correctIds.size === questionIds.size) roundCompletedOn = attemptDate(attempt);
  });
  return { correctIds, pendingWrongIds, roundCompletedOn };
}

function dailyRoundSchedule(store, questions, {
  stateKey,
  mode,
  date = todayString(),
  limit,
}) {
  if (!questions.length) return { state: null, questions: [] };
  const questionIds = new Set(questions.map((question) => question.id));
  const roundAttempts = (store.attempts || [])
    .filter((attempt) => attempt.mode === mode && questionIds.has(attempt.questionId));
  let state = store[stateKey];
  if (!state) {
    const previous = replayRoundAttempts(
      roundAttempts.filter((attempt) => attemptDate(attempt) < date),
      questionIds,
    );
    state = {
      correctIds: [...previous.correctIds],
      pendingWrongIds: [...previous.pendingWrongIds],
      roundCompletedOn: previous.roundCompletedOn,
      dailyDate: '',
      assignmentIds: [],
      answeredIds: [],
    };
  }

  let correctIds = new Set((state.correctIds || []).filter((id) => questionIds.has(id)));
  let pendingWrongIds = new Set((state.pendingWrongIds || []).filter((id) => questionIds.has(id)));
  let roundCompletedOn = state.roundCompletedOn || '';
  if (correctIds.size === questionIds.size && !roundCompletedOn) roundCompletedOn = state.dailyDate || date;
  if (state.dailyDate !== date && roundCompletedOn && roundCompletedOn < date) {
    correctIds = new Set();
    pendingWrongIds = new Set();
    roundCompletedOn = '';
  }

  const attemptsToday = roundAttempts
    .filter((attempt) => attemptDate(attempt) === date)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const attemptedIds = [...new Set(attemptsToday.map((attempt) => attempt.questionId))];
  let assignmentIds = (state.assignmentIds || []).filter((id) => questionIds.has(id));
  if (state.dailyDate !== date || (!assignmentIds.length && !attemptedIds.length)) {
    const wrong = shuffleItems(
      questions.filter((question) => pendingWrongIds.has(question.id)),
      seedFromString(`${date}-${mode}-wrong`),
    ).slice(0, limit);
    const wrongIds = new Set(wrong.map((question) => question.id));
    const unseen = questions.filter((question) => !correctIds.has(question.id) && !wrongIds.has(question.id));
    assignmentIds = shuffleItems([
      ...wrong,
      ...shuffleItems(unseen, seedFromString(`${date}-${mode}-unseen`)).slice(0, Math.max(0, limit - wrong.length)),
    ], seedFromString(`${date}-${mode}-assignment`)).map((question) => question.id);
  }
  // Today's attempt log is authoritative. It prevents a stale settings
  // snapshot from replacing the assignment and creating more than the daily limit.
  const assignmentLimit = Math.max(limit, attemptedIds.length);
  assignmentIds = [
    ...attemptedIds,
    ...assignmentIds.filter((id) => !attemptedIds.includes(id)),
  ].slice(0, assignmentLimit);
  const answeredIds = new Set(attemptedIds);
  attemptsToday.forEach((attempt) => {
    if (attempt.correct) {
      correctIds.add(attempt.questionId);
      pendingWrongIds.delete(attempt.questionId);
    } else {
      correctIds.delete(attempt.questionId);
      pendingWrongIds.add(attempt.questionId);
    }
  });
  if (correctIds.size === questionIds.size) roundCompletedOn = date;

  const nextState = {
    correctIds: [...correctIds].sort(),
    pendingWrongIds: [...pendingWrongIds].sort(),
    roundCompletedOn,
    dailyDate: date,
    assignmentIds,
    answeredIds: [...answeredIds],
  };
  const byId = new Map(questions.map((question) => [question.id, question]));
  return {
    state: nextState,
    questions: assignmentIds.filter((id) => !answeredIds.has(id)).map((id) => byId.get(id)).filter(Boolean),
  };
}

function dailyRecognitionSchedule(store, questions, date = todayString(), limit = DAILY_RECOGNITION_LIMIT) {
  const examples = orderReviewQuestions(questions.filter((question) => question.kind === 'example'));
  return dailyRoundSchedule(store, examples, {
    stateKey: 'recognition',
    mode: DAILY_RECOGNITION_MODE,
    date,
    limit,
  });
}

function shouldInitializeDailyRecognition(recognition, date = todayString()) {
  return !recognition || recognition.dailyDate !== date;
}

function nextRecognitionRevealState(listeningMode, wordVisible, revealed) {
  if (revealed) return { wordVisible: true, revealed: true };
  if (listeningMode && !wordVisible) return { wordVisible: true, revealed: false };
  return { wordVisible: true, revealed: true };
}

function grammarPracticeQuestions(notes) {
  return notes.flatMap((note) => (note.examples || [])
    .filter((example) => example.ko?.trim() && example.zh?.trim())
    .map((example, index) => ({
      id: `grammar:${note.id}:${example.id || index}`,
      itemId: note.id,
      kind: 'grammar-example',
      ko: example.ko.trim(),
      zh: example.zh.trim(),
      source: note,
    })));
}

function dailyGrammarSchedule(notes, review, date = todayString()) {
  if (review?.completedDate === date) return { note: null, questions: [] };
  const eligible = notes
    .filter((note) => note.category !== NOTE_CATEGORY_VOCABULARY)
    .map((note) => ({
      ...note,
      examples: (note.examples || []).filter((example) => example.ko && example.zh),
    }))
    .filter((note) => note.examples.length)
    .sort((a, b) => (
      (a.createdAt || '').localeCompare(b.createdAt || '')
      || a.id.localeCompare(b.id)
    ));
  if (!eligible.length) return { note: null, questions: [] };

  const lastIndex = eligible.findIndex((note) => note.id === review?.lastCompletedGrammarId);
  let note;
  if (lastIndex >= 0) {
    note = eligible[(lastIndex + 1) % eligible.length];
  } else if (review?.lastCompletedCreatedAt) {
    note = eligible.find((candidate) => candidate.createdAt > review.lastCompletedCreatedAt) || eligible[0];
  } else {
    note = eligible[0];
  }

  return {
    note,
    questions: grammarPracticeQuestions([note]),
  };
}

function groupTasks(store, questions, date = todayString()) {
  const groups = new Map();
  questions.forEach((question) => {
    const progress = getProgress(store, question);
    const dueDate = progress.nextDue;
    const key = `${question.date}-${dueDate}`;
    const existing = groups.get(key) || {
      id: key,
      studyDate: question.date,
      dueDate,
      questions: [],
      overdue: dueDate < date,
    };
    existing.questions.push(question);
    existing.overdue = existing.overdue || dueDate < date;
    groups.set(key, existing);
  });
  return [...groups.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function markReviewDateComplete(store, date = todayString()) {
  const completedReviewDates = store.completedReviewDates || [];
  if (completedReviewDates.includes(date)) return store;
  return {
    ...store,
    completedReviewDates: [...completedReviewDates, date].sort(),
  };
}

function isDailyWordReviewComplete(dueWordQuestions = []) {
  return dueWordQuestions.length === 0;
}

function toggleStarredItem(updateStore, itemId) {
  updateStore((current) => {
    const starred = current.starred || [];
    const nextStarred = starred.includes(itemId)
      ? starred.filter((id) => id !== itemId)
      : [...starred, itemId];
    return { ...current, starred: nextStarred };
  });
}

function calculateReviewStreaks(completedReviewDates, today = todayString()) {
  const completed = new Set(completedReviewDates || []);
  const countBackFrom = (startDate) => {
    let count = 0;
    let cursor = startDate;
    while (completed.has(cursor)) {
      count += 1;
      cursor = addDays(cursor, -1);
    }
    return count;
  };

  const current = completed.has(today) ? countBackFrom(today) : countBackFrom(addDays(today, -1));
  const sortedDates = [...completed].sort();
  let best = 0;
  let run = 0;
  let previous = '';
  sortedDates.forEach((date) => {
    run = previous && addDays(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  });
  return { current, best };
}

function recordAnswer(store, question, correct) {
  const now = new Date().toISOString();
  const answerDate = todayString();
  const previous = getProgress(store, question);
  const previousStats = store.stats[question.id] || {};
  const nextStats = {
    ...previousStats,
    total: (previousStats.total || 0) + 1,
    correct: (previousStats.correct || 0) + (correct ? 1 : 0),
    wrong: (previousStats.wrong || 0) + (correct ? 0 : 1),
    lastAnsweredAt: now,
    lastResult: correct ? 'correct' : 'wrong',
  };
  const previousScore = familiarityScore(previousStats);
  const nextScore = familiarityScore(nextStats);
  const remainsUnfamiliar = nextScore < 0;
  const stage = remainsUnfamiliar
    ? 0
    : correct
      ? Math.min((previousScore < 0 ? 0 : previous.stage) + 1, REVIEW_INTERVALS.length - 1)
      : 0;
  const intervalDays = remainsUnfamiliar && correct ? 2 : REVIEW_INTERVALS[stage];
  return {
    ...store,
    stats: {
      ...store.stats,
      [question.id]: nextStats,
    },
    progress: {
      ...store.progress,
      [question.id]: {
        stage,
        nextDue: addDays(answerDate, intervalDays),
        lastAnsweredAt: now,
        lastResult: correct ? 'correct' : 'wrong',
      },
    },
    attempts: [{ id: createId(), questionId: question.id, correct, date: answerDate, time: now }, ...store.attempts].slice(0, 5000),
  };
}

function recordDailyReviewAnswer(store, question, correct, direction = 'zh-ko') {
  return recordAnswer(store, question, correct);
}

function recordDailyWrongReviewAnswer(store, question, correct) {
  const now = new Date().toISOString();
  return {
    ...store,
    attempts: [{
      id: createId(),
      questionId: question.id,
      correct,
      date: todayString(),
      time: now,
      mode: DAILY_WRONG_REVIEW_MODE,
    }, ...(store.attempts || [])].slice(0, 5000),
  };
}

function recordDailyRoundAnswer(store, question, correct, {
  stateKey,
  mode,
  recordWrongStats = false,
}) {
  const round = store[stateKey] || {
    correctIds: [], pendingWrongIds: [], roundCompletedOn: '', dailyDate: todayString(), assignmentIds: [], answeredIds: [],
  };
  const correctIds = new Set(round.correctIds || []);
  const pendingWrongIds = new Set(round.pendingWrongIds || []);
  if (correct) {
    correctIds.add(question.id);
    pendingWrongIds.delete(question.id);
  } else {
    correctIds.delete(question.id);
    pendingWrongIds.add(question.id);
  }
  const nextRound = {
    ...round,
    correctIds: [...correctIds].sort(),
    pendingWrongIds: [...pendingWrongIds].sort(),
    answeredIds: [...new Set([...(round.answeredIds || []), question.id])],
  };
  if (!correct && recordWrongStats) {
    const next = recordAnswer(store, question, false);
    return {
      ...next,
      [stateKey]: nextRound,
      attempts: next.attempts.map((attempt, index) => (
        index === 0 ? { ...attempt, mode } : attempt
      )),
    };
  }
  const now = new Date().toISOString();
  return {
    ...store,
    [stateKey]: nextRound,
    attempts: [{
      id: createId(),
      questionId: question.id,
      correct,
      date: todayString(),
      time: now,
      mode,
    }, ...store.attempts].slice(0, 5000),
  };
}

function recordDailyRecognitionAnswer(store, question, correct) {
  return recordDailyRoundAnswer(store, question, correct, {
    stateKey: 'recognition',
    mode: DAILY_RECOGNITION_MODE,
  });
}

function normalizeAnswer(text) {
  return [...text.replace(PUNCTUATION_RE, '')];
}

function countKoreanLetters(text) {
  return [...text].filter((char) => /\p{Script=Hangul}/u.test(char)).length;
}

function compareAnswer(input, answer) {
  const user = normalizeAnswer(input.trim());
  const correct = normalizeAnswer(answer.trim());
  const dp = Array.from({ length: correct.length + 1 }, () => Array(user.length + 1).fill(0));
  for (let i = correct.length; i >= 0; i -= 1) {
    for (let j = user.length; j >= 0; j -= 1) {
      if (i === correct.length) {
        dp[i][j] = user.length - j;
      } else if (j === user.length) {
        dp[i][j] = correct.length - i;
      } else if (correct[i] === user[j]) {
        dp[i][j] = dp[i + 1][j + 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i + 1][j + 1],
          dp[i][j + 1],
          dp[i + 1][j],
        );
      }
    }
  }
  const parts = [];
  let i = 0;
  let j = 0;
  while (i < correct.length || j < user.length) {
    if (i < correct.length && j < user.length && correct[i] === user[j]) {
      parts.push({ type: 'ok', text: correct[i] });
      i += 1;
      j += 1;
    } else if (i < correct.length && j < user.length && dp[i][j] === 1 + dp[i + 1][j + 1]) {
      parts.push({ type: 'replace', text: user[j], expected: correct[i] });
      i += 1;
      j += 1;
    } else if (j < user.length && (i === correct.length || dp[i][j] === 1 + dp[i][j + 1])) {
      parts.push({ type: user[j] === ' ' ? 'extra-space' : 'extra', text: user[j] });
      j += 1;
    } else if (i < correct.length) {
      parts.push({ type: correct[i] === ' ' ? 'missing-space' : 'missing', text: correct[i] });
      i += 1;
    }
  }
  return {
    isCorrect: correct.join('') === user.join(''),
    parts,
  };
}

function MasteryBadge({ level }) {
  return <span className={`badge mastery-${level}`}>{level}</span>;
}

function normalizeSpeechLanguage(lang) {
  return String(lang || '').replaceAll('_', '-').toLowerCase();
}

function speechLanguageKey(lang) {
  return normalizeSpeechLanguage(lang).startsWith('zh') ? 'zh' : 'ko';
}

function findPreferredSpeechVoice(voices, preference, lang) {
  if (!preference || !Array.isArray(voices)) return null;
  const languageKey = speechLanguageKey(lang);
  const candidates = voices.filter((voice) => normalizeSpeechLanguage(voice?.lang).startsWith(languageKey));
  return candidates.find((voice) => preference.voiceURI && voice.voiceURI === preference.voiceURI)
    || candidates.find((voice) => (
      voice.name === preference.name
      && normalizeSpeechLanguage(voice.lang) === normalizeSpeechLanguage(preference.lang)
    ))
    || null;
}

function readSpeechVoicePreferences() {
  if (typeof window === 'undefined') return {};
  try {
    const stored = JSON.parse(window.localStorage.getItem(SPEECH_VOICE_STORAGE_KEY) || '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
}

function configureSpeechUtterance(utterance, lang, voiceOverride = undefined) {
  utterance.lang = lang;
  utterance.rate = normalizeSpeechLanguage(lang).startsWith('ko') ? 0.9 : 1;
  const selectedVoice = voiceOverride === undefined
    ? findPreferredSpeechVoice(
      window.speechSynthesis.getVoices(),
      readSpeechVoicePreferences()[speechLanguageKey(lang)],
      lang,
    )
    : voiceOverride;
  if (selectedVoice) {
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang || lang;
  }
  return utterance;
}

function speakText(text, lang, voiceOverride = undefined) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = configureSpeechUtterance(new SpeechSynthesisUtterance(text), lang, voiceOverride);
  window.speechSynthesis.speak(utterance);
}

function speakTextAndWait(text, lang) {
  if (!('speechSynthesis' in window) || !text) return Promise.resolve();
  return new Promise((resolve) => {
    const utterance = configureSpeechUtterance(new SpeechSynthesisUtterance(text), lang);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      resolve();
    };
    const fallbackTimer = window.setTimeout(finish, Math.max(3500, [...text].length * 320));
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  });
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

function shouldShowStudyChinese(hideChineseInitially, cardChineseRevealed) {
  return !hideChineseInitially || cardChineseRevealed;
}

function studyCardDoubleTapAction(clientX, left, width) {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return '';
  const position = (clientX - left) / width;
  if (position < 1 / 3) return 'previous';
  if (position > 2 / 3) return 'next';
  return 'flip';
}

function buildStudyAutoPlaySpeechSequence(item, {
  frontSide = 'ko',
  hideChineseInitially = true,
  playExampleVoice = true,
  voiceRepeatCount = 1,
} = {}) {
  if (!item) return [];
  const repeatCount = Math.min(3, Math.max(1, Number(voiceRepeatCount) || 1));
  const includeChinese = !hideChineseInitially;
  const cycle = [{
    text: item.ko,
    lang: 'ko-KR',
    face: frontSide === 'ko' || hideChineseInitially ? 'front' : 'back',
  }];
  if (includeChinese && item.zh) {
    cycle.push({ text: item.zh, lang: 'zh-TW', face: frontSide === 'zh' ? 'front' : 'back' });
  }
  if (playExampleVoice) {
    itemExamples(item).forEach((example) => {
      if (example.ko) cycle.push({ text: example.ko, lang: 'ko-KR', face: 'back' });
      if (includeChinese && example.zh) cycle.push({ text: example.zh, lang: 'zh-TW', face: 'back' });
    });
  }
  return Array.from({ length: repeatCount }, () => cycle).flat();
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

function shuffleItems(items, seed) {
  const result = [...items];
  let value = seed || 1;
  for (let i = result.length - 1; i > 0; i -= 1) {
    value = (value * 9301 + 49297) % 233280;
    const j = Math.floor((value / 233280) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function shuffleReviewQuestionsByKind(questions, seed = Date.now()) {
  const terms = questions.filter((question) => question.kind === 'term');
  const examples = questions.filter((question) => question.kind === 'example');
  const others = questions.filter((question) => question.kind !== 'term' && question.kind !== 'example');
  return [
    ...shuffleItems(terms, seed),
    ...shuffleItems(examples, seed + 17),
    ...shuffleItems(others, seed + 31),
  ];
}

function App() {
  const { loading: authLoading, user } = useAuthUser();
  const [store, updateStore, storeLoading, storeError, markDateComplete] = useFirestoreStore(user);
  const offlineMode = useOfflineMode(user);
  const [page, setPage] = useState('home');
  const [practiceSet, setPracticeSet] = useState(null);
  const grammarEnabled = page === 'home'
    || page === 'notes'
    || (page === 'practice' && practiceSet?.mode === DAILY_GRAMMAR_MODE);
  const ytEnabled = page === 'ytSubtitles' || page === 'ytSubtitle';
  const readingEnabled = page === 'readingTests' || page === 'readingTest';
  const foldersEnabled = !['calendar', 'notes', 'ytSubtitles', 'readingTests'].includes(page);
  const grammar = useGrammarNotes(user, grammarEnabled);
  const ytSubtitles = useYoutubeSubtitles(user, ytEnabled);
  const readingTests = useReadingTests(user, readingEnabled);
  const folders = useWordFolders(user, foldersEnabled);
  const optionalPractice = useOptionalPractice(user);
  const [pageStack, setPageStack] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => todayString());
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

  const navTop = (next) => {
    setPageStack([]);
    if (next === 'calendar') setSelectedDate(todayString());
    setPage(next);
  };
  const navChild = (next) => {
    setPageStack((stack) => [...stack, page]);
    setPage(next);
  };
  const goUp = () => {
    if (!pageStack.length) {
      if (page !== 'home') navTop('home');
      return;
    }
    setPage(pageStack[pageStack.length - 1]);
    setPageStack(pageStack.slice(0, -1));
  };
  const startPractice = (sourceQuestions, label, options = {}) => {
    setPracticeSet({
      questions: sourceQuestions,
      label,
      dueOnly: !!options.dueOnly,
      dailyReview: !!options.dailyReview,
      grammarOnly: !!options.grammarOnly,
      repeatable: !!options.repeatable,
      wrongReview: !!options.wrongReview,
      allowAlphabeticalOrder: !!options.allowAlphabeticalOrder,
      mode: options.mode || '',
      grammarNote: options.grammarNote || null,
      noteCategory: options.noteCategory || NOTE_CATEGORY_GRAMMAR,
      onComplete: options.onComplete || null,
      allowResultRecording: !!options.allowResultRecording,
      optionalKind: options.optionalKind || '',
      onOptionalAnswer: options.onOptionalAnswer || null,
      direction: options.direction || 'ko-zh',
    });
    navChild('practice');
  };
  const startStudy = (sourceItems, label) => {
    setStudySet({ items: sourceItems, label });
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

  if (authLoading) return <LoadingScreen text="正在確認登入狀態" />;
  if (!user) return <LoginPage />;
  if (storeLoading || (foldersEnabled && folders.loading) || (grammarEnabled && grammar.loading) || (ytEnabled && ytSubtitles.loading) || (readingEnabled && readingTests.loading)) {
    return <LoadingScreen text="載入資料中" />;
  }

  const views = {
    home: <HomePage store={store} items={items} questions={dailyQuestions} dueQuestionsForToday={todayDailyQuestions} wrongQuestionsForToday={todayWrongQuestions} optionalPractice={optionalPractice} grammarNotes={grammar.notes} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onWriteRecords={updateLearningRecords} folders={folders.folders} offlineMode={offlineMode} fontScale={fontScale} onFontScaleChange={setFontScale} />,
    calendar: <CalendarPage store={store} items={items} selectedDate={selectedDate} setSelectedDate={setSelectedDate} onOpenNotes={() => navChild('dateNotes')} />,
    dateNotes: <NotesPage store={store} updateStore={updateStore} items={items.filter((item) => item.date === selectedDate)} questions={questions.filter((q) => q.date === selectedDate)} date={selectedDate} allItems={items} folders={folders.folders} onAssignFolders={folders.addWordsToFolders} onCreateFolderAndAssign={folders.createFolderAndAssign} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onUpdateRecords={updateLearningRecords} onDeleteRecord={deleteLearningRecordFromStore} onDeleteRecords={deleteLearningRecordsFromStore} />,
    study: <StudyPage store={store} updateStore={updateStore} set={studySet || { items, label: '全部內容' }} allItems={items} folders={folders.folders} onUpdateRecord={updateLearningRecord} onBack={pageStack.length ? goUp : null} learnedWordIds={learnedWordIds} unfamiliarWordIds={unfamiliarWordIds} onToggleLearned={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(learnedFolder?.id || SYSTEM_LEARNED_FOLDER_ID, [itemId])} onToggleUnfamiliar={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(unfamiliarFolder?.id || SYSTEM_UNFAMILIAR_FOLDER_ID, [itemId])} />,
    practice: <PracticePage store={store} updateStore={updateStore} set={practiceSet || { questions: todayDailyQuestions, label: '今日測驗', dueOnly: true }} allItems={items} folders={folders.folders} onUpdateRecord={updateLearningRecord} learnedWordIds={learnedWordIds} unfamiliarWordIds={unfamiliarWordIds} onToggleLearned={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(learnedFolder?.id || SYSTEM_LEARNED_FOLDER_ID, [itemId])} onToggleUnfamiliar={(itemId, remove) => (remove ? folders.removeWords : folders.addWords)(unfamiliarFolder?.id || SYSTEM_UNFAMILIAR_FOLDER_ID, [itemId])} />,
    notebook: <NotebookPage store={store} updateStore={updateStore} items={items} questions={questions} folders={folders.folders} onAssignFolders={folders.addWordsToFolders} onCreateFolderAndAssign={folders.createFolderAndAssign} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onUpdateRecords={updateLearningRecords} onDeleteRecord={deleteLearningRecordFromStore} onDeleteRecords={deleteLearningRecordsFromStore} />,
    folders: <FoldersPage folders={folders.folders} items={items} loading={folders.loading} error={folders.error} onSave={folders.save} onDelete={folders.remove} onOpen={openFolder} />,
    folder: <FolderDetailPage folder={folders.folders.find((folder) => folder.id === selectedFolderId)} folders={folders.folders} store={store} updateStore={updateStore} items={items} questions={questions} onSaveFolder={folders.save} onDeleteFolder={folders.remove} onAddWords={folders.addWords} onAssignFolders={folders.addWordsToFolders} onCreateFolderAndAssign={folders.createFolderAndAssign} onRemoveWords={folders.removeWords} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onUpdateRecords={updateLearningRecords} onDeleteRecord={deleteLearningRecordFromStore} onDeleteRecords={deleteLearningRecordsFromStore} onBack={goUp} />,
    notes: <NotesNotebookPage notes={grammar.notes} loading={grammar.loading} error={grammar.error} onSave={grammar.save} onDelete={grammar.remove} onPractice={startPractice} />,
    ytSubtitles: <YoutubeSubtitlesPage notes={ytSubtitles.notes} error={ytSubtitles.error} onSave={ytSubtitles.save} onDelete={ytSubtitles.remove} onOpen={openYoutubeSubtitle} />,
    ytSubtitle: <YoutubeSubtitleReader note={selectedYoutubeSubtitle} allItems={items} folders={folders.folders} onAddRecords={addYoutubeSubtitleRecords} onBack={goUp} onOpenFolder={openFolder} onSave={ytSubtitles.save} onDelete={ytSubtitles.remove} />,
    readingTests: <ReadingTestsPage tests={readingTests.tests} error={readingTests.error} onSave={readingTests.save} onSaveMany={readingTests.saveMany} onDelete={readingTests.remove} onOpen={openReadingTest} />,
    readingTest: <ReadingTestPage test={readingTests.tests.find((test) => test.id === selectedReadingTestId)} allItems={items} folders={folders.folders} onAddRecords={addReadingTestRecords} onUpdateRecord={updateLearningRecord} onDeleteRecord={deleteLearningRecordFromStore} onOpenFolder={openFolder} onSave={readingTests.save} onDelete={readingTests.remove} onBack={goUp} />,
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <button className={`brand brand-button ${page === 'home' ? 'active' : ''}`} onClick={() => navTop('home')}><Sparkles size={24} /> 韓文筆記</button>
        <button className={page === 'calendar' || page === 'dateNotes' ? 'active' : ''} onClick={() => navTop('calendar')}><CalendarDays size={18} /> 日曆</button>
        <button className={page === 'notebook' ? 'active' : ''} onClick={() => navTop('notebook')}><LibraryBig size={18} /> 單字本</button>
        <button className={page === 'folders' || page === 'folder' ? 'active' : ''} onClick={() => navTop('folders')}><Folder size={18} /> 資料夾</button>
        <button className={page === 'notes' ? 'active' : ''} onClick={() => navTop('notes')}><NotebookPen size={18} /> 筆記</button>
        <button className={page === 'ytSubtitles' || page === 'ytSubtitle' ? 'active' : ''} onClick={() => navTop('ytSubtitles')}><Captions size={18} /> YT 字幕</button>
        <button className={page === 'readingTests' || page === 'readingTest' ? 'active' : ''} onClick={() => navTop('readingTests')}><BookOpen size={18} /> 閱讀測驗</button>
        <button className="logout-button" onClick={() => signOut(auth)}><LogOut size={18} /> 登出</button>
      </aside>
      <main>
        <OfflineStatusBar offlineMode={offlineMode} />
        {storeError && <div className="sync-error">Firebase 同步失敗：{storeError}</div>}
        {folders.error && <div className="sync-error">資料夾同步失敗：{folders.error}</div>}
        {ytSubtitles.error && <div className="sync-error">YT 字幕同步失敗：{ytSubtitles.error}</div>}
        {readingTests.error && <div className="sync-error">閱讀測驗同步失敗：{readingTests.error}</div>}
        {views[page]}
      </main>
      {page !== 'home' && <button type="button" className={`global-back-button ${page === 'ytSubtitle' ? `with-yt-controls ${selectedYoutubeSubtitle?.videoId ? 'with-yt-video' : ''} ${selectedSubtitleHasFolder ? 'with-yt-folder' : ''}` : ''} ${selectedReadingHasFolder ? 'with-reading-folder' : ''}`} onClick={goUp} title="回到上一層" aria-label="回到上一層"><ChevronLeft size={24} /></button>}
    </div>
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
  const [addOpen, setAddOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [jsonEditOpen, setJsonEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const starredSet = new Set(store.starred || []);
  const filteredItems = useMemo(
    () => filterItemsByFolderSelection(items, folders, selectedFolderIds),
    [items, folders, selectedFolderIds],
  );
  const filteredItemIds = useMemo(() => new Set(filteredItems.map((item) => item.id)), [filteredItems]);
  const filteredQuestions = questions.filter((question) => filteredItemIds.has(question.itemId));
  const unfiledCount = useMemo(() => {
    const assignedWordIds = new Set(folders.flatMap((folder) => folder.wordIds || []));
    return items.filter((item) => !assignedWordIds.has(item.id)).length;
  }, [items, folders]);
  const toggleSelected = (itemId) => setSelectedIds((current) => (
    current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
  ));
  const toggleFolderFilter = (folderId) => setSelectedFolderIds((current) => (
    current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId]
  ));
  const toggleFolderTag = (folderIds) => setSelectedFolderIds((current) => toggleFolderGroupSelection(current, folderIds));
  const deleteDateItems = async () => {
    if (!items.length) return;
    const confirmed = window.confirm(`確定要刪除 ${date} 的 ${items.length} 筆單字嗎？這不會刪除其他日期的單字。`);
    if (!confirmed) return;
    await onDeleteRecords(items.map((item) => item.id));
    setSelectedIds([]);
  };
  useEffect(() => {
    setSelectedIds([]);
    setSelectedFolderIds([]);
  }, [date]);

  useEffect(() => {
    const availableFolderIds = new Set([UNFILED_FOLDER_FILTER_ID, ...folders.map((folder) => folder.id)]);
    setSelectedFolderIds((current) => current.filter((folderId) => availableFolderIds.has(folderId)));
  }, [folders]);

  useEffect(() => setSelectedIds([]), [selectedFolderIds]);
  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Notes · {dateLabel(date)}</span><h1>日期筆記</h1></div>
        <div className="actions notebook-actions">
          <button className="add-date-button" onClick={() => setAddOpen(true)}><Plus size={18} /> 新增</button>
          <button disabled={!filteredItems.length} onClick={() => onStudy(filteredItems, `${date} 學習`)}><BookOpen size={18} /> 學習</button>
          <button className="primary" disabled={!filteredQuestions.length} onClick={() => onPractice(filteredQuestions, `${date} 測驗`)}><Dumbbell size={18} /> 測驗</button>
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
      {addOpen && (
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
          allItems={allItems}
          folders={folders}
          onUpdateRecord={onUpdateRecord}
          onDeleteRecord={onDeleteRecord}
          onClose={() => setEditingItem(null)}
        />
      )}
      {viewingItem && (
        <ItemDetailModal
          item={viewingItem}
          allItems={allItems}
          isStarred={starredSet.has(viewingItem.id)}
          onToggleStar={() => toggleStarredItem(updateStore, viewingItem.id)}
          onOpenItem={setViewingItem}
          onEdit={(item) => {
            setViewingItem(null);
            setEditingItem(item);
          }}
          onDelete={onDeleteRecord}
          onClose={() => setViewingItem(null)}
        />
      )}
      <div className="date-folder-filter-row">
        <GroupedFolderMultiSelect
          folders={folders}
          selectedValues={selectedFolderIds}
          onToggle={toggleFolderFilter}
          onToggleGroup={toggleFolderTag}
          onClear={() => setSelectedFolderIds([])}
          includeUnfiled
          unfiledCount={unfiledCount}
        />
        <span>{selectedFolderIds.length ? `顯示 ${filteredItems.length} / ${items.length} 筆` : `共 ${items.length} 筆`}</span>
      </div>
      <BulkWordActions
        selectedIds={selectedIds}
        visibleIds={filteredItems.map((item) => item.id)}
        folders={folders}
        onSelectionChange={setSelectedIds}
        onAssignFolders={onAssignFolders}
        onCreateFolderAndAssign={onCreateFolderAndAssign}
        onDeleteRecords={onDeleteRecords}
      />
      {filteredItems.length ? <div className="notes-grid">{filteredItems.map((item) => (
        <NoteCard
          key={item.id}
          item={item}
          allItems={allItems}
          folders={folders}
          compact
          onOpen={setViewingItem}
          onEdit={setEditingItem}
          onDelete={onDeleteRecord}
          isStarred={starredSet.has(item.id)}
          onToggleStar={() => toggleStarredItem(updateStore, item.id)}
          selectable
          selected={selectedIds.includes(item.id)}
          onToggleSelected={toggleSelected}
        />
      ))}</div> : <div className="empty">這個日期沒有符合資料夾篩選的單字</div>}
    </section>
  );
}

function NotePreview({ item }) {
  return <div className="mini"><strong>{item.ko}</strong><span>{item.zh}</span></div>;
}

function describeImportError(error) {
  const code = String(error?.code || '').replace(/^firestore\//, '');
  const message = error?.message || '未知錯誤';
  if (code === 'permission-denied') return { code, message: 'Firebase 拒絕寫入，請確認登入狀態與 Firestore rules。' };
  if (code === 'resource-exhausted' || /quota|too many requests/i.test(message)) return { code: code || 'quota-exceeded', message: 'Firebase 目前已超過寫入額度，這筆資料尚未儲存，請等額度恢復後重試。' };
  if (code === 'unavailable' || /network|offline|failed to fetch/i.test(message)) return { code: code || 'network', message: '目前無法連線到 Firebase，請確認網路後重試。' };
  if (code === 'unauthenticated') return { code, message: '登入狀態已失效，請重新登入後再試。' };
  return { code: code || error?.name || 'error', message };
}

function AddItemsModal({ title, date, lockedDate = false, onAddRecords, onUpdateRecord, onWriteRecords, onEditExisting, editItem, allItems = [], folders = [], initialFolderIds = [], requiredFolderIds = [], onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <button className="modal-close" disabled={busy} title={busy ? '正在等待 Firebase 確認' : ''} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <AddItemsForm
          title={title}
          date={date}
          lockedDate={lockedDate}
          onAddRecords={onAddRecords}
          onUpdateRecord={onUpdateRecord}
          onWriteRecords={onWriteRecords}
          onEditExisting={onEditExisting}
          editItem={editItem}
          allItems={allItems}
          folders={folders}
          initialFolderIds={initialFolderIds}
          requiredFolderIds={requiredFolderIds}
          onBusyChange={setBusy}
          onSaved={onClose}
          compactPanel
        />
      </div>
    </div>
  );
}

function AddItemsForm({ title, date, lockedDate = false, onAddRecords, onUpdateRecord, onWriteRecords, onEditExisting, editItem, allItems = [], folders = [], initialFolderIds = [], requiredFolderIds = [], onSaved, onBusyChange, compactPanel = false }) {
  const isEditing = Boolean(editItem);
  const editFolderIds = wordFolderIds(folders, editItem?.id);
  const initialSelectedFolderIds = isEditing
    ? editFolderIds
    : [...new Set([...initialFolderIds, ...requiredFolderIds])];
  const [mode, setMode] = useState('manual');
  const [formDate, setFormDate] = useState(date);
  const [jsonText, setJsonText] = useState(() => editItem ? formatSingleWordJson(editItem) : '');
  const [importDraft, setImportDraft] = useState(null);
  const [manual, setManual] = useState(() => itemToManual(editItem));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [importLog, setImportLog] = useState([]);
  const [importCompleted, setImportCompleted] = useState(null);
  const [selectedFolderIds, setSelectedFolderIds] = useState(() => initialSelectedFolderIds);
  const [jsonCopied, setJsonCopied] = useState(false);
  const submissionLockRef = useRef(false);

  useEffect(() => {
    onBusyChange?.(saving);
  }, [saving, onBusyChange]);

  const reportImportProgress = (progress) => {
    setImportProgress(progress);
    if (!progress?.detail) return;
    setImportLog((current) => {
      if (current[current.length - 1]?.detail === progress.detail) return current;
      const next = [...current, {
        detail: progress.detail,
        time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      }];
      return next.slice(-8);
    });
  };

  useEffect(() => {
    setFormDate(editItem?.date || date);
    setManual(itemToManual(editItem));
    setJsonText(editItem ? formatSingleWordJson(editItem) : '');
    setMode('manual');
    setImportDraft(null);
    setMessage('');
    setError('');
    setDuplicates([]);
    setImportProgress(null);
    setImportLog([]);
    setImportCompleted(null);
    setSelectedFolderIds(initialSelectedFolderIds);
    setJsonCopied(false);
    submissionLockRef.current = false;
  }, [date, editItem, initialFolderIds.join('|'), requiredFolderIds.join('|'), editFolderIds.join('|')]);

  const commitImportEntries = async (entries, targetDate, keptExistingIds = []) => {
    const activeEntries = entries.filter(Boolean);
    if (!activeEntries.length) {
      if (selectedFolderIds.length && keptExistingIds.length) {
        if (!onWriteRecords) throw new Error('目前無法更新資料夾，請重新開啟視窗再試一次');
        await onWriteRecords([], reportImportProgress, selectedFolderIds, keptExistingIds);
      }
      const detail = selectedFolderIds.length && keptExistingIds.length
        ? `已將 ${keptExistingIds.length} 筆既有單字加入資料夾，沒有建立重複卡片。`
        : '沒有資料需要寫入；你選擇保留既有單字。';
      const result = { added: 0, updated: 0, detail };
      setMessage(result.detail);
      setImportDraft(null);
      setImportCompleted(result);
      reportImportProgress({ phase: 'success', current: 0, total: 0, detail: result.detail });
      return;
    }
    if (!onWriteRecords) throw new Error('目前無法執行批次匯入，請重新開啟視窗再試一次');
    const { addRecords, updateRecords } = createRecordsFromImportEntries(activeEntries, targetDate, allItems, lockedDate);
    await onWriteRecords([...addRecords, ...updateRecords], reportImportProgress, selectedFolderIds, keptExistingIds);
    setMessage(`已匯入 ${addRecords.length} 筆，更新 ${updateRecords.length} 筆`);
    setJsonText('');
    setImportDraft(null);
    setImportCompleted({ added: addRecords.length, updated: updateRecords.length, detail: `已匯入 ${addRecords.length} 筆，更新 ${updateRecords.length} 筆` });
  };

  const continueImportDraft = async (draft) => {
    const activeEntries = draft.entries.filter(Boolean);
    reportImportProgress({ phase: 'checking', current: 0, total: activeEntries.length, detail: `正在檢查 ${activeEntries.length} 筆資料的重複單字與關聯詞` });
    const updateCollision = findUpdateKoreanCollision(activeEntries, allItems);
    if (updateCollision) {
      throw new Error(`最終結果「${updateCollision.entry.item.ko}」會和既有單字重複，請回到衝突編輯後再匯入`);
    }
    const conflict = findImportConflict(activeEntries, allItems);
    if (conflict) {
      reportImportProgress({ phase: 'waiting', current: 0, total: activeEntries.length, detail: `發現衝突：${conflict.incoming?.ko || conflict.right?.ko || conflict.leftRecordId}，等待你選擇處理方式` });
      setImportDraft({ ...draft, entries: activeEntries, conflict, missingRelated: null, message: '' });
      setError('');
      return;
    }
    const missingRelated = findMissingImportRelated(activeEntries, allItems);
    if (missingRelated.length) {
      reportImportProgress({ phase: 'waiting', current: 0, total: activeEntries.length, detail: `找到 ${missingRelated.length} 筆含有不存在的關聯詞，等待你確認` });
      setImportDraft({ ...draft, entries: activeEntries, conflict: null, missingRelated, message: '' });
      setError('');
      return;
    }
    await commitImportEntries(activeEntries, draft.targetDate, draft.keptExistingIds || []);
  };

  const handleContinueImportDraft = async () => {
    if (!importDraft || submissionLockRef.current) return;
    submissionLockRef.current = true;
    setSaving(true);
    setError('');
    try {
      await continueImportDraft(importDraft);
    } catch (continueError) {
      const failure = describeImportError(continueError);
      setError(`${failure.message} (${failure.code})`);
      reportImportProgress({ phase: 'error', current: importProgress?.current || 0, total: importProgress?.total || 0, detail: `匯入失敗：${failure.message} [${failure.code}]` });
    } finally {
      submissionLockRef.current = false;
      setSaving(false);
    }
  };

  const updateInvalidText = (issueIndex, text) => {
    setImportDraft((draft) => ({
      ...draft,
      invalid: draft.invalid.map((issue) => (issue.index === issueIndex ? { ...issue, text } : issue)),
    }));
  };

  const applyInvalidFix = (issueIndex) => {
    if (!importDraft) return;
    const issue = importDraft.invalid.find((entry) => entry.index === issueIndex);
    try {
      const item = parseEditedImportItem(issue.text);
      const nextEntries = [...importDraft.entries];
      nextEntries[issueIndex] = {
        index: issueIndex,
        action: 'add',
        recordId: item.id || `${importDraft.targetDate}-custom-${createId()}`,
        item,
      };
      const nextInvalid = importDraft.invalid.filter((entry) => entry.index !== issueIndex);
      const nextConflict = nextInvalid.length ? null : findImportConflict(nextEntries.filter(Boolean), allItems);
      const nextMissingRelated = !nextInvalid.length && !nextConflict ? findMissingImportRelated(nextEntries.filter(Boolean), allItems) : [];
      setImportDraft({
        ...importDraft,
        entries: nextEntries,
        invalid: nextInvalid,
        conflict: nextConflict,
        missingRelated: nextMissingRelated.length ? nextMissingRelated : null,
        message: nextConflict ? '格式問題已修正，請繼續處理重複單字' : nextMissingRelated.length ? '格式問題已修正，請處理找不到的關聯詞' : '已套用修正',
      });
      reportImportProgress({ phase: nextConflict || nextMissingRelated.length ? 'waiting' : 'checking', current: nextEntries.length - nextInvalid.length, total: nextEntries.length, detail: `第 ${issueIndex + 1} 筆格式問題已修正` });
    } catch (validationError) {
      setImportDraft({
        ...importDraft,
        invalid: importDraft.invalid.map((entry) => (entry.index === issueIndex ? { ...entry, error: validationError.message } : entry)),
      });
      reportImportProgress({ phase: 'error', current: 0, total: importDraft.entries.length, detail: `第 ${issueIndex + 1} 筆修正仍不符合格式：${validationError.message}` });
    }
  };

  const updateConflictText = (text) => {
    setImportDraft((draft) => ({ ...draft, conflict: { ...draft.conflict, editText: text, error: '' } }));
  };

  const resolveConflict = (choice) => {
    if (!importDraft) return;
    reportImportProgress({ phase: 'checking', current: 0, total: importDraft?.entries.filter(Boolean).length || 0, detail: '已套用衝突選擇，正在檢查剩餘資料' });
    try {
      setImportDraft(resolveImportConflictDraft(importDraft, choice, allItems));
    } catch (validationError) {
      setImportDraft({ ...importDraft, conflict: { ...importDraft.conflict, error: validationError.message } });
      reportImportProgress({ phase: 'error', current: 0, total: importDraft.entries.length, detail: `衝突處理失敗：${validationError.message}` });
    }
  };

  const clearMissingRelatedAndContinue = () => {
    reportImportProgress({ phase: 'checking', current: 0, total: importDraft?.entries.filter(Boolean).length || 0, detail: '已移除找不到的關聯詞，可以繼續匯入' });
    setImportDraft((draft) => ({
      ...draft,
      entries: clearMissingImportRelated(draft.entries, draft.missingRelated || []),
      missingRelated: null,
      message: '已清空找不到的關聯詞，可以繼續匯入',
    }));
  };

  const updateManualMeaning = (meaningIndex, patch) => {
    setManual((current) => ({
      ...current,
      meanings: (current.meanings?.length ? current.meanings : [emptyManualMeaning()])
        .map((meaning, index) => (index === meaningIndex ? { ...meaning, ...patch } : meaning)),
    }));
  };

  const addManualMeaning = () => {
    setManual((current) => ({
      ...current,
      meanings: [...(current.meanings?.length ? current.meanings : [emptyManualMeaning()]), emptyManualMeaning()],
    }));
  };

  const removeManualMeaning = (meaningIndex) => {
    setManual((current) => ({
      ...current,
      meanings: current.meanings?.length > 1 ? current.meanings.filter((_, index) => index !== meaningIndex) : (current.meanings || [emptyManualMeaning()]),
    }));
  };

  const toggleFolder = (folderId) => {
    if (!isEditing && requiredFolderIds.includes(folderId)) return;
    setSelectedFolderIds((current) => (
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId]
    ));
  };

  const switchMode = (nextMode) => {
    if (nextMode === mode || saving) return;
    setError('');
    try {
      if (isEditing) {
        if (nextMode === 'json') {
          setJsonText(formatSingleWordJson(mergeEditedItem(editItem, manual, allItems)));
        } else {
          setManual(itemToManual(parseSingleWordEditJson(jsonText, editItem, allItems)));
        }
      }
      setJsonCopied(false);
      setMode(nextMode);
    } catch (validationError) {
      setError(validationError.message);
    }
  };

  const copyJsonContent = async () => {
    try {
      await copyText(jsonText);
      setJsonCopied(true);
      window.setTimeout(() => setJsonCopied(false), 1600);
    } catch (copyError) {
      setError(copyError.message || '無法複製 JSON 內容');
    }
  };

  const clearJsonContent = () => {
    setJsonText('');
    setJsonCopied(false);
    setError('');
    setMessage('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submissionLockRef.current) return;
    submissionLockRef.current = true;
    setMessage('');
    setError('');
    setDuplicates([]);
    setImportCompleted(null);
    setSaving(true);
    try {
      const targetDate = isEditing ? formDate : lockedDate ? date : formDate;
      if (isEditing) {
        const record = {
          id: editItem.id,
          date: targetDate,
          order: recordOrder(editItem),
          item: mode === 'json' ? parseSingleWordEditJson(jsonText, editItem, allItems) : mergeEditedItem(editItem, manual, allItems),
          createdAt: editItem.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await onUpdateRecord(record, reportImportProgress, selectedFolderIds);
        setMessage('已更新單字');
      } else {
        if (mode === 'json') {
          reportImportProgress({ phase: 'parsing', current: 0, total: 0, detail: '正在解析與驗證 JSON 內容' });
          const draft = buildJsonImportDraft(jsonText, targetDate);
          const total = draft.entries.filter(Boolean).length + draft.invalid.length;
          if (draft.invalid.length) {
            reportImportProgress({ phase: 'waiting', current: total - draft.invalid.length, total, detail: `發現 ${draft.invalid.length} 筆格式問題，等待逐筆修正` });
            setImportDraft(draft);
            setError('有資料不符合匯入格式，請先修正。修正完成前不會匯入任何資料。');
            return;
          }
          const conflict = findImportConflict(draft.entries, allItems);
          if (conflict) {
            reportImportProgress({ phase: 'waiting', current: 0, total, detail: `發現衝突：${conflict.incoming?.ko || conflict.right?.ko || conflict.leftRecordId}，等待你選擇處理方式` });
            setImportDraft({ ...draft, conflict });
            setError('發現重複韓文單字，請先選擇處理方式。處理完成前不會匯入任何資料。');
            return;
          }
          await continueImportDraft(draft);
          return;
        }
        const rawItems = [manualToItem(manual, allItems)];
        const repeatedInInput = rawItems.map((item) => normalizeKoreanKey(item.ko)).filter((ko, index, list) => list.indexOf(ko) !== index);
        if (repeatedInInput.length) {
          setError(`這次新增內容中有重複韓文：${[...new Set(repeatedInInput)].join('、')}`);
          return;
        }
        const existing = rawItems
          .map((rawItem) => allItems.find((item) => normalizeKoreanKey(item.ko) === normalizeKoreanKey(rawItem.ko)))
          .filter(Boolean);
        if (existing.length) {
          setDuplicates(existing);
          setError('不能新增重複韓文單字。請直接編輯既有單字卡。');
          return;
        }
        const records = createRecordsForDate(targetDate, rawItems, allItems);
        await onAddRecords(records, reportImportProgress, selectedFolderIds);
        setMessage(`已新增 ${records.length} 筆到 ${targetDate}`);
        setManual(itemToManual());
      }
      onSaved?.();
    } catch (submitError) {
      const failure = describeImportError(submitError);
      setError(`${failure.message} (${failure.code})`);
      reportImportProgress({ phase: 'error', current: importProgress?.current || 0, total: importProgress?.total || 0, detail: `儲存失敗：${failure.message} [${failure.code}]` });
    } finally {
      submissionLockRef.current = false;
      setSaving(false);
    }
  };

  return (
    <form className={`${compactPanel ? '' : 'panel'} add-panel`} onSubmit={submit}>
      <div className="panel-title">
        <div><h2>{title}</h2><span>{isEditing ? '修改後會覆蓋這筆單字資料' : '可貼上整份 JSON，或手動新增一筆'}</span></div>
        {!importCompleted && <div className="segmented compact">
          <button type="button" disabled={saving} className={mode === 'manual' ? 'active' : ''} onClick={() => switchMode('manual')}>表單</button>
          <button type="button" disabled={saving} className={mode === 'json' ? 'active' : ''} onClick={() => switchMode('json')}>JSON</button>
        </div>}
      </div>

      {importCompleted ? (
        <ImportCompletePanel result={importCompleted} onDone={onSaved} />
      ) : importDraft ? (
        <ImportReviewPanel
          draft={importDraft}
          onUpdateInvalidText={updateInvalidText}
          onApplyInvalidFix={applyInvalidFix}
          onContinue={handleContinueImportDraft}
          onUpdateConflictText={updateConflictText}
          onResolveConflict={resolveConflict}
          onClearMissingRelated={clearMissingRelatedAndContinue}
          saving={saving}
          onCancel={() => {
            setImportDraft(null);
            setError('');
            setMessage('已放棄這次匯入，沒有寫入任何資料');
            reportImportProgress({ phase: 'cancelled', current: 0, total: 0, detail: '已放棄這次匯入，沒有寫入任何資料' });
          }}
        />
      ) : <div className="form-grid">
        <label>
          日期
          <input type="date" value={isEditing ? formDate : lockedDate ? date : formDate} onChange={(event) => setFormDate(event.target.value)} disabled={lockedDate && !isEditing} required />
        </label>
        {!!folders.length && (
          <FolderPickerDropdown
            folders={folders}
            selectedFolderIds={selectedFolderIds}
            requiredFolderIds={isEditing ? [] : requiredFolderIds}
            onToggle={toggleFolder}
            title={isEditing ? '所屬資料夾' : '加入資料夾'}
            wide={false}
          />
        )}
        {mode === 'manual' ? (
          <>
            <label>
              韓文 *
              <input value={manual.ko} onChange={(event) => setManual({ ...manual, ko: event.target.value })} required />
            </label>
            <label>
              詞性 / 類型
              <select value={manual.pos} onChange={(event) => setManual({ ...manual, pos: event.target.value })}>
                <option value="">不指定</option>
                {manual.pos && !['名詞', '動詞', '形容詞', '副詞', '片語', '動詞片語', '句子', '文法', '比較'].includes(manual.pos) && <option value={manual.pos}>{manual.pos}</option>}
                {['名詞', '動詞', '形容詞', '副詞', '片語', '動詞片語', '句子', '文法', '比較'].map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <div className="wide-field meanings-editor">
              <div className="meanings-editor-head">
                <div>
                  <strong>意思與例句</strong>
                  <span>每個中文意思可以有自己的句型和例句</span>
                </div>
                <button type="button" className="soft-button" onClick={addManualMeaning}><Plus size={16} /> 新增意思</button>
              </div>
              {manual.meanings.map((meaning, meaningIndex) => (
                <section className="meaning-editor-card" key={meaning.id || meaningIndex}>
                  <div className="meaning-editor-title">
                    <strong>意思 {meaningIndex + 1}</strong>
                    <button type="button" className="ghost-danger" onClick={() => removeManualMeaning(meaningIndex)} disabled={manual.meanings.length <= 1}>
                      <Trash2 size={15} /> 刪除
                    </button>
                  </div>
                  <label>
                    中文 *
                    <input value={meaning.zh} onChange={(event) => updateManualMeaning(meaningIndex, { zh: event.target.value })} />
                  </label>
                  <label>
                    常見句型 / 搭配
                    <input value={meaning.pattern} onChange={(event) => updateManualMeaning(meaningIndex, { pattern: event.target.value })} />
                  </label>
                  <label className="wide-field">
                    例句
                    <textarea
                      value={meaning.examples}
                      onChange={(event) => updateManualMeaning(meaningIndex, { examples: event.target.value })}
                      placeholder={'韓文一行、中文一行，例句之間可空一行\n\n오늘은 날씨가 좋아요.\n今天天氣很好。\n\n주말에는 사람이 많아요.\n週末人很多。'}
                      rows={8}
                    />
                  </label>
                </section>
              ))}
            </div>
            <label className="wide-field">
              補充說明
              <textarea value={manual.notes} onChange={(event) => setManual({ ...manual, notes: event.target.value })} placeholder={'支援 Markdown，例如：\n\n### 使用提醒\n這個單字常用於 **口語**。\n\n- 注意語氣\n- 可與其他單字搭配'} rows={8} />
            </label>
            <RelatedSelector manual={manual} setManual={setManual} allItems={allItems} editItem={editItem} />
          </>
        ) : (
          <div className="wide-field json-input-field">
            <div className="json-input-heading">
              <label htmlFor="word-json-input">JSON 內容</label>
              {isEditing && <div className="json-input-actions">
                <button type="button" className="soft-button" onClick={copyJsonContent} aria-live="polite"><Copy size={15} /> {jsonCopied ? '已複製內容' : '複製'}</button>
                <button type="button" className="json-clear-button" onClick={clearJsonContent}><X size={15} /> 清除</button>
              </div>}
            </div>
            <textarea id="word-json-input" className="json-input" spellCheck={false} value={jsonText} onChange={(event) => { setJsonText(event.target.value); setJsonCopied(false); }} placeholder='{ "schemaVersion": 2, "data": [{ "ko": "뉴스", "pos": "名詞", "meanings": [{ "zh": "新聞", "examples": [] }] }] }' required />
          </div>
        )}
      </div>}

      {importProgress && <ImportProgressPanel progress={importProgress} log={importLog} />}
      {message && !importCompleted && <div className="form-success">{message}</div>}
      {error && <div className="form-error">{error}</div>}
      {!!duplicates.length && (
        <div className="duplicate-list">
          {duplicates.map((item) => (
            <button type="button" key={item.id} onClick={() => onEditExisting?.(item)}>
              <strong>{item.ko}</strong><span>{item.zh}</span><small>{item.date}</small>
            </button>
          ))}
        </div>
      )}
      {!importDraft && !importCompleted && <div className="form-actions">
        <button className="primary" disabled={saving}>{saving ? '儲存中' : isEditing ? '儲存修改' : '新增到單字庫'}</button>
      </div>}
    </form>
  );
}

function ImportProgressPanel({ progress, log }) {
  const labels = {
    parsing: '解析 JSON',
    checking: '檢查資料',
    waiting: '等待處理',
    preparing: '逐筆整理',
    uploading: '等待 Firebase',
    success: '匯入完成',
    error: '匯入失敗',
    cancelled: '已放棄',
  };
  const percent = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <section className={`import-progress import-progress-${progress.phase}`} role="status" aria-live="polite">
      <div className="import-progress-head">
        <strong>{labels[progress.phase] || '處理中'}</strong>
        {!!progress.total && <span>{progress.current}/{progress.total}</span>}
      </div>
      {!!progress.total && <div className="import-progress-track"><span style={{ width: `${percent}%` }} /></div>}
      <p>{progress.detail}</p>
      {!!log.length && (
        <div className="import-progress-log">
          {log.map((entry, index) => <div key={`${index}-${entry.detail}`}><time>{entry.time}</time>{entry.detail}</div>)}
        </div>
      )}
    </section>
  );
}

function ImportCompletePanel({ result, onDone }) {
  return (
    <div className="import-complete">
      <Check size={28} aria-hidden="true" />
      <strong>匯入已完成</strong>
      <p>{result.detail}</p>
      <button type="button" className="primary" onClick={onDone}>完成</button>
    </div>
  );
}

function ImportReviewPanel({ draft, onUpdateInvalidText, onApplyInvalidFix, onContinue, onUpdateConflictText, onResolveConflict, onClearMissingRelated, onCancel, saving }) {
  const pendingCount = draft.entries.filter(Boolean).length;
  return (
    <div className="import-review">
      <div className="import-review-head">
        <div>
          <strong>匯入預檢</strong>
          <span>{pendingCount} 筆待匯入 / {draft.invalid.length} 筆需要修正</span>
        </div>
        <button type="button" className="danger-soft" disabled={saving} onClick={onCancel}>放棄匯入</button>
      </div>

      {!!draft.invalid.length && (
        <div className="import-section">
          <h3>不符合規定的資料</h3>
          <p>請逐筆修正後按「套用修正」。全部修正完成前，不會匯入任何資料。</p>
          {draft.invalid.map((issue) => (
            <div className="import-fix-card" key={issue.index}>
              <div className="import-fix-title">
                <strong>第 {issue.index + 1} 筆</strong>
                <span>{issue.error}</span>
              </div>
              <textarea value={issue.text} onChange={(event) => onUpdateInvalidText(issue.index, event.target.value)} spellCheck="false" />
              <button type="button" onClick={() => onApplyInvalidFix(issue.index)}>套用修正</button>
            </div>
          ))}
        </div>
      )}

      {!draft.invalid.length && draft.conflict && (
        <ImportConflictResolver conflict={draft.conflict} onUpdateText={onUpdateConflictText} onResolve={onResolveConflict} />
      )}

      {!draft.invalid.length && !draft.conflict && !!draft.missingRelated?.length && (
        <ImportMissingRelatedPanel issues={draft.missingRelated} onClear={onClearMissingRelated} />
      )}

      {!draft.invalid.length && !draft.conflict && !draft.missingRelated?.length && (
        <div className="import-ready">
          <strong>所有問題都已處理</strong>
          <p>確認後會一次匯入新增資料，並更新你選擇合併或覆蓋的既有單字。</p>
          <button type="button" className="primary" disabled={saving} onClick={onContinue}>{saving ? '匯入中…' : '全部匯入'}</button>
        </div>
      )}

      {!!draft.invalid.length && (
        <div className="form-actions">
          <button type="button" className="primary" disabled={!!draft.invalid.length} onClick={onContinue}>繼續檢查重複單字</button>
        </div>
      )}
    </div>
  );
}

function ImportMissingRelatedPanel({ issues, onClear }) {
  const missingCount = issues.reduce((sum, issue) => sum + issue.missing.length, 0);
  return (
    <div className="import-section missing-related-section">
      <h3>找不到 {missingCount} 個關聯詞</h3>
      <p>這些 related 沒有對應到既有單字，也沒有對應到這次匯入的單字。你可以清空這些無效關聯詞後繼續匯入，其他有效關聯詞會保留。</p>
      <div className="missing-related-list">
        {issues.map((issue) => (
          <div key={`${issue.position}-${issue.ko}`}>
            <strong>{issue.ko}</strong>
            <span>{issue.missing.join('、')}</span>
          </div>
        ))}
      </div>
      <div className="conflict-actions">
        <button type="button" className="primary" onClick={onClear}>清空這些關聯詞並繼續</button>
      </div>
    </div>
  );
}

function ImportConflictResolver({ conflict, onUpdateText, onResolve }) {
  const isExisting = conflict.type === 'existing';
  const conflictTitle = conflict.reason === 'id' ? `重複單字 ID：${isExisting ? conflict.existing.id : conflict.leftRecordId}` : `重複韓文單字：${conflict.right?.ko || conflict.incoming?.ko}`;
  const leftLabel = isExisting ? '既有單字' : '匯入資料 A';
  const rightLabel = isExisting ? '匯入資料' : '匯入資料 B';
  const leftItem = isExisting ? conflict.existing : conflict.left;
  const rightItem = isExisting ? conflict.incoming : conflict.right;
  return (
    <div className="import-section">
      <h3>{conflictTitle}</h3>
      <p>請選擇保留其中一邊、直接合併，或編輯最終結果。處理完成前不會匯入任何資料。</p>
      <div className="import-compare-grid">
        <ImportCompareCard label={leftLabel} item={leftItem} />
        <ImportCompareCard label={rightLabel} item={rightItem} />
      </div>
      <div className="conflict-actions">
        {isExisting ? (
          <>
            <button type="button" onClick={() => onResolve('existing')}>保留既有單字</button>
            <button type="button" onClick={() => onResolve('incoming')}>使用匯入資料取代</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onResolve('left')}>保留 A</button>
            <button type="button" onClick={() => onResolve('right')}>保留 B</button>
          </>
        )}
        <button type="button" onClick={() => onResolve('merge')}>直接合併</button>
      </div>
      <label className="import-final-editor">
        編輯最終結果
        <textarea value={conflict.editText} onChange={(event) => onUpdateText(event.target.value)} spellCheck="false" />
      </label>
      {conflict.error && <div className="form-error">{conflict.error}</div>}
      <button type="button" className="primary" onClick={() => onResolve('edit')}>使用編輯後結果</button>
    </div>
  );
}

function ImportCompareCard({ label, item }) {
  return (
    <div className="import-compare-card">
      <span>{label}</span>
      <strong>{item.ko}</strong>
      {item.pos && <small>{item.pos}</small>}
      <p>{itemZh(item)}</p>
      {!!item.meanings?.length && (
        <div className="import-meaning-list">
          {item.meanings.map((meaning, index) => (
            <div key={meaning.id || `${meaning.zh}-${index}`}>
              <b>{meaning.zh}</b>
              {!!meaning.examples?.length && <em>{meaning.examples.length} 個例句</em>}
            </div>
          ))}
        </div>
      )}
      {!!item.notes?.length && <p className="import-note">{item.notes.join(' / ')}</p>}
    </div>
  );
}

function RelatedSelector({ manual, setManual, allItems, editItem }) {
  const query = manual.relatedQuery || '';
  const selected = manual.relatedSelected || [];
  const selectedSet = new Set(selected);
  const results = allItems
    .filter((item) => item.id !== editItem?.id)
    .filter((item) => !selectedSet.has(item.id))
    .filter((item) => !query.trim() || `${item.ko} ${item.zh}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);
  return (
    <div className="wide-field related-selector">
      <label>
        相關詞
        <input value={query} onChange={(event) => setManual({ ...manual, relatedQuery: event.target.value })} placeholder="搜尋已有單字" />
      </label>
      {!!selected.length && (
        <div className="selected-related">
          {selected.map((id) => {
            const item = allItems.find((candidate) => candidate.id === id);
            return (
              <button type="button" key={id} onClick={() => setManual({ ...manual, relatedSelected: selected.filter((entry) => entry !== id) })}>
                {item?.ko || id}{item?.zh ? ` · ${item.zh}` : ''} ×
              </button>
            );
          })}
        </div>
      )}
      <div className="related-results">
        {results.map((item) => (
          <button type="button" key={item.id} onClick={() => setManual({ ...manual, relatedSelected: [...selected, item.id], relatedQuery: '' })}>
            <strong>{item.ko}</strong><span>{item.zh}</span>
          </button>
        ))}
        {query.trim() && !results.length && <div className="empty small-empty">找不到符合的既有單字</div>}
      </div>
    </div>
  );
}

function emptyManualMeaning() {
  return { id: '', zh: '', pattern: '', examples: '' };
}

function manualMeaningHasContent(meaning) {
  return Boolean(meaning.zh.trim() || meaning.pattern.trim() || meaning.examples.trim());
}

function manualMeaningToItemMeaning(meaning, index) {
  if (!meaning.zh.trim()) throw new Error(`第 ${index + 1} 個意思需要中文`);
  return {
    ...(meaning.id ? { id: meaning.id } : {}),
    zh: meaning.zh.trim(),
    ...(meaning.pattern.trim() ? { pattern: meaning.pattern.trim() } : {}),
    examples: parsePairLines(meaning.examples),
  };
}

function manualToItem(manual, allItems = []) {
  if (!manual.ko.trim()) throw new Error('韓文是必填');
  const meaningInputs = (manual.meanings || []).filter(manualMeaningHasContent);
  if (!meaningInputs.length) throw new Error('至少需要 1 個中文意思');
  const item = {
    ko: manual.ko.trim(),
    meanings: meaningInputs.map(manualMeaningToItemMeaning),
  };
  if (manual.pos) item.pos = manual.pos;
  const notesMarkdown = manual.notes.trim();
  if (notesMarkdown) item.notes = [notesMarkdown];
  const related = (manual.relatedSelected || []).filter((id) => allItems.some((candidate) => candidate.id === id));
  if (related.length) item.related = related;
  return item;
}

function itemToManual(item) {
  if (!item) {
    return { ko: '', pos: '', meanings: [emptyManualMeaning()], notes: '', relatedSelected: [], relatedQuery: '' };
  }
  return {
    ko: item.ko || '',
    pos: item.pos || '',
    meanings: (item.meanings?.length ? item.meanings : [emptyManualMeaning()]).map((meaning) => ({
      id: meaning.id || '',
      zh: meaning.zh || '',
      pattern: meaning.pattern || '',
      examples: formatPairLines(meaning.examples),
    })),
    notes: (item.notes || []).join('\n\n'),
    relatedSelected: (item.related || []).filter(Boolean),
    relatedQuery: '',
  };
}

function mergeEditedItem(original, manual, allItems = []) {
  const edited = manualToItem(manual, allItems);
  const {
    id,
    date,
    index,
    order,
    createdAt,
    updatedAt,
    total,
    rate,
    score,
    level,
    ...content
  } = original;
  const next = { ...content, ...edited };
  ['pos', 'meanings', 'notes', 'related'].forEach((key) => {
    if (edited[key] === undefined) delete next[key];
  });
  return next;
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

function itemSearchText(item) {
  return [
    item.ko,
    item.zh,
    item.pos,
    item.date,
    ...(item.notes || []),
    ...(item.meanings || []).flatMap((meaning) => [meaning.zh, meaning.pattern, ...(meaning.examples || []).flatMap((example) => [example.ko, example.zh])]),
    ...(item.related || []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function itemMatchesSearch(item, query, scope = 'all') {
  const normalizedQuery = normalizeKoreanKey(query).toLocaleLowerCase();
  if (!normalizedQuery) return true;
  if (scope === 'word') {
    const wordAndMeanings = [
      item.ko,
      ...(item.meanings || []).map((meaning) => meaning.zh),
    ].filter(Boolean).join(' ').normalize('NFC').toLocaleLowerCase();
    return wordAndMeanings.includes(normalizedQuery);
  }
  return itemSearchText(item).normalize('NFC').includes(normalizedQuery);
}

const koreanWordCollator = new Intl.Collator('ko-KR', {
  sensitivity: 'base',
  numeric: true,
});

function compareItemsByKoreanAlphabet(left, right) {
  const koreanOrder = koreanWordCollator.compare(
    String(left?.ko || '').normalize('NFC'),
    String(right?.ko || '').normalize('NFC'),
  );
  if (koreanOrder) return koreanOrder;

  const chineseOrder = String(left?.zh || '').localeCompare(String(right?.zh || ''), 'zh-TW');
  if (chineseOrder) return chineseOrder;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function compareQuestionsByKoreanAlphabet(left, right) {
  return compareItemsByKoreanAlphabet(
    left?.source || left,
    right?.source || right,
  ) || String(left?.id || '').localeCompare(String(right?.id || ''));
}

function SearchScopeControl({ value, onChange }) {
  return (
    <div className="search-scope segmented" aria-label="搜尋範圍">
      <button type="button" className={value === 'word' ? 'active' : ''} aria-pressed={value === 'word'} onClick={() => onChange('word')}>單字</button>
      <button type="button" className={value === 'all' ? 'active' : ''} aria-pressed={value === 'all'} onClick={() => onChange('all')}>全部</button>
    </div>
  );
}

function MultiSelectFilter({ label, options, selectedValues, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedSet = new Set(selectedValues);
  const selectedOptions = options.filter((option) => selectedSet.has(option.value));
  const summary = !selectedOptions.length
    ? '全部'
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `已選 ${selectedOptions.length} 項`;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`multi-select-filter ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="multi-select-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span><small>{label}</small><strong>{summary}</strong></span>
        <ChevronDown size={17} />
      </button>
      {open && (
        <div className="multi-select-menu" role="group" aria-label={`${label}篩選`}>
          <div className="multi-select-menu-head">
            <strong>{label}</strong>
            {!!selectedValues.length && <button type="button" className="text-link" onClick={onClear}>清除</button>}
          </div>
          <div className="multi-select-options">
            {options.map((option) => (
              <label key={option.value} className={selectedSet.has(option.value) ? 'selected' : ''}>
                <input type="checkbox" checked={selectedSet.has(option.value)} onChange={() => onToggle(option.value)} />
                <span>{option.label}</span>
                {option.count !== undefined && <small>{option.count}</small>}
              </label>
            ))}
            {!options.length && <span className="muted-note">沒有可選項目</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function IndeterminateCheckbox({ checked, indeterminate, onChange }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={inputRef} type="checkbox" checked={checked} onChange={onChange} />;
}

function GroupedFolderMultiSelect({ folders, selectedValues, onToggle, onToggleGroup, onClear, includeUnfiled = false, unfiledCount = 0 }) {
  const [open, setOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const rootRef = useRef(null);
  const selectedSet = new Set(selectedValues);
  const groups = groupFoldersByTag(folders);
  const summary = !selectedValues.length ? '全部' : `已選 ${selectedValues.length} 項`;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const toggleExpanded = (label) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    return next;
  });

  return (
    <div className={`multi-select-filter ${open ? 'open' : ''}`} ref={rootRef}>
      <button type="button" className="multi-select-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span><small>資料夾</small><strong>{summary}</strong></span>
        <ChevronDown size={17} />
      </button>
      {open && (
        <div className="multi-select-menu grouped-folder-menu" role="group" aria-label="資料夾篩選">
          <div className="multi-select-menu-head">
            <strong>依標籤選擇資料夾</strong>
            {!!selectedValues.length && <button type="button" className="text-link" onClick={onClear}>清除</button>}
          </div>
          {includeUnfiled && (
            <div className="multi-select-options folder-special-options">
              <label className={selectedSet.has(UNFILED_FOLDER_FILTER_ID) ? 'selected' : ''}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(UNFILED_FOLDER_FILTER_ID)}
                  onChange={() => onToggle(UNFILED_FOLDER_FILTER_ID)}
                />
                <span>無資料夾</span>
                <small>{unfiledCount}</small>
              </label>
            </div>
          )}
          <div className="folder-filter-groups">
            {groups.map((group) => {
              const folderIds = group.folders.map((folder) => folder.id);
              const selectedCount = folderIds.filter((id) => selectedSet.has(id)).length;
              const expanded = expandedGroups.has(group.label);
              return (
                <section className="folder-filter-group" key={group.label}>
                  <div className="folder-filter-group-head">
                    <button type="button" className="folder-group-toggle" aria-expanded={expanded} onClick={() => toggleExpanded(group.label)} title={expanded ? '收合資料夾' : '展開資料夾'}>
                      <ChevronRight size={16} />
                    </button>
                    <label>
                      <IndeterminateCheckbox
                        checked={selectedCount === folderIds.length && folderIds.length > 0}
                        indeterminate={selectedCount > 0 && selectedCount < folderIds.length}
                        onChange={() => onToggleGroup(folderIds)}
                      />
                      <span>{group.label}</span>
                      <small>{selectedCount ? `${selectedCount} / ${folderIds.length}` : folderIds.length}</small>
                    </label>
                  </div>
                  {expanded && (
                    <div className="multi-select-options folder-group-options">
                      {group.folders.map((folder) => (
                        <label key={folder.id} className={selectedSet.has(folder.id) ? 'selected' : ''}>
                          <input type="checkbox" checked={selectedSet.has(folder.id)} onChange={() => onToggle(folder.id)} />
                          <span>{folder.name}</span>
                          <small>{(folder.wordIds || []).length}</small>
                        </label>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
            {!groups.length && <span className="muted-note">沒有資料夾</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function EditIconButton({ onClick, label = '編輯' }) {
  return (
    <button
      className="edit-icon-button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
    >
      <Pencil size={15} />
    </button>
  );
}

function DeleteIconButton({ item, onDelete, label = '刪除', confirmMessage }) {
  if (!onDelete) return null;
  return (
    <button
      className="edit-icon-button delete-icon-button"
      onClick={async (event) => {
        event.stopPropagation();
        if (!window.confirm(confirmMessage || `確定要刪除「${item.ko}」嗎？`)) return;
        await onDelete(item.id);
      }}
      aria-label={label}
      title={label}
    >
      <Trash2 size={15} />
    </button>
  );
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
        <NoteCard item={item} allItems={allItems} onEdit={onEdit} onDelete={deleteAndClose} onOpenItem={onOpenItem} isStarred={isStarred} onToggleStar={onToggleStar} />
      </div>
    </div>
  );
}

function StarButton({ active, onClick }) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      className={`star-button ${active ? 'active' : ''}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      aria-label={active ? '取消星號' : '打星號'}
      title={active ? '取消星號' : '打星號'}
    >
      <Star size={17} />
    </button>
  );
}

function KoreanSpeakButton({ text, label = '播放韓文發音' }) {
  if (!text) return null;
  return (
    <button
      type="button"
      className="speak-icon-button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        speakText(text, 'ko-KR');
      }}
      aria-label={label}
      title={label}
    >
      <Volume2 size={15} />
    </button>
  );
}

function NoteCard({ item, allItems = [], folders = [], onEdit, onDelete, deleteLabel, deleteConfirmMessage, compact = false, onOpen, onOpenItem, isStarred = false, onToggleStar, selectable = false, selected = false, onToggleSelected }) {
  const examplesCount = itemExamples(item).length;
  const relatedItems = displayRelated(item, allItems);
  return (
    <article className={`note-card ${compact ? 'compact-card clickable-card' : ''} ${selected ? 'selected-word-card' : ''}`} onClick={compact ? () => onOpen(item) : undefined}>
      <div className="card-head">
        <h3 className="speakable-heading"><span>{item.ko}</span><KoreanSpeakButton text={item.ko} /></h3>
        <div className="card-actions">
          {selectable && <label className="word-select-control" title="選取單字" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected} onChange={() => onToggleSelected(item.id)} /><span className="sr-only">選取 {item.ko}</span></label>}
          <StarButton active={isStarred} onClick={onToggleStar} />
          {onEdit && <EditIconButton onClick={() => onEdit(item)} />}
          <DeleteIconButton item={item} onDelete={onDelete} label={deleteLabel} confirmMessage={deleteConfirmMessage} />
          {item.pos && <span className="badge">{item.pos}</span>}
        </div>
      </div>
      <p className="zh">{item.zh}</p>
      {compact && (
        <>
          <div className="compact-meta">
            <span>{item.date}</span>
            {!!examplesCount && <span>{examplesCount} 個例句</span>}
            {!!item.notes?.length && <span>{item.notes.length} 則筆記</span>}
          </div>
          <WordFolderTags itemId={item.id} folders={folders} />
        </>
      )}
      {!compact && <>
      <CardRichDetails item={item} relatedItems={relatedItems} onOpenItem={onOpenItem} />
      </>}
    </article>
  );
}

function CardRichDetails({ item, relatedItems = [], onOpenItem, showChinese = true }) {
  const visibleMeanings = showChinese
    ? item.meanings || []
    : (item.meanings || []).filter((meaning) => (meaning.examples || []).some((example) => example.ko));
  return (
    <div className="rich-details">
      {!!visibleMeanings.length && (
        <section className="detail-section meanings-section">
          <div className="detail-section-title"><span>{showChinese ? '意思' : '例句'}</span><small>{visibleMeanings.length} 組</small></div>
          <div className="meaning-list">
            {visibleMeanings.map((meaning, index) => (
              <article key={meaning.id} className="meaning-block">
                <div className="meaning-head">
                  <span>{index + 1}</span>
                  {showChinese && <strong>{meaning.zh}</strong>}
                </div>
                {showChinese && meaning.pattern && <div className="meaning-pattern">{meaning.pattern}</div>}
                {!!meaning.examples?.length && (
                  <div className="example-list">
                    {meaning.examples.map((ex) => (
                      <div key={ex.id || ex.ko} className="example-row">
                        <p className="example-ko"><span>{ex.ko}</span><KoreanSpeakButton text={ex.ko} /></p>
                        {showChinese && <p className="example-zh">{ex.zh}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {showChinese && !!item.notes?.length && (
        <section className="detail-section note-section">
          <div className="detail-section-title"><span>筆記</span></div>
          <MarkdownContent value={item.notes} className="note-markdown" />
        </section>
      )}
      {showChinese && !!relatedItems.length && (
        <section className="detail-section related-section">
          <div className="detail-section-title"><span>相關詞</span></div>
          <div className="tags rich-tags">
            {relatedItems.map((entry) => <RelatedWordTag key={entry.id} item={entry} onOpenItem={onOpenItem} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function MarkdownContent({ value, className = '' }) {
  const markdown = (Array.isArray(value) ? value : [value])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join('\n\n');
  if (!markdown) return null;
  return (
    <div className={`markdown-content ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={MARKDOWN_PLUGINS}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >{markdown}</ReactMarkdown>
    </div>
  );
}

function RelatedWordTag({ item, onOpenItem }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(null);
  const wrapRef = useRef(null);
  const touchPreviewRef = useRef(false);
  const label = `${item.ko}${item.zh ? ` · ${item.zh}` : ''}`;
  const Tag = onOpenItem ? 'button' : 'span';
  const updatePreviewPosition = () => {
    if (!wrapRef.current || window.matchMedia('(max-width: 920px)').matches) {
      setPreviewPosition(null);
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    const cardWidth = Math.min(360, window.innerWidth - 32);
    const edgePadding = 18;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, cardWidth / 2 + edgePadding),
      window.innerWidth - cardWidth / 2 - edgePadding,
    );
    const placeAbove = rect.top > 300;
    setPreviewPosition({
      left,
      top: placeAbove ? rect.top - 12 : rect.bottom + 12,
      transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      placement: placeAbove ? 'top' : 'bottom',
    });
  };
  const openPreview = () => {
    updatePreviewPosition();
    setPreviewOpen(true);
  };

  useEffect(() => {
    if (!previewOpen) return undefined;
    const reposition = () => updatePreviewPosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [previewOpen]);

  return (
    <span
      ref={wrapRef}
      className="related-tag-wrap"
      onMouseEnter={openPreview}
      onMouseLeave={() => setPreviewOpen(false)}
      onTouchStart={(event) => {
        event.preventDefault();
        touchPreviewRef.current = true;
        openPreview();
      }}
      onTouchEnd={() => {
        setPreviewOpen(false);
        setTimeout(() => {
          touchPreviewRef.current = false;
        }, 250);
      }}
      onTouchCancel={() => {
        setPreviewOpen(false);
        touchPreviewRef.current = false;
      }}
    >
      <Tag
        type={onOpenItem ? 'button' : undefined}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (touchPreviewRef.current) return;
          onOpenItem?.(item);
        }}
      >
        {label}
      </Tag>
      {previewOpen && createPortal(<RelatedPreviewCard item={item} position={previewPosition} />, document.body)}
    </span>
  );
}

function RelatedPreviewCard({ item, position }) {
  const firstExamples = itemExamples(item).slice(0, 2);
  const style = position ? { left: position.left, top: position.top, transform: position.transform } : undefined;
  return (
    <div className="related-preview-card" style={style} data-placement={position?.placement || 'mobile'} role="tooltip">
      <div className="preview-head">
        <strong>{item.ko}</strong>
        {item.pos && <span>{item.pos}</span>}
      </div>
      <p className="preview-zh">{item.zh}</p>
      {!!item.notes?.length && <MarkdownContent value={item.notes} className="preview-note" />}
      {!!firstExamples.length && (
        <div className="preview-examples">
          {firstExamples.map((example) => (
            <p key={example.id || example.ko}>{example.ko}<br /><span>{example.zh}</span></p>
          ))}
        </div>
      )}
    </div>
  );
}

function StudyPage({ store, updateStore, set, allItems = [], folders = [], onUpdateRecord, onBack, learnedWordIds = new Set(), unfamiliarWordIds = new Set(), onToggleLearned, onToggleUnfamiliar }) {
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
  const [markedLearnedIds, setMarkedLearnedIds] = useState(() => new Set());
  const [removedLearnedIds, setRemovedLearnedIds] = useState(() => new Set());
  const [markedUnfamiliarIds, setMarkedUnfamiliarIds] = useState(() => new Set());
  const [removedUnfamiliarIds, setRemovedUnfamiliarIds] = useState(() => new Set());
  const [folderActionSaving, setFolderActionSaving] = useState('');
  const [folderActionError, setFolderActionError] = useState('');
  const wakeLockRef = useRef(null);
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
  const isLearned = !!item
    && !removedLearnedIds.has(item.id)
    && (folderWordIdsInclude(learnedWordIds, item.id) || markedLearnedIds.has(String(item.id)));
  const isUnfamiliar = !!item
    && !removedUnfamiliarIds.has(item.id)
    && (folderWordIdsInclude(unfamiliarWordIds, item.id) || markedUnfamiliarIds.has(String(item.id)));
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
  useEffect(() => {
    setMarkedLearnedIds((current) => new Set([...current].filter((id) => !learnedWordIds.has(id))));
    setRemovedLearnedIds((current) => new Set([...current].filter((id) => learnedWordIds.has(id))));
  }, [learnedWordIds]);
  useEffect(() => {
    setMarkedUnfamiliarIds((current) => new Set([...current].filter((id) => !unfamiliarWordIds.has(id))));
    setRemovedUnfamiliarIds((current) => new Set([...current].filter((id) => unfamiliarWordIds.has(id))));
  }, [unfamiliarWordIds]);
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
  const markCurrentFolder = async (folderType) => {
    if (!item || folderActionSaving) return;
    setFolderActionSaving(folderType);
    setFolderActionError('');
    try {
      if (folderType === 'learned') {
        await onToggleLearned(item.id, isLearned);
        if (isLearned) {
          setMarkedLearnedIds((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
          setRemovedLearnedIds((current) => new Set(current).add(item.id));
        } else {
          setMarkedLearnedIds((current) => new Set(current).add(item.id));
          setRemovedLearnedIds((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
        }
      } else {
        await onToggleUnfamiliar(item.id, isUnfamiliar);
        if (isUnfamiliar) {
          setMarkedUnfamiliarIds((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
          setRemovedUnfamiliarIds((current) => new Set(current).add(item.id));
        } else {
          setMarkedUnfamiliarIds((current) => new Set(current).add(item.id));
          setRemovedUnfamiliarIds((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
        }
      }
    } catch (error) {
      setFolderActionError(error.message || '加入資料夾失敗');
    } finally {
      setFolderActionSaving('');
    }
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
    let active = true;
    const releaseWakeLock = async () => {
      const wakeLock = wakeLockRef.current;
      wakeLockRef.current = null;
      if (wakeLock && !wakeLock.released) {
        try {
          await wakeLock.release();
        } catch {
          // The browser may already have released it after hiding the page.
        }
      }
    };
    const requestWakeLock = async () => {
      if (!active || !autoPlay || document.visibilityState !== 'visible' || !navigator.wakeLock || wakeLockRef.current) return;
      try {
        const wakeLock = await navigator.wakeLock.request('screen');
        if (!active || !autoPlay) {
          await wakeLock.release();
          return;
        }
        wakeLockRef.current = wakeLock;
        wakeLock.addEventListener('release', () => {
          if (wakeLockRef.current === wakeLock) wakeLockRef.current = null;
        });
      } catch {
        // Unsupported devices keep their normal screen timeout behavior.
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestWakeLock();
      else releaseWakeLock();
    };

    if (autoPlay) requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [autoPlay]);

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
      {folderActionError && <div className="form-error study-folder-error">{folderActionError}</div>}
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
              learnedSaving={folderActionSaving === 'learned'}
              unfamiliarSaving={folderActionSaving === 'unfamiliar'}
              onMarkLearned={() => markCurrentFolder('learned')}
              onMarkUnfamiliar={() => markCurrentFolder('unfamiliar')}
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
              <StudyDetails item={item} allItems={currentItems} onOpenItem={jumpToItem} showChinese={showChinese} />
            </div>
          </div>
        </div>
        <button className="card-arrow right" onClick={goNext} aria-label="下一張"><ChevronRight size={26} /></button>
      </div>
      {editingItem && (
        <AddItemsModal
          title="編輯單字"
          date={editingItem.date}
          lockedDate
          editItem={editingItem}
          allItems={allItems}
          folders={folders}
          onUpdateRecord={onUpdateRecord}
          onClose={() => setEditingItem(null)}
        />
      )}
    </section>
  );
}

function StudyDetails({ item, allItems, onOpenItem, showChinese }) {
  const relatedItems = displayRelated(item, allItems);
  const hasDetails = showChinese
    ? item.meanings?.length || item.notes?.length || relatedItems.length
    : itemExamples(item).some((example) => example.ko);
  if (!hasDetails) return <div className="empty">這張卡片沒有韓文例句。</div>;
  return (
    <div className="study-details">
      <CardRichDetails item={item} relatedItems={relatedItems} onOpenItem={onOpenItem} showChinese={showChinese} />
    </div>
  );
}

function shouldRecordPracticeResults(practiceSet) {
  if (practiceSet?.optionalKind) return false;
  return Boolean(
    practiceSet?.dailyReview
    || (practiceSet?.allowResultRecording && practiceSet?.recordResults),
  );
}

function isSelfGradeAnswerMode(direction, answerMode = 'typing') {
  return direction === 'ko-zh' || answerMode === 'self-grade';
}

function initialPracticeDirection(practiceSet = {}) {
  return practiceSet.direction || 'ko-zh';
}

function practiceMistakeReviewQuestions(questions = [], wrongQuestionIds = []) {
  const wrongIds = new Set(wrongQuestionIds);
  const seen = new Set();
  return questions.filter((question) => {
    if (!wrongIds.has(question.id)) return false;
    const reviewKey = question.kind === 'grammar-example'
      ? `grammar:${question.id}`
      : `word:${question.itemId || question.source?.id || question.id}`;
    if (seen.has(reviewKey)) return false;
    seen.add(reviewKey);
    return true;
  });
}

function shouldAutoPronouncePracticePrompt({ started, recognitionMode, grammarMode, activeDirection, autoPronounce, recognitionWordVisible, revealed, graded, question }) {
  if (!started || !question || revealed || graded) return false;
  if (recognitionMode || grammarMode) return !recognitionWordVisible;
  return activeDirection === 'ko-zh' && autoPronounce;
}

function PracticePage({ store, updateStore, set, allItems = [], folders = [], onUpdateRecord, learnedWordIds = new Set(), unfamiliarWordIds = new Set(), onToggleLearned, onToggleUnfamiliar }) {
  const optionalMode = Boolean(set.optionalKind);
  const readingMode = set.optionalKind === 'reading';
  const [direction, setDirection] = useState(() => initialPracticeDirection(set));
  const [source, setSource] = useState('term');
  const [starredOnly, setStarredOnly] = useState(false);
  const [randomOrder, setRandomOrder] = useState(true);
  const [recordResults, setRecordResults] = useState(false);
  const [answerMode, setAnswerMode] = useState(optionalMode ? 'self-grade' : 'typing');
  const recognitionMode = set.mode === DAILY_RECOGNITION_MODE || set.optionalKind === 'listening';
  const grammarMode = set.mode === DAILY_GRAMMAR_MODE || set.optionalKind === 'grammar';
  const grammarPracticeMode = !!set.grammarOnly;
  const practiceNoteMeta = noteCategoryMeta(set.noteCategory || NOTE_CATEGORY_GRAMMAR);
  const dailyWordMode = Boolean(set.dailyReview && !recognitionMode && !grammarMode);
  const configurableWordMode = Boolean(dailyWordMode || set.repeatable);
  const fixedSource = set.termOnly || set.dueOnly || grammarPracticeMode;
  const activeDirection = recognitionMode || grammarMode || readingMode ? 'ko-zh' : direction;
  const shouldRecordResults = shouldRecordPracticeResults({ ...set, recordResults });
  const canChooseResultRecording = Boolean(set.allowResultRecording && !set.dailyReview);
  const selfGradeMode = isSelfGradeAnswerMode(activeDirection, answerMode);
  const [recognitionWordVisible, setRecognitionWordVisible] = useState(false);
  const [started, setStarted] = useState(Boolean(set.dueOnly && !configurableWordMode));
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
  const [markedLearnedIds, setMarkedLearnedIds] = useState(() => new Set());
  const [removedLearnedIds, setRemovedLearnedIds] = useState(() => new Set());
  const [markedUnfamiliarIds, setMarkedUnfamiliarIds] = useState(() => new Set());
  const [removedUnfamiliarIds, setRemovedUnfamiliarIds] = useState(() => new Set());
  const [directLearnedSaving, setDirectLearnedSaving] = useState(false);
  const [directLearnedError, setDirectLearnedError] = useState('');
  const [directUnfamiliarSaving, setDirectUnfamiliarSaving] = useState(false);
  const [directUnfamiliarError, setDirectUnfamiliarError] = useState('');
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
  const sourceQuestions = useMemo(() => {
    const starredSet = new Set(store.starred || []);
    const applyStarFilter = (list) => (starredOnly ? list.filter((q) => starredSet.has(q.itemId)) : list);
    if (optionalMode || recognitionMode || grammarMode) return set.questions;
    if (grammarPracticeMode) return set.questions.filter((q) => q.kind === 'grammar-example');
    if (set.allowAlphabeticalOrder) return [...set.questions].sort(compareQuestionsByKoreanAlphabet);
    if (set.dueOnly) return orderReviewQuestions(set.questions);
    if (direction === 'ko-zh') return applyStarFilter(set.questions.filter((q) => q.kind === 'term'));
    const activeSource = set.termOnly ? 'term' : source;
    const filtered = set.questions.filter((q) => activeSource === 'all' || q.kind === activeSource);
    const orderedFiltered = activeSource === 'all' ? orderReviewQuestions(filtered) : filtered;
    return applyStarFilter(orderedFiltered);
  }, [set.questions, source, direction, set.termOnly, set.dueOnly, set.allowAlphabeticalOrder, optionalMode, recognitionMode, grammarMode, grammarPracticeMode, store, starredOnly]);
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
  const isCurrentWordLearned = Boolean(
    question
    && !removedLearnedIds.has(question.itemId)
    && (folderWordIdsInclude(learnedWordIds, question.itemId) || markedLearnedIds.has(String(question.itemId)))
  );
  const isCurrentWordUnfamiliar = Boolean(
    question
    && !removedUnfamiliarIds.has(question.itemId)
    && (folderWordIdsInclude(unfamiliarWordIds, question.itemId) || markedUnfamiliarIds.has(String(question.itemId)))
  );
  useEffect(() => {
    setMarkedLearnedIds((current) => new Set([...current].filter((id) => !learnedWordIds.has(id))));
    setRemovedLearnedIds((current) => new Set([...current].filter((id) => learnedWordIds.has(id))));
  }, [learnedWordIds]);
  useEffect(() => {
    setMarkedUnfamiliarIds((current) => new Set([...current].filter((id) => !unfamiliarWordIds.has(id))));
    setRemovedUnfamiliarIds((current) => new Set([...current].filter((id) => unfamiliarWordIds.has(id))));
  }, [unfamiliarWordIds]);
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
    setDirectLearnedError('');
    setDirectUnfamiliarError('');
    setRecognitionWordVisible(false);
    setCompletionError('');
    setCompletionSaving(false);
    completionStartedRef.current = false;
  };
  const startSession = () => {
    const orderedQuestions = recognitionMode || grammarMode
      ? sourceQuestions
      : set.allowAlphabeticalOrder ? sourceQuestions
        : set.dueOnly ? shuffleReviewQuestionsByKind(sourceQuestions) : sourceQuestions;
    const nextQuestions = (set.allowAlphabeticalOrder || !set.dueOnly) && randomOrder
      ? shuffleItems(orderedQuestions, Date.now())
      : orderedQuestions;
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
    setDirectLearnedError('');
    setDirectUnfamiliarError('');
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
    if (!set.dueOnly || configurableWordMode) return;
    if (questionQueue.length) return;
    const nextQuestions = optionalMode || recognitionMode || grammarMode ? sourceQuestions : shuffleReviewQuestionsByKind(sourceQuestions);
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
  }, [set.dueOnly, configurableWordMode, optionalMode, recognitionMode, grammarMode, sourceQuestions, questionQueue.length]);

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
  const markCurrentWordAsLearned = async () => {
    if (!question || directLearnedSaving) return;
    setDirectLearnedSaving(true);
    setDirectLearnedError('');
    try {
      await onToggleLearned(question.itemId, isCurrentWordLearned);
      if (isCurrentWordLearned) {
        setMarkedLearnedIds((current) => {
          const next = new Set(current);
          next.delete(question.itemId);
          return next;
        });
        setRemovedLearnedIds((current) => new Set(current).add(question.itemId));
      } else {
        setMarkedLearnedIds((current) => new Set(current).add(question.itemId));
        setRemovedLearnedIds((current) => {
          const next = new Set(current);
          next.delete(question.itemId);
          return next;
        });
      }
    } catch (error) {
      setDirectLearnedError(error.message || '更新已學習資料夾失敗');
    } finally {
      setDirectLearnedSaving(false);
    }
  };
  const persistCurrentWordAsUnfamiliar = async () => {
    if (!question) return false;
    await onToggleUnfamiliar(question.itemId, isCurrentWordUnfamiliar);
    if (isCurrentWordUnfamiliar) {
      setMarkedUnfamiliarIds((current) => {
        const next = new Set(current);
        next.delete(question.itemId);
        return next;
      });
      setRemovedUnfamiliarIds((current) => new Set(current).add(question.itemId));
    } else {
      setMarkedUnfamiliarIds((current) => new Set(current).add(question.itemId));
      setRemovedUnfamiliarIds((current) => {
        const next = new Set(current);
        next.delete(question.itemId);
        return next;
      });
    }
    return true;
  };
  const markCurrentWordAsUnfamiliar = async () => {
    if (directUnfamiliarSaving) return;
    setDirectUnfamiliarSaving(true);
    setDirectUnfamiliarError('');
    try {
      await persistCurrentWordAsUnfamiliar();
    } catch (error) {
      setDirectUnfamiliarError(error.message || '更新不熟悉資料夾失敗');
    } finally {
      setDirectUnfamiliarSaving(false);
    }
  };
  const goNext = () => {
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
    setTypedAttempts(0);
    setRecognitionWordVisible(false);
    setDirectLearnedError('');
    setDirectUnfamiliarError('');
    let nextIndex = index + 1;
    if (optionalMode && !grammarMode) {
      while (nextIndex < queue.length) {
        const itemId = queue[nextIndex].itemId;
        const learned = (learnedWordIds.has(itemId) || markedLearnedIds.has(itemId)) && !removedLearnedIds.has(itemId);
        if (!learned) break;
        nextIndex += 1;
      }
    }
    if (nextIndex < queue.length) setIndex(nextIndex);
    else finishSession();
  };
  // Self-directed tests never alter long-term accuracy. Daily listening rounds
  // still update their dedicated rotation state in the recognition branch.
  const submit = async (correct) => {
    if (set.wrongReview) {
      updateStore((current) => recordDailyWrongReviewAnswer(current, question, correct));
      rememberSessionResult(question, correct);
      if (soundEnabled) playResultSound(correct);
      goNext();
      return;
    }
    if (mistakeRetryRound) {
      if (shouldRecordResults) {
        updateStore((current) => recordDailyReviewAnswer(current, question, correct, activeDirection));
      }
      rememberSessionResult(question, correct);
      if (soundEnabled) playResultSound(correct);
      goNext();
      return;
    }
    if (optionalMode) {
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
    if (recognitionMode) {
      updateStore((current) => recordDailyRecognitionAnswer(current, question, correct));
    } else if (shouldRecordResults) {
      updateStore((current) => recordDailyReviewAnswer(current, question, correct, activeDirection));
    }
    rememberSessionResult(question, correct);
    if (soundEnabled) playResultSound(correct);
    goNext();
  };
  // Used when 確認/Enter auto-grades a typed answer: records the result right
  // away (no manual 答對/答錯 choice) but keeps the question on screen so the
  // outcome is visible until the user presses Enter for the next one.
  const finalizeTypedGrade = (correct) => {
    if (set.wrongReview) {
      updateStore((current) => recordDailyWrongReviewAnswer(current, question, correct));
    } else if (shouldRecordResults) {
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

  if (!started && (!set.dueOnly || configurableWordMode)) {
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
            <button className={!randomOrder ? 'active' : ''} onClick={() => setRandomOrder(false)}>{set.allowAlphabeticalOrder ? '韓文字母順序' : '依原順序'}</button>
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
            onRetry={!set.dailyReview && mistakeQuestions.length
              ? () => startMistakeRetry(mistakeQuestions)
              : null}
          />
          {set.repeatable && !set.wrongReview && (
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
                      learnedSaving={directLearnedSaving}
                      unfamiliarSaving={directUnfamiliarSaving}
                      onMarkLearned={markCurrentWordAsLearned}
                      onMarkUnfamiliar={markCurrentWordAsUnfamiliar}
                    />
                    {directLearnedError && <small className="form-error">{directLearnedError}</small>}
                    {directUnfamiliarError && <small className="form-error">{directUnfamiliarError}</small>}
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
                  learnedSaving={directLearnedSaving}
                  unfamiliarSaving={directUnfamiliarSaving}
                  learnedError={directLearnedError}
                  unfamiliarError={directUnfamiliarError}
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
    {editingItem && (
      <AddItemsModal
        title="編輯單字"
        date={editingItem.date}
        lockedDate
        editItem={editingItem}
        allItems={allItems}
        folders={folders}
        onUpdateRecord={onUpdateRecord}
        onClose={() => setEditingItem(null)}
      />
    )}
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
                  <KoreanSpeakButton text={korean} />
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
                <NoteCard item={question.source} isStarred={isStarred} onToggleStar={onToggleStar} onEdit={onEdit} />
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

function grammarNoteSearchText(note) {
  return [
    note.title,
    note.notes,
    ...(note.examples || []).flatMap((example) => [example.ko, example.zh]),
  ].filter(Boolean).join(' ').toLocaleLowerCase('zh-TW');
}

function grammarTimestamp(value) {
  if (!value) return '建立時間未記錄';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function TextSpeakButton({ text, lang, label }) {
  if (!text) return null;
  return (
    <button
      type="button"
      className="speak-icon-button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        speakText(text, lang);
      }}
      aria-label={label}
      title={label}
    >
      <Volume2 size={15} />
    </button>
  );
}

function noteCategoryMeta(category) {
  return category === NOTE_CATEGORY_VOCABULARY
    ? {
      category: NOTE_CATEGORY_VOCABULARY,
      singular: '單字筆記',
      item: '筆記',
      heading: '單字筆記',
      eyebrow: 'Vocabulary Notes',
      addLabel: '新增單字筆記',
    }
    : {
      category: NOTE_CATEGORY_GRAMMAR,
      singular: '文法筆記',
      item: '文法',
      heading: '文法筆記',
      eyebrow: 'Grammar Notes',
      addLabel: '新增文法',
    };
}

function NotesNotebookPage({ notes, loading, error, onSave, onDelete, onPractice }) {
  const [query, setQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState(() => new Set());
  const toggleCategory = (category) => setCollapsedCategories((current) => {
    const next = new Set(current);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    return next;
  });
  const categories = [NOTE_CATEGORY_VOCABULARY, NOTE_CATEGORY_GRAMMAR];

  return (
    <section className="page notes-notebook-page">
      <div className="topbar">
        <div><span className="eyebrow">Korean Notes</span><h1>筆記</h1></div>
      </div>
      <label className="search grammar-search">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋標題、筆記或例句" />
      </label>
      {error && <div className="sync-error">Firebase 同步失敗：{error}</div>}
      {categories.map((category) => (
        <NoteCategorySection
          key={category}
          category={category}
          notes={notes}
          query={query}
          loading={loading}
          collapsed={collapsedCategories.has(category)}
          onToggleCollapse={() => toggleCategory(category)}
          onSave={onSave}
          onDelete={onDelete}
          onPractice={onPractice}
        />
      ))}
    </section>
  );
}

function NoteCategorySection({ category, notes, query, loading, collapsed, onToggleCollapse, onSave, onDelete, onPractice }) {
  const meta = noteCategoryMeta(category);
  const categoryNotes = useMemo(
    () => notes.filter((note) => note.category === category),
    [notes, category],
  );
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    setEditing(null);
    setViewing(null);
    setSelectedIds([]);
    setActionError('');
  }, [category]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-TW');
    const matches = keyword
      ? categoryNotes.filter((note) => grammarNoteSearchText(note).includes(keyword))
      : categoryNotes;
    return [...matches].sort((left, right) => (
      Number(right.pinned) - Number(left.pinned)
      || (right.createdAt || '').localeCompare(left.createdAt || '')
      || left.title.localeCompare(right.title)
    ));
  }, [categoryNotes, query]);
  useEffect(() => {
    const existingIds = new Set(categoryNotes.map((note) => note.id));
    setSelectedIds((current) => current.filter((id) => existingIds.has(id)));
  }, [categoryNotes]);
  const selectedNotes = categoryNotes.filter((note) => selectedIds.includes(note.id));
  const selectedQuestions = grammarPracticeQuestions(selectedNotes);
  const filteredIds = filtered.map((note) => note.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const toggleSelected = (noteId) => setSelectedIds((current) => (
    current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId]
  ));
  const toggleFiltered = () => setSelectedIds((current) => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredIds);
      return current.filter((id) => !filteredSet.has(id));
    }
    return [...new Set([...current, ...filteredIds])];
  });
  const startGrammarPractice = (targetNotes, label) => {
    const questions = grammarPracticeQuestions(targetNotes);
    if (!questions.length) {
      setActionError(`所選${meta.singular}沒有可練習的完整例句`);
      return;
    }
    setActionError('');
    onPractice(questions, label, { grammarOnly: true, noteCategory: category });
  };

  const deleteNote = async (note) => {
    if (!window.confirm(`確定要刪除「${note.title}」嗎？`)) return;
    setActionError('');
    try {
      await onDelete(note.id);
      if (viewing?.id === note.id) setViewing(null);
      setSelectedIds((current) => current.filter((id) => id !== note.id));
    } catch (deleteError) {
      setActionError(deleteError.message || `刪除${meta.singular}失敗`);
    }
  };
  const togglePinned = async (note) => {
    setActionError('');
    try {
      await onSave({ ...note, pinned: !note.pinned });
    } catch (pinError) {
      setActionError(pinError.message || `${note.pinned ? '取消釘選' : '釘選'}${meta.singular}失敗`);
    }
  };

  return (
    <section className={`note-category-section ${collapsed ? 'collapsed' : ''}`}>
      <div className="note-category-header">
        <button
          type="button"
          className="note-category-toggle"
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
          title={collapsed ? `展開${meta.singular}` : `收合${meta.singular}`}
        >
          <span className="note-category-heading"><span className="note-category-mark"><NotebookPen size={15} /></span><h2>{meta.heading}</h2></span>
          <span className="note-category-count">{categoryNotes.length} 篇</span>
          <ChevronDown size={19} />
        </button>
      </div>
      {!collapsed && <>
        <div className="note-category-actions">
          <button className="primary" onClick={() => setEditing({ category })}><Plus size={17} /> {meta.addLabel}</button>
        </div>
      <div className={`bulk-word-actions grammar-bulk-actions ${selectedIds.length ? 'has-selection' : ''}`}>
        <div className="bulk-selection-summary">
          <ListChecks size={19} />
          <strong>{selectedIds.length ? `已選 ${selectedIds.length} 個${meta.item}` : `選取${meta.singular}`}</strong>
          <button type="button" className="text-link" disabled={!filteredIds.length} onClick={toggleFiltered}>{allFilteredSelected ? '取消本頁' : '選取本頁'}</button>
          {!!selectedIds.length && <button type="button" className="text-link muted-link" onClick={() => setSelectedIds([])}>清除</button>}
        </div>
        {!!selectedIds.length && <div className="bulk-action-buttons">
          <button type="button" className="primary" disabled={!selectedQuestions.length} onClick={() => startGrammarPractice(selectedNotes, `已選 ${selectedNotes.length} 個${meta.item}`)}><Dumbbell size={17} /> 練習 ({selectedQuestions.length || 0})</button>
        </div>}
      </div>
      {actionError && <div className="form-error">{actionError}</div>}
      {loading ? (
        <div className="panel grammar-empty">載入{meta.singular}中...</div>
      ) : filtered.length ? (
        <div className="grammar-grid">
          {filtered.map((note) => (
            <GrammarNoteCard
              key={note.id}
              note={note}
              onOpen={setViewing}
              onEdit={setEditing}
              onDelete={deleteNote}
              onTogglePinned={togglePinned}
              selected={selectedIds.includes(note.id)}
              onToggleSelected={toggleSelected}
              category={category}
            />
          ))}
        </div>
      ) : (
        <div className="panel grammar-empty">{query ? `找不到符合搜尋條件的${meta.singular}。` : `目前還沒有${meta.singular}。`}</div>
      )}
      </>}
      {editing && (
        <GrammarEditorModal
          note={editing.id ? editing : null}
          defaultCategory={editing.category || category}
          onSave={async (note) => {
            await onSave(note);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {viewing && (
        <GrammarDetailModal
          note={viewing}
          category={viewing.category}
          onEdit={(note) => {
            setViewing(null);
            setEditing(note);
          }}
          onDelete={deleteNote}
          onPractice={(note) => {
            setViewing(null);
            startGrammarPractice([note], note.title);
          }}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}

function GrammarNoteCard({ note, onOpen, onEdit, onDelete, onTogglePinned, selected = false, onToggleSelected, category }) {
  const meta = noteCategoryMeta(category);
  return (
    <article className={`grammar-card clickable-card ${selected ? 'selected' : ''}`} onClick={() => onOpen(note)}>
      <div className="card-head">
        <h2>{note.title}</h2>
        <div className="card-actions">
          <button
            type="button"
            className={`edit-icon-button pin-icon-button ${note.pinned ? 'active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePinned(note);
            }}
            aria-label={note.pinned ? `取消釘選${meta.item}` : `釘選${meta.item}`}
            title={note.pinned ? '取消釘選' : '釘選到最上方'}
          >
            <Pin size={15} />
          </button>
          <label className="word-select-control" title={`選取${meta.item}`} onClick={(event) => event.stopPropagation()}>
            <input type="checkbox" checked={selected} onChange={() => onToggleSelected(note.id)} />
            <span className="sr-only">選取 {note.title}</span>
          </label>
          <EditIconButton onClick={() => onEdit(note)} label={`編輯${meta.item}`} />
          <button
            type="button"
            className="edit-icon-button delete-icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(note);
            }}
            aria-label={`刪除${meta.item}`}
            title={`刪除${meta.item}`}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {note.notes && <p className="grammar-card-notes">{note.notes}</p>}
      {!!note.examples.length && (
        <div className="grammar-card-example">
          <strong>{note.examples[0].ko}</strong>
          <span>{note.examples[0].zh}</span>
        </div>
      )}
      <div className="grammar-card-meta">
        <span>{grammarTimestamp(note.createdAt)}</span>
        <span>{note.examples.length} 個例句</span>
      </div>
    </article>
  );
}

function GrammarEditorModal({ note, defaultCategory = NOTE_CATEGORY_GRAMMAR, onSave, onClose }) {
  const [category, setCategory] = useState(note?.category || defaultCategory);
  const [content, setContent] = useState(() => formatTaggedNoteText(note));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const parsed = parseTaggedNoteText(content, note?.examples || []);
      await onSave({
        ...note,
        ...parsed,
        category,
      });
    } catch (saveError) {
      setError(saveError.message || '儲存筆記失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-panel grammar-editor" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-modal-head">
          <span className="eyebrow">Korean Note</span>
          <h2>{note ? '編輯筆記' : '新增筆記'}</h2>
        </div>
        <div className="grammar-field">
          <span>筆記分類</span>
          <div className="segmented compact note-category-control">
            <button type="button" className={category === NOTE_CATEGORY_GRAMMAR ? 'active' : ''} onClick={() => setCategory(NOTE_CATEGORY_GRAMMAR)}>文法筆記</button>
            <button type="button" className={category === NOTE_CATEGORY_VOCABULARY ? 'active' : ''} onClick={() => setCategory(NOTE_CATEGORY_VOCABULARY)}>單字筆記</button>
          </div>
        </div>
        <label className="grammar-field tagged-note-field">
          <span>筆記內容</span>
          <textarea
            className="tagged-note-textarea"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={26}
            spellCheck={false}
            placeholder={'[標題]\n\n表示過去反覆的習慣：動詞 + -곤 했다\n\n[筆記]\n\n用來表達「以前常常……」、「過去時常會……」。\n\n[例句]\n\n어렸을 때 주말마다 할머니 댁에 가곤 했어요.\n小時候每到週末常常會去奶奶家。'}
          />
          <small>請保留 [標題]、[筆記]、[例句]。例句使用韓文一行、中文一行，例句之間可空行。</small>
        </label>
        {error && <div className="json-edit-error">{error}</div>}
        <div className="actions grammar-editor-actions">
          <button type="button" disabled={saving} onClick={onClose}>取消</button>
          <button className="primary" disabled={saving} type="submit"><Check size={17} /> {saving ? '儲存中' : '儲存筆記'}</button>
        </div>
      </form>
    </div>
  );
}

function subtitleTimeLabel(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function readingTestTitle(test, index = 0) {
  return `閱讀題 ${index + 1}`;
}

function ReadingTestCard({ test, index, onOpen, onEdit, onDelete }) {
  return (
    <article className="reading-test-card clickable-card" onClick={() => onOpen(test.id)}>
      <div className="card-head">
        <div><span className="eyebrow">Reading · {test.options.length} choices</span><h2>{readingTestTitle(test, index)}</h2></div>
        <div className="card-actions">
          <EditIconButton label="編輯閱讀題" onClick={() => onEdit(test)} />
          <button type="button" className="edit-icon-button delete-icon-button" title="刪除閱讀題" aria-label="刪除閱讀題" onClick={(event) => { event.stopPropagation(); onDelete(test); }}><Trash2 size={15} /></button>
        </div>
      </div>
      <p>{test.passage.ko}</p>
      <div className="yt-subtitle-note-meta">
        {test.learned && <span className="yt-subtitle-learned-chip"><Check size={13} /> 已學習</span>}
        <span>{test.options.length} 個選項</span>
        <span>{grammarTimestamp(test.updatedAt || test.createdAt)}</span>
      </div>
    </article>
  );
}

function ReadingTestsPage({ tests, error, onSave, onSaveMany, onDelete, onOpen }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [hideLearned, setHideLearned] = useState(true);
  const [formatCopied, setFormatCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const learnedCount = tests.filter((test) => test.learned).length;
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-TW');
    return tests.filter((test) => (!hideLearned || !test.learned) && (!keyword || [
      test.passage.ko,
      test.passage.zh,
      test.question.ko,
      test.question.zh,
      ...test.options.flatMap((option) => [option.ko, option.zh]),
    ].filter(Boolean).join(' ').toLocaleLowerCase('zh-TW').includes(keyword)));
  }, [hideLearned, query, tests]);
  const deleteTest = async (test) => {
    if (!window.confirm('確定要刪除這題閱讀題嗎？')) return;
    setActionError('');
    try { await onDelete(test.id); } catch (deleteError) { setActionError(deleteError.message || '刪除閱讀題失敗'); }
  };
  const copyJsonFormat = async () => {
    setActionError('');
    try {
      await copyText(READING_TEST_JSON_SAMPLE);
      setFormatCopied(true);
      window.setTimeout(() => setFormatCopied(false), 1600);
    } catch {
      setActionError('無法複製 JSON 格式，請在匯入視窗中手動選取。');
    }
  };
  return (
    <section className="page reading-tests-page">
      <div className="topbar">
        <div><span className="eyebrow">Reading Practice</span><h1>閱讀測驗</h1></div>
        <div className="actions notebook-actions">
          <button className="primary" onClick={() => setEditing({})}><Plus size={18} /> 匯入題目</button>
          <ActionMenu>
            <button type="button" className={`learned-visibility-button ${hideLearned ? 'active' : ''}`} aria-pressed={hideLearned} title={`${hideLearned ? '目前隱藏' : '目前顯示'} ${learnedCount} 個已學習題目`} onClick={() => setHideLearned((current) => !current)}>
              {hideLearned ? <EyeOff size={18} /> : <Eye size={18} />}{hideLearned ? '隱藏已學習' : '顯示已學習'}
            </button>
            <button type="button" onClick={copyJsonFormat}><Copy size={18} /> {formatCopied ? '已複製格式' : '複製 JSON 格式'}</button>
          </ActionMenu>
        </div>
      </div>
      <label className="search grammar-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋韓文文章、題目、選項或中文翻譯" /></label>
      {actionError && <div className="form-error">{actionError}</div>}
      {error && <div className="sync-error">Firebase 同步失敗：{error}</div>}
      {filtered.length ? <div className="reading-test-grid">{filtered.map((test, index) => <ReadingTestCard key={test.id} test={test} index={index} onOpen={onOpen} onEdit={setEditing} onDelete={deleteTest} />)}</div>
        : <div className="panel grammar-empty">{query ? '找不到符合的閱讀題。' : hideLearned && tests.length ? '目前沒有未學習的閱讀題。取消隱藏即可查看全部題目。' : '還沒有閱讀題，請用 JSON 一次匯入一題或多題。'}</div>}
      {editing && <ReadingTestsEditorModal
        test={editing.id ? editing : null}
        existingTests={tests}
        onSave={async (nextTests) => {
          if (editing.id) await onSave(nextTests[0]);
          else await onSaveMany(nextTests);
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />}
    </section>
  );
}

const READING_TEST_JSON_SAMPLE = `{
  "schemaVersion": 1,
  "data": [
    {
      "passage": {
        "ko": "최근에는 필요한 물건을 직접 사기보다 빌려 쓰는 사람들이 많아지고 있다.",
        "zh": "最近，比起直接購買所需物品，租借使用的人愈來愈多。"
      },
      "question": {
        "ko": "이 글의 내용과 같은 것을 고르십시오.",
        "zh": "請選出與文章內容相符的選項。"
      },
      "options": [
        { "id": "1", "ko": "캠핑 용품은 직접 사는 것이 더 싸다.", "zh": "露營用品直接購買比較便宜。" },
        { "id": "2", "ko": "물건을 빌려 쓰는 사람은 점점 줄고 있다.", "zh": "租借物品使用的人正在逐漸減少。" },
        { "id": "3", "ko": "자주 사용하지 않는 물건은 보관하기 편리하다.", "zh": "不常使用的物品很方便保管。" },
        { "id": "4", "ko": "물건을 빌려 쓰면 비용과 자원을 아낄 수 있다.", "zh": "租借物品可以節省費用與資源。" }
      ],
      "answer": "4",
      "learned": false
    }
  ]
}`;

function ReadingTestsEditorModal({ test, existingTests, onSave, onClose }) {
  const [source, setSource] = useState(() => test ? formatReadingTestsJson([test]) : READING_TEST_JSON_SAMPLE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const preview = useMemo(() => {
    try {
      const parsed = parseReadingTestsJson(source, existingTests);
      if (test && parsed.length !== 1) throw new Error('編輯時 JSON 只能包含一題');
      return { tests: parsed, error: '' };
    } catch (parseError) {
      return { tests: [], error: parseError.message || '格式無法解析' };
    }
  }, [existingTests, source, test]);
  const submit = async (event) => {
    event.preventDefault();
    if (preview.error) { setError(preview.error); return; }
    setSaving(true);
    setError('');
    try { await onSave(preview.tests); } catch (saveError) { setError(saveError.message || '儲存閱讀題失敗'); } finally { setSaving(false); }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={test ? '編輯閱讀題' : '匯入閱讀題'}>
      <form className="modal-panel reading-test-editor" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-modal-head"><span className="eyebrow">Reading Practice JSON</span><h2>{test ? '編輯閱讀題' : '批次匯入閱讀題'}</h2></div>
        <label className="grammar-field tagged-note-field">
          <span>JSON 內容</span>
          <textarea className="yt-subtitle-source" value={source} onChange={(event) => setSource(event.target.value)} rows={24} spellCheck={false} />
          <small>`data` 可放多題；`passage` 是文章、`question` 是提問、`options` 是中韓選項，`answer` 必須填正確選項的 id，`learned` 預設 false。</small>
          <small className={preview.error ? 'subtitle-parse-error' : 'subtitle-parse-success'}>{preview.error || `格式正確，可儲存 ${preview.tests.length} 題`}</small>
        </label>
        {error && <div className="json-edit-error">{error}</div>}
        <div className="actions grammar-editor-actions"><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={saving || !!preview.error}><Check size={17} /> {saving ? '儲存中' : test ? '儲存修改' : `匯入 ${preview.tests.length || ''} 題`}</button></div>
      </form>
    </div>
  );
}

function ReadingKoreanText({ entry, words = [], highlights = [], onSelectWord, onSelectHighlight }) {
  const knownMatches = subtitleWordMatches(entry.ko, words);
  const highlightMatches = highlights.filter((highlight) => (
    highlight.entryId === entry.id
    && entry.ko.slice(highlight.start, highlight.end) === highlight.text
  ));
  const boundaries = [...new Set([
    0,
    entry.ko.length,
    ...knownMatches.flatMap((match) => [match.start, match.end]),
    ...highlightMatches.flatMap((highlight) => [highlight.start, highlight.end]),
  ])].sort((left, right) => left - right);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const text = entry.ko.slice(start, end);
    const known = knownMatches.find((match) => match.start <= start && match.end >= end);
    const highlight = highlightMatches.find((match) => match.start <= start && match.end >= end);
    if (!known && !highlight) return <React.Fragment key={`text-${start}`}>{text}</React.Fragment>;
    return (
      <mark
        className={`${known ? 'subtitle-known-word' : ''} ${highlight ? 'reading-text-highlight' : ''}`.trim()}
        onClick={(event) => (known ? onSelectWord(event, known.word) : onSelectHighlight(event, highlight, entry))}
        key={`mark-${start}`}
      >{text}</mark>
    );
  });
}

function ReadingTestPage({ test, allItems = [], folders = [], onAddRecords, onUpdateRecord, onDeleteRecord, onOpenFolder, onSave, onDelete, onBack }) {
  const [selected, setSelected] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [quickAdd, setQuickAdd] = useState(null);
  const [selectionAction, setSelectionAction] = useState(null);
  const [definitionBubble, setDefinitionBubble] = useState(null);
  const [editingWord, setEditingWord] = useState(null);
  const [localHighlights, setLocalHighlights] = useState([]);
  const selectionUpdateFrameRef = useRef(null);
  const selectionClearTimerRef = useRef(null);
  useEffect(() => {
    setSelected('');
    setSubmitted(false);
    setError('');
    setLocalHighlights([]);
  }, [test?.id]);
  const entries = useMemo(() => test ? [
    { id: `${test.id}-passage`, ko: test.passage.ko, zh: test.passage.zh },
    { id: `${test.id}-question`, ko: test.question.ko, zh: test.question.zh },
    ...test.options.map((option) => ({ id: `${test.id}-option-${option.id}`, ko: option.ko, zh: option.zh })),
  ] : [], [test]);
  const readingFolder = useMemo(() => folders.find((folder) => (
    !isSystemFolder(folder) && folder.name.toLocaleLowerCase() === READING_SOURCE_FOLDER_NAME.toLocaleLowerCase()
  )) || null, [folders]);
  const readingWords = useMemo(() => {
    const wordIds = new Set(readingFolder?.wordIds || []);
    return allItems.filter((item) => wordIds.has(item.id));
  }, [allItems, readingFolder]);
  const updateSelectionAction = useCallback(() => {
    if (selectionUpdateFrameRef.current !== null) window.cancelAnimationFrame(selectionUpdateFrameRef.current);
    selectionUpdateFrameRef.current = window.requestAnimationFrame(() => {
      selectionUpdateFrameRef.current = null;
      const selection = window.getSelection();
      const clearLater = () => {
        if (selectionClearTimerRef.current !== null) window.clearTimeout(selectionClearTimerRef.current);
        selectionClearTimerRef.current = window.setTimeout(() => {
          selectionClearTimerRef.current = null;
          setSelectionAction(null);
        }, 120);
      };
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
        clearLater();
        return;
      }
      const range = selection.getRangeAt(0);
      const selectionElement = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
      const startSource = selectionElement(range.startContainer)?.closest?.('[data-reading-entry-id]');
      const endSource = selectionElement(range.endContainer)?.closest?.('[data-reading-entry-id]');
      const entryId = startSource?.dataset.readingEntryId;
      const rawSelection = selection.toString();
      const selectedKo = rawSelection.trim();
      const entry = entries.find((candidate) => candidate.id === entryId);
      const rect = range.getBoundingClientRect();
      if (!entryId || startSource !== endSource || !selectedKo || (!rect.width && !rect.height)) {
        clearLater();
        return;
      }
      const leadingWhitespace = rawSelection.length - rawSelection.trimStart().length;
      const precedingRange = range.cloneRange();
      precedingRange.selectNodeContents(startSource);
      precedingRange.setEnd(range.startContainer, range.startOffset);
      const start = precedingRange.toString().length + leadingWhitespace;
      const end = start + selectedKo.length;
      if (entry.ko.slice(start, end) !== selectedKo) {
        clearLater();
        return;
      }
      if (selectionClearTimerRef.current !== null) {
        window.clearTimeout(selectionClearTimerRef.current);
        selectionClearTimerRef.current = null;
      }
      setSelectionAction({
        ko: selectedKo,
        entry,
        start,
        end,
        top: rect.bottom + 8,
        left: Math.min(Math.max(10, rect.left + (rect.width / 2) - 63), window.innerWidth - 136),
      });
    });
  }, [entries]);
  useEffect(() => {
    document.addEventListener('selectionchange', updateSelectionAction);
    window.addEventListener('scroll', updateSelectionAction, true);
    window.addEventListener('resize', updateSelectionAction);
    return () => {
      document.removeEventListener('selectionchange', updateSelectionAction);
      window.removeEventListener('scroll', updateSelectionAction, true);
      window.removeEventListener('resize', updateSelectionAction);
      if (selectionUpdateFrameRef.current !== null) window.cancelAnimationFrame(selectionUpdateFrameRef.current);
      if (selectionClearTimerRef.current !== null) window.clearTimeout(selectionClearTimerRef.current);
    };
  }, [updateSelectionAction]);
  useEffect(() => {
    const dismissDefinition = (event) => {
      if (!event.target?.closest?.('.subtitle-known-word, .subtitle-word-definition')) setDefinitionBubble(null);
    };
    const dismissOnScroll = () => setDefinitionBubble(null);
    document.addEventListener('pointerdown', dismissDefinition);
    window.addEventListener('scroll', dismissOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', dismissDefinition);
      window.removeEventListener('scroll', dismissOnScroll, true);
    };
  }, []);
  if (!test) return <section className="page"><div className="empty">找不到這題閱讀測驗。<button onClick={onBack}>返回上一層</button></div></section>;
  const selectedCorrectly = selected === test.answer;
  const toggleLearned = async () => {
    setError('');
    try { await onSave({ ...test, learned: !test.learned }); } catch (saveError) { setError(saveError.message || '更新已學習狀態失敗'); }
  };
  const deleteTest = async () => {
    if (!window.confirm('確定要刪除這題閱讀題嗎？')) return;
    try { await onDelete(test.id); onBack(); } catch (deleteError) { setError(deleteError.message || '刪除閱讀題失敗'); }
  };
  const showDefinition = (event, word) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setDefinitionBubble({
      word,
      zh: word.zh,
      top: Math.max(10, rect.top - 8),
      left: Math.min(Math.max(105, rect.left + (rect.width / 2)), window.innerWidth - 105),
    });
  };
  const showHighlightActions = (event, highlight, entry) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setSelectionAction({
      ko: highlight.text,
      entry,
      start: highlight.start,
      end: highlight.end,
      highlight,
      top: rect.bottom + 8,
      left: Math.min(Math.max(10, rect.left + (rect.width / 2) - 63), window.innerWidth - 136),
    });
  };
  const addHighlight = () => {
    const highlight = {
      id: createId(),
      entryId: selectionAction.entry.id,
      text: selectionAction.ko,
      start: selectionAction.start,
      end: selectionAction.end,
    };
    const alreadyExists = localHighlights.some((current) => (
      current.entryId === highlight.entryId && current.start === highlight.start && current.end === highlight.end
    ));
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
    if (alreadyExists) return;
    setLocalHighlights((current) => [...current, highlight]);
  };
  const removeHighlight = () => {
    if (!selectionAction?.highlight) return;
    setLocalHighlights((current) => current.filter((highlight) => highlight.id !== selectionAction.highlight.id));
    setSelectionAction(null);
  };
  const deleteWord = async (word) => {
    if (!window.confirm(`確定要刪除「${word.ko}」嗎？`)) return;
    setError('');
    try { await onDeleteRecord(word.id); setDefinitionBubble(null); } catch (deleteError) { setError(deleteError.message || '刪除單字失敗'); }
  };
  const selectableKorean = (entry) => (
    <span className="reading-korean-source" data-reading-entry-id={entry.id} lang="ko">
      <ReadingKoreanText entry={entry} words={readingWords} highlights={localHighlights} onSelectWord={showDefinition} onSelectHighlight={showHighlightActions} />
    </span>
  );
  return (
    <section className="page reading-test-reader">
      <div className="topbar">
        <div><span className="eyebrow">Reading Practice</span><h1>閱讀題</h1></div>
        <div className="actions notebook-actions">
          <button type="button" className={`learned-visibility-button ${test.learned ? 'active' : ''}`} aria-pressed={test.learned} title={test.learned ? '取消已學習' : '標記已學習'} onClick={toggleLearned}>{test.learned ? <Check size={18} /> : <BookOpen size={18} />}已學習</button>
          <button type="button" onClick={() => setEditing(true)}><Pencil size={17} /> 編輯</button>
          <button type="button" className="delete-icon-button" onClick={deleteTest}><Trash2 size={17} /> 刪除</button>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      {selectionAction && <div className="subtitle-selection-actions" style={{ top: selectionAction.top, left: selectionAction.left }}>
        <button
          type="button"
          className="subtitle-selection-add"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setQuickAdd(selectionAction);
            setSelectionAction(null);
            window.getSelection()?.removeAllRanges();
          }}
          title="新增單字"
          aria-label="將選取的韓文新增為單字"
        ><Plus size={18} /></button>
        <a
          className="subtitle-selection-dictionary"
          href={naverDictionaryUrl(selectionAction.ko)}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setSelectionAction(null);
            window.getSelection()?.removeAllRanges();
          }}
          title="使用 Naver 字典查詢"
          aria-label={`使用 Naver 字典查詢「${selectionAction.ko}」`}
        ><BookMarked size={18} /></a>
        {!selectionAction.highlight && <button
          type="button"
          className="subtitle-selection-highlight"
          onMouseDown={(event) => event.preventDefault()}
          onClick={addHighlight}
          title="畫線"
          aria-label={`畫線標記「${selectionAction.ko}」`}
        ><Highlighter size={18} /></button>}
        {selectionAction.highlight && <button
          type="button"
          className="subtitle-selection-remove-highlight"
          onMouseDown={(event) => event.preventDefault()}
          onClick={removeHighlight}
          title="刪除畫線"
          aria-label={`刪除「${selectionAction.ko}」的畫線`}
        ><Trash2 size={18} /></button>}
      </div>}
      {definitionBubble && <div className="subtitle-word-definition reading-word-definition" style={{ top: definitionBubble.top, left: definitionBubble.left }} role="dialog" aria-label={`${definitionBubble.word.ko}的單字資訊`}>
        <span><strong>{definitionBubble.word.ko}</strong>{definitionBubble.zh}</span>
        <div>
          <button type="button" onClick={() => { setEditingWord(definitionBubble.word); setDefinitionBubble(null); }} title="編輯單字" aria-label="編輯單字"><Pencil size={15} /></button>
          <button type="button" className="delete-icon-button" onClick={() => deleteWord(definitionBubble.word)} title="刪除單字" aria-label="刪除單字"><Trash2 size={15} /></button>
        </div>
      </div>}
      {readingFolder && <div className="reading-reader-floating-actions"><button type="button" className="yt-reader-floating-button" onClick={() => onOpenFolder?.(readingFolder.id)} title={`開啟資料夾「${readingFolder.name}」`} aria-label={`開啟資料夾「${readingFolder.name}」`}><FolderOpen size={22} /></button></div>}
      <article className="reading-passage">
        <p>{selectableKorean(entries[0])}</p>
        {submitted && <p className="reading-translation">{test.passage.zh}</p>}
      </article>
      <div className="reading-question"><h2>{selectableKorean(entries[1])}</h2>{submitted && <p>{test.question.zh}</p>}</div>
      <div className="reading-options" role="radiogroup" aria-label="閱讀題選項">
        {test.options.map((option, index) => {
          const correct = submitted && option.id === test.answer;
          const incorrect = submitted && option.id === selected && !correct;
          return <label className={`reading-option ${selected === option.id ? 'selected' : ''} ${correct ? 'correct' : ''} ${incorrect ? 'incorrect' : ''}`} key={option.id}>
            <input type="radio" name="reading-answer" value={option.id} checked={selected === option.id} disabled={submitted} onChange={() => setSelected(option.id)} />
            <span className="reading-option-number">{['①', '②', '③', '④', '⑤', '⑥'][index] || option.id}</span>
            <span><strong>{selectableKorean(entries[index + 2])}</strong>{submitted && <small>{option.zh}</small>}</span>
            {correct && <Check size={20} />}
            {incorrect && <X size={20} />}
          </label>;
        })}
      </div>
      {!submitted ? <button type="button" className="primary reading-submit" disabled={!selected} onClick={() => setSubmitted(true)}><Check size={18} /> 確認答案</button>
        : <div className={`reading-result ${selectedCorrectly ? 'correct' : 'incorrect'}`}><strong>{selectedCorrectly ? '答對了' : '答錯了'}</strong><span>正確答案是選項 {test.answer}</span><button type="button" onClick={() => { setSelected(''); setSubmitted(false); }}>再做一次</button></div>}
      {editing && <ReadingTestsEditorModal test={test} existingTests={[test]} onSave={async (tests) => { await onSave(tests[0]); setEditing(false); }} onClose={() => setEditing(false)} />}
      {quickAdd && <SubtitleQuickAddModal selection={quickAdd} entries={entries} allItems={allItems} sourceLabel="閱讀題" includeInitialExample={false} initialMarkLearned={false} onAddRecords={(records, options) => onAddRecords(test, records, options)} onClose={() => setQuickAdd(null)} />}
      {editingWord && <AddItemsModal title="編輯單字" date={editingWord.date} lockedDate editItem={editingWord} allItems={allItems} onUpdateRecord={onUpdateRecord} onClose={() => setEditingWord(null)} />}
    </section>
  );
}

function YoutubeSubtitleCard({ note, onOpen, onEdit, onDelete }) {
  return (
    <article className="yt-subtitle-note-card clickable-card" onClick={() => onOpen(note.id)}>
      <div className="card-head">
        <div><span className="eyebrow">{note.mode === YT_SUBTITLE_MODE_SRT ? 'SRT subtitles' : 'Bilingual subtitles'}</span><h2>{note.title}</h2></div>
        <div className="card-actions">
          <EditIconButton label="編輯字幕筆記" onClick={() => onEdit(note)} />
          <button
            type="button"
            className="edit-icon-button delete-icon-button"
            title="刪除字幕筆記"
            aria-label="刪除字幕筆記"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(note);
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <p>{note.mode === YT_SUBTITLE_MODE_SRT ? '可點擊字幕跳轉影片時間' : '中韓逐句字幕'}</p>
      <div className="yt-subtitle-note-meta">
        <span className="yt-subtitle-tag-chip">{youtubeSubtitleTagLabel(note)}</span>
        {note.learned && <span className="yt-subtitle-learned-chip"><Check size={13} /> 已學習</span>}
        <span>{note.entries.length} 句</span>
        <span>{note.videoId ? '已嵌入影片' : '沒有影片連結'}</span>
        <span>{grammarTimestamp(note.updatedAt || note.createdAt)}</span>
      </div>
    </article>
  );
}

function YoutubeSubtitlesPage({ notes, error, onSave, onDelete, onOpen }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [actionError, setActionError] = useState('');
  const [collapsedTags, setCollapsedTags] = useState(() => new Set());
  const [hideLearned, setHideLearned] = useState(true);
  const visibleNotes = useMemo(() => (hideLearned ? notes.filter((note) => !note.learned) : notes), [hideLearned, notes]);
  const learnedCount = notes.filter((note) => note.learned).length;
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-TW');
    if (!keyword) return visibleNotes;
    return visibleNotes.filter((note) => [note.title, note.tag, note.youtubeUrl, ...note.entries.flatMap((entry) => [entry.ko, entry.zh])]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('zh-TW')
      .includes(keyword));
  }, [query, visibleNotes]);
  const groups = useMemo(() => groupYoutubeSubtitlesByTag(filtered), [filtered]);
  const tagSuggestions = useMemo(() => groupYoutubeSubtitlesByTag(notes)
    .filter((group) => group.label !== UNTAGGED_FOLDER_LABEL)
    .map((group) => group.label), [notes]);
  const toggleTag = (tag) => setCollapsedTags((current) => {
    const next = new Set(current);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    return next;
  });
  const deleteNote = async (note) => {
    if (!window.confirm(`確定要刪除「${note.title}」嗎？`)) return;
    setActionError('');
    try {
      await onDelete(note.id);
    } catch (deleteError) {
      setActionError(deleteError.message || '刪除字幕筆記失敗');
    }
  };

  return (
    <section className="page yt-subtitles-page">
      <div className="topbar">
        <div><span className="eyebrow">YouTube Subtitles</span><h1>YT 字幕</h1></div>
        <div className="actions notebook-actions">
          <button className="primary" onClick={() => setEditing({})}><Plus size={18} /> 新增字幕</button>
          <ActionMenu>
            <button
              type="button"
              className={`learned-visibility-button ${hideLearned ? 'active' : ''}`}
              aria-pressed={hideLearned}
              title={`${hideLearned ? '目前隱藏' : '目前顯示'} ${learnedCount} 個已學習字幕檔案`}
              onClick={() => setHideLearned((current) => !current)}
            >
              {hideLearned ? <EyeOff size={18} /> : <Eye size={18} />}
              {hideLearned ? '隱藏已學習' : '顯示已學習'}
            </button>
          </ActionMenu>
        </div>
      </div>
      <label className="search grammar-search">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋標題、標籤、影片連結或字幕內容" />
      </label>
      {actionError && <div className="form-error">{actionError}</div>}
      {error && <div className="sync-error">Firebase 同步失敗：{error}</div>}
      {filtered.length ? (
        <div className="folder-tag-groups yt-subtitle-tag-groups">
          {groups.map((group) => {
            const collapsed = collapsedTags.has(group.label);
            return (
              <section className={`folder-tag-group ${collapsed ? 'collapsed' : ''}`} key={group.label}>
                <div className="folder-tag-group-head">
                  <button
                    type="button"
                    className="folder-tag-group-toggle"
                    aria-expanded={!collapsed}
                    onClick={() => toggleTag(group.label)}
                    title={collapsed ? `展開${group.label}` : `收合${group.label}`}
                  >
                    <span className="folder-tag-group-heading"><span className="folder-tag-mark">標籤</span><h2>{group.label}</h2></span>
                    <ChevronDown size={18} />
                  </button>
                  <span>{group.notes.length} 個字幕檔案</span>
                </div>
                {!collapsed && (
                  <div className="yt-subtitle-note-grid">
                    {group.notes.map((note) => <YoutubeSubtitleCard key={note.id} note={note} onOpen={onOpen} onEdit={setEditing} onDelete={deleteNote} />)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : <div className="panel grammar-empty">{query ? '找不到符合的字幕筆記。' : hideLearned && notes.length ? '目前沒有未學習的字幕筆記。取消隱藏即可查看全部字幕。' : '還沒有字幕筆記。新增一篇後即可放入中韓字幕。'}</div>}
      {editing && (
        <YoutubeSubtitleEditorModal
          note={editing.id ? editing : null}
          tagSuggestions={tagSuggestions}
          onSave={async (note) => {
            await onSave(note);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function YoutubeSubtitleEditorModal({ note, tagSuggestions = [], onSave, onClose }) {
  const initialMode = note?.mode === YT_SUBTITLE_MODE_SRT ? YT_SUBTITLE_MODE_SRT : YT_SUBTITLE_MODE_JSON;
  const [title, setTitle] = useState(note?.title || '');
  const [tag, setTag] = useState(note?.tag || '');
  const [learned, setLearned] = useState(note?.learned === true);
  const [youtubeUrl, setYoutubeUrl] = useState(note?.youtubeUrl || '');
  const [mode, setMode] = useState(initialMode);
  const [jsonText, setJsonText] = useState(() => formatYoutubeSubtitleJson(note?.entries || []));
  const [srtText, setSrtText] = useState(() => formatYoutubeSubtitleSrt(note?.entries || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const activeText = mode === YT_SUBTITLE_MODE_SRT ? srtText : jsonText;
  const setActiveText = mode === YT_SUBTITLE_MODE_SRT ? setSrtText : setJsonText;
  const preview = useMemo(() => {
    if (!activeText.trim()) return null;
    try {
      const entries = mode === YT_SUBTITLE_MODE_SRT ? parseYoutubeSubtitleSrt(activeText, note?.entries || []) : parseYoutubeSubtitleJson(activeText, note?.entries || []);
      return { count: entries.length, error: '' };
    } catch (parseError) {
      return { count: 0, error: parseError.message || '格式無法解析' };
    }
  }, [activeText, mode, note?.entries]);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const entries = mode === YT_SUBTITLE_MODE_SRT
        ? parseYoutubeSubtitleSrt(srtText, note?.entries || [])
        : parseYoutubeSubtitleJson(jsonText, note?.entries || []);
      await onSave({ ...note, title, tag, learned, youtubeUrl, mode, entries });
    } catch (saveError) {
      setError(saveError.message || '儲存字幕筆記失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-panel yt-subtitle-editor" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-modal-head"><span className="eyebrow">YouTube Subtitles</span><h2>{note ? '編輯字幕筆記' : '新增字幕筆記'}</h2></div>
        <label className="grammar-field"><span>標題</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：影片名稱或主題" autoFocus required /></label>
        <label className="grammar-field">
          <span>標籤 <small>選填</small></span>
          <input value={tag} onChange={(event) => setTag(event.target.value)} list="yt-subtitle-tag-suggestions" placeholder="留空會歸類為無標籤" />
          {!!tagSuggestions.length && <datalist id="yt-subtitle-tag-suggestions">{tagSuggestions.map((suggestion) => <option value={suggestion} key={suggestion} />)}</datalist>}
        </label>
        <label className="yt-subtitle-learned-option">
          <input type="checkbox" checked={learned} onChange={(event) => setLearned(event.target.checked)} />
          <span><strong>已學習</strong><small>標示完成後，預設不顯示在 YT 字幕列表中。</small></span>
        </label>
        <label className="grammar-field"><span>YouTube 連結 <small>選填</small></span><input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." /></label>
        <div className="grammar-field">
          <span>字幕格式</span>
          <div className="segmented compact note-category-control">
            <button type="button" className={mode === YT_SUBTITLE_MODE_JSON ? 'active' : ''} onClick={() => setMode(YT_SUBTITLE_MODE_JSON)}>JSON 逐句字幕</button>
            <button type="button" className={mode === YT_SUBTITLE_MODE_SRT ? 'active' : ''} onClick={() => setMode(YT_SUBTITLE_MODE_SRT)}>SRT 時間字幕</button>
          </div>
        </div>
        <label className="grammar-field tagged-note-field">
          <span>{mode === YT_SUBTITLE_MODE_SRT ? 'SRT 字幕內容' : 'JSON 字幕內容'}</span>
          <textarea
            className="yt-subtitle-source"
            value={activeText}
            onChange={(event) => setActiveText(event.target.value)}
            spellCheck={false}
            rows={18}
            placeholder={mode === YT_SUBTITLE_MODE_SRT
              ? '1\n00:00:01,000 --> 00:00:04,000\n안녕하세요.\n你好。'
              : '{\n  "data": [\n    { "ko": "안녕하세요.", "zh": "你好。" }\n  ]\n}'}
          />
          <small>{mode === YT_SUBTITLE_MODE_SRT ? '每一段依序填入時間戳、韓文、中文。點擊字幕會跳轉到開始時間。' : '請使用 { "data": [{ "ko": "韓文", "zh": "中文" }] } 格式。'}</small>
          {preview && <small className={preview.error ? 'subtitle-parse-error' : 'subtitle-parse-success'}>{preview.error || `可匯入 ${preview.count} 句字幕`}</small>}
        </label>
        {error && <div className="json-edit-error">{error}</div>}
        <div className="actions grammar-editor-actions"><button type="button" disabled={saving} onClick={onClose}>取消</button><button className="primary" disabled={saving} type="submit"><Check size={17} /> {saving ? '儲存中' : '儲存字幕筆記'}</button></div>
      </form>
    </div>
  );
}

function SubtitleKoreanText({ text, words, onSelectWord }) {
  const matches = subtitleWordMatches(text, words);
  if (!matches.length) return text;
  const parts = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    if (match.start > cursor) parts.push(<React.Fragment key={`text-${cursor}`}>{text.slice(cursor, match.start)}</React.Fragment>);
    parts.push(<mark className="subtitle-known-word" onClick={(event) => onSelectWord(event, match.word)} key={`word-${match.start}-${index}`}>{text.slice(match.start, match.end)}</mark>);
    cursor = match.end;
  });
  if (cursor < text.length) parts.push(<React.Fragment key={`text-${cursor}`}>{text.slice(cursor)}</React.Fragment>);
  return parts;
}

function YoutubeSubtitleReader({ note, allItems = [], folders = [], onAddRecords, onBack, onOpenFolder, onSave, onDelete }) {
  const [showChinese, setShowChinese] = useState(true);
  const [editing, setEditing] = useState(null);
  const [quickAdd, setQuickAdd] = useState(null);
  const [selectionAction, setSelectionAction] = useState(null);
  const [definitionBubble, setDefinitionBubble] = useState(null);
  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [activeSubtitleEntryId, setActiveSubtitleEntryId] = useState(null);
  const [error, setError] = useState('');
  const iframeRef = useRef(null);
  const youtubePlayerRef = useRef(null);
  const subtitleListRef = useRef(null);
  const subtitleEntryRefs = useRef(new Map());
  const selectionUpdateFrameRef = useRef(null);
  const selectionClearTimerRef = useRef(null);
  useEffect(() => {
    document.documentElement.classList.add('yt-reader-scroll-snap');
    document.body.classList.add('yt-reader-scroll-snap');
    return () => {
      document.documentElement.classList.remove('yt-reader-scroll-snap');
      document.body.classList.remove('yt-reader-scroll-snap');
    };
  }, []);
  useEffect(() => {
    setPlayerLoaded(false);
    setIsVideoPlaying(false);
    setActiveSubtitleEntryId(null);
  }, [note?.id]);
  const updateSelectionAction = useCallback(() => {
    if (selectionUpdateFrameRef.current !== null) window.cancelAnimationFrame(selectionUpdateFrameRef.current);
    selectionUpdateFrameRef.current = window.requestAnimationFrame(() => {
      selectionUpdateFrameRef.current = null;
      const selection = window.getSelection();
      const clearLater = () => {
        if (selectionClearTimerRef.current !== null) window.clearTimeout(selectionClearTimerRef.current);
        selectionClearTimerRef.current = window.setTimeout(() => {
          selectionClearTimerRef.current = null;
          setSelectionAction(null);
        }, 120);
      };
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
        clearLater();
        return;
      }
      const range = selection.getRangeAt(0);
      const selectionElement = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
      const startCard = selectionElement(range.startContainer)?.closest?.('.yt-subtitle-entry');
      const endCard = selectionElement(range.endContainer)?.closest?.('.yt-subtitle-entry');
      const subtitleElement = startCard?.querySelector?.('[data-subtitle-entry-id]');
      const entryId = subtitleElement?.dataset.subtitleEntryId;
      const selectedKo = selection.toString().replace(/\s+/g, ' ').trim();
      const rect = range.getBoundingClientRect();
      const entry = note?.entries.find((candidate) => candidate.id === entryId);
      const entryKo = String(entry?.ko || '').replace(/\s+/g, ' ').trim();
      const selectionIsKoreanSubtitle = startCard
        && startCard === endCard
        && entryKo.includes(selectedKo);
      if (!entryId || !selectionIsKoreanSubtitle || !selectedKo || (!rect.width && !rect.height)) {
        clearLater();
        return;
      }
      if (selectionClearTimerRef.current !== null) {
        window.clearTimeout(selectionClearTimerRef.current);
        selectionClearTimerRef.current = null;
      }
      setSelectionAction({
        ko: selectedKo,
        entry,
        top: rect.bottom + 8,
        left: Math.min(Math.max(10, rect.left + (rect.width / 2) - 41), window.innerWidth - 92),
      });
    });
  }, [note]);
  useEffect(() => {
    document.addEventListener('selectionchange', updateSelectionAction);
    window.addEventListener('scroll', updateSelectionAction, true);
    window.addEventListener('resize', updateSelectionAction);
    return () => {
      document.removeEventListener('selectionchange', updateSelectionAction);
      window.removeEventListener('scroll', updateSelectionAction, true);
      window.removeEventListener('resize', updateSelectionAction);
      if (selectionUpdateFrameRef.current !== null) window.cancelAnimationFrame(selectionUpdateFrameRef.current);
      if (selectionClearTimerRef.current !== null) window.clearTimeout(selectionClearTimerRef.current);
    };
  }, [updateSelectionAction]);
  const subtitleFolder = useMemo(() => folders.find((folder) => (
    !isSystemFolder(folder) && folder.name.toLocaleLowerCase() === YT_SOURCE_FOLDER_NAME.toLocaleLowerCase()
  )) || null, [folders]);
  const subtitleWords = useMemo(() => {
    const wordIds = new Set(subtitleFolder?.wordIds || []);
    return allItems.filter((item) => wordIds.has(item.id));
  }, [allItems, subtitleFolder]);
  useEffect(() => {
    const dismissDefinition = (event) => {
      if (!event.target?.closest?.('.subtitle-known-word, .subtitle-word-definition')) setDefinitionBubble(null);
    };
    const dismissOnScroll = () => setDefinitionBubble(null);
    document.addEventListener('pointerdown', dismissDefinition);
    window.addEventListener('scroll', dismissOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', dismissDefinition);
      window.removeEventListener('scroll', dismissOnScroll, true);
    };
  }, []);
  useEffect(() => {
    if (!note?.videoId || !iframeRef.current) return undefined;
    let disposed = false;
    let player = null;
    loadYoutubeIframeApi()
      .then((YT) => {
        if (disposed || !iframeRef.current) return;
        player = new YT.Player(iframeRef.current, {
          events: {
            onReady: () => {
              if (disposed) return;
              youtubePlayerRef.current = player;
              setPlayerLoaded(true);
            },
            onStateChange: (event) => {
              if (!disposed) setIsVideoPlaying(event.data === 1);
            },
          },
        });
      })
      .catch((playerError) => {
        if (!disposed) setError(playerError.message || 'YouTube 播放器無法同步字幕');
      });
    return () => {
      disposed = true;
      if (youtubePlayerRef.current === player) youtubePlayerRef.current = null;
      player?.destroy?.();
    };
  }, [note?.id, note?.videoId]);
  useEffect(() => {
    if (!playerLoaded || note?.mode !== YT_SUBTITLE_MODE_SRT) return undefined;
    const syncCurrentSubtitle = () => {
      try {
        const currentTime = Number(youtubePlayerRef.current?.getCurrentTime?.());
        if (!Number.isFinite(currentTime)) return;
        setActiveSubtitleEntryId(subtitleEntryAtTime(note.entries, currentTime * 1000)?.id || null);
      } catch {
        // The YouTube player can reject a read while its iframe is being reinitialized.
      }
    };
    syncCurrentSubtitle();
    const interval = window.setInterval(syncCurrentSubtitle, 350);
    return () => window.clearInterval(interval);
  }, [note?.entries, note?.mode, playerLoaded]);
  useEffect(() => {
    if (!activeSubtitleEntryId) return;
    const list = subtitleListRef.current;
    const entry = subtitleEntryRefs.current.get(activeSubtitleEntryId);
    if (!list || !entry) return;
    const listRect = list.getBoundingClientRect();
    const entryRect = entry.getBoundingClientRect();
    const listCanScroll = list.scrollHeight > list.clientHeight + 2;
    if (listCanScroll) {
      list.scrollTo({
        top: Math.max(0, list.scrollTop + entryRect.top - listRect.top - ((list.clientHeight - entryRect.height) / 2)),
        behavior: 'smooth',
      });
      return;
    }
  }, [activeSubtitleEntryId]);
  if (!note) return <section className="page"><div className="empty">找不到這篇字幕筆記。<button onClick={onBack}>返回上一層</button></div></section>;
  const seekTo = (entry) => {
    if (note.mode !== YT_SUBTITLE_MODE_SRT || entry.startMs === null || !youtubePlayerRef.current) return;
    youtubePlayerRef.current.seekTo(entry.startMs / 1000, true);
    youtubePlayerRef.current.playVideo();
    setIsVideoPlaying(true);
    setActiveSubtitleEntryId(entry.id);
    window.requestAnimationFrame(() => {
      const list = subtitleListRef.current;
      const element = subtitleEntryRefs.current.get(entry.id);
      if (!list || !element) return;
      const listRect = list.getBoundingClientRect();
      const entryRect = element.getBoundingClientRect();
      list.scrollTo({
        top: Math.max(0, list.scrollTop + entryRect.top - listRect.top - ((list.clientHeight - entryRect.height) / 2)),
        behavior: 'smooth',
      });
    });
  };
  const pauseVideo = () => {
    try {
      youtubePlayerRef.current?.pauseVideo?.();
      setIsVideoPlaying(false);
    } catch {
      // The YouTube iframe may be between player states while the selection starts.
    }
  };
  const toggleVideoPlayback = () => {
    const player = youtubePlayerRef.current;
    if (!player) return;
    try {
      const playing = player.getPlayerState?.() === 1;
      if (playing) player.pauseVideo?.();
      else player.playVideo?.();
      setIsVideoPlaying(!playing);
    } catch {
      setError('YouTube 播放器尚未準備完成，請稍後再試。');
    }
  };
  const deleteNote = async () => {
    if (!window.confirm(`確定要刪除「${note.title}」嗎？`)) return;
    setError('');
    try {
      await onDelete(note.id);
      onBack();
    } catch (deleteError) {
      setError(deleteError.message || '刪除字幕筆記失敗');
    }
  };
  const embedOrigin = typeof window === 'undefined' ? '' : `&origin=${encodeURIComponent(window.location.origin)}`;
  const embedUrl = note.videoId ? `${YOUTUBE_EMBED_ORIGIN}/embed/${note.videoId}?enablejsapi=1&rel=0${embedOrigin}` : '';
  const showDefinition = (event, word) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setDefinitionBubble({
      zh: word.zh,
      top: Math.max(10, rect.top - 8),
      left: Math.min(Math.max(10, rect.left + (rect.width / 2)), window.innerWidth - 18),
    });
  };

  return (
    <section className="page yt-reader-page">
      <div className="topbar yt-reader-topbar">
        <span className="eyebrow">{note.mode === YT_SUBTITLE_MODE_SRT ? 'SRT subtitles' : 'Bilingual subtitles'}</span>
        <div className="yt-reader-title-line">
          <h1>{note.title}</h1>
          <div className="actions">
            <EditIconButton label="編輯字幕筆記" onClick={() => setEditing(note)} />
            <button className="edit-icon-button delete-icon-button" onClick={deleteNote} title="刪除字幕筆記" aria-label="刪除字幕筆記"><Trash2 size={15} /></button>
          </div>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      {selectionAction && <div className="subtitle-selection-actions" style={{ top: selectionAction.top, left: selectionAction.left }}>
        <button
          type="button"
          className="subtitle-selection-add"
          onMouseDown={(event) => {
            event.preventDefault();
            pauseVideo();
          }}
          onClick={() => {
            pauseVideo();
            setQuickAdd(selectionAction);
            setSelectionAction(null);
            window.getSelection()?.removeAllRanges();
          }}
          title="新增單字"
          aria-label="將選取的韓文新增為單字"
        ><Plus size={18} /></button>
        <a
          className="subtitle-selection-dictionary"
          href={naverDictionaryUrl(selectionAction.ko)}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(event) => {
            event.preventDefault();
            pauseVideo();
          }}
          onClick={() => {
            pauseVideo();
            setSelectionAction(null);
            window.getSelection()?.removeAllRanges();
          }}
          title="使用 Naver 字典查詢"
          aria-label={`使用 Naver 字典查詢「${selectionAction.ko}」`}
        ><BookMarked size={18} /></a>
      </div>}
      {definitionBubble && <div className="subtitle-word-definition" style={{ top: definitionBubble.top, left: definitionBubble.left }} role="status">{definitionBubble.zh}</div>}
      <div className="yt-reader-floating-actions" aria-label="字幕閱讀控制">
        {embedUrl && <button type="button" className="yt-reader-floating-button" onClick={toggleVideoPlayback} disabled={!playerLoaded} title={isVideoPlaying ? '暫停影片' : '播放影片'} aria-label={isVideoPlaying ? '暫停影片' : '播放影片'}>{isVideoPlaying ? <Pause size={22} /> : <Play size={22} />}</button>}
        <button type="button" className={`yt-reader-floating-button ${showChinese ? 'selected' : ''}`} onClick={() => setShowChinese((current) => !current)} title={showChinese ? '隱藏中文' : '顯示中文'} aria-label={showChinese ? '隱藏中文' : '顯示中文'}>{showChinese ? <Eye size={22} /> : <EyeOff size={22} />}</button>
        {subtitleFolder && <button type="button" className="yt-reader-floating-button" onClick={() => onOpenFolder?.(subtitleFolder.id)} title={`開啟資料夾「${subtitleFolder.name}」`} aria-label={`開啟資料夾「${subtitleFolder.name}」`}><FolderOpen size={22} /></button>}
      </div>
      <div className="yt-reader-content">
        <div className="yt-reader-video">
          {embedUrl ? <div className="yt-video-frame"><iframe ref={iframeRef} src={embedUrl} title={note.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div> : <div className="yt-video-missing"><Link2 size={22} /><span>這篇字幕筆記沒有 YouTube 影片連結。</span></div>}
        </div>
        <div className="yt-subtitle-list" ref={subtitleListRef} aria-label="字幕列表">
          {note.entries.map((entry, index) => {
            const clickable = note.mode === YT_SUBTITLE_MODE_SRT && entry.startMs !== null && !!embedUrl;
            const content = <><strong><span className="yt-subtitle-entry-index">{index + 1}</span>{entry.startMs !== null && <small className="yt-subtitle-entry-time">{subtitleTimeLabel(entry.startMs)}</small>}<span className="yt-subtitle-ko" data-subtitle-entry-id={entry.id} onPointerDown={pauseVideo}><SubtitleKoreanText text={entry.ko} words={subtitleWords} onSelectWord={showDefinition} /></span></strong><p className={!showChinese ? 'is-hidden' : ''} aria-hidden={!showChinese}>{entry.zh}</p></>;
            const isPlaying = activeSubtitleEntryId === entry.id;
            const className = `yt-subtitle-entry ${clickable ? 'clickable' : ''} ${isPlaying ? 'is-playing' : ''}`;
            const setEntryRef = (element) => {
              if (element) subtitleEntryRefs.current.set(entry.id, element);
              else subtitleEntryRefs.current.delete(entry.id);
            };
            const openWholeEntryQuickAdd = (event) => {
              event.preventDefault();
              event.stopPropagation();
              pauseVideo();
              setQuickAdd({ ko: entry.ko, zh: entry.zh, entry });
              setSelectionAction(null);
              window.getSelection()?.removeAllRanges();
            };
            return <article
              ref={setEntryRef}
              className={className}
              aria-current={isPlaying ? 'true' : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => seekTo(entry) : undefined}
              onKeyDown={clickable ? (event) => {
                if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
                  event.preventDefault();
                  seekTo(entry);
                }
              } : undefined}
              key={entry.id}
            >
              <button type="button" className="yt-subtitle-entry-add" onPointerDown={(event) => { event.stopPropagation(); pauseVideo(); }} onClick={openWholeEntryQuickAdd} title="將整句新增為單字" aria-label={`將第 ${index + 1} 句新增為單字`}><Plus size={16} /></button>
              {content}
            </article>;
          })}
        </div>
      </div>
      {quickAdd && <SubtitleQuickAddModal selection={quickAdd} entries={note.entries} allItems={allItems} onAddRecords={(records, options) => onAddRecords(note, records, options)} onClose={() => setQuickAdd(null)} />}
      {editing && <YoutubeSubtitleEditorModal note={editing} onSave={async (nextNote) => { await onSave(nextNote); setEditing(null); }} onClose={() => setEditing(null)} />}
    </section>
  );
}

function SubtitleQuickAddModal({ selection, entries = [], allItems, sourceLabel = '字幕', includeInitialExample = true, initialMarkLearned = true, onAddRecords, onClose }) {
  const [ko, setKo] = useState(selection.ko);
  const [zh, setZh] = useState(selection.zh || '');
  const [examples, setExamples] = useState(() => includeInitialExample ? formatPairLines([selection.entry]) : '');
  const entryIndex = entries.findIndex((entry) => entry.id === selection.entry.id);
  const [previousIndex, setPreviousIndex] = useState(entryIndex - 1);
  const [nextIndex, setNextIndex] = useState(entryIndex + 1);
  const [exampleHistory, setExampleHistory] = useState([]);
  const [markLearned, setMarkLearned] = useState(initialMarkLearned);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const extendExample = (entry, position) => {
    try {
      const currentExamples = parsePairLines(examples);
      const current = {
        ko: currentExamples.map((example) => example.ko).join(' ').trim(),
        zh: currentExamples.map((example) => example.zh).join('').trim(),
      };
      const combined = position === 'before'
        ? { ko: `${entry.ko} ${current.ko}`.trim(), zh: `${entry.zh}${current.zh}`.trim() }
        : { ko: `${current.ko} ${entry.ko}`.trim(), zh: `${current.zh}${entry.zh}`.trim() };
      setExampleHistory((history) => [...history, { examples, previousIndex, nextIndex }]);
      setExamples(formatPairLines([combined]));
      if (position === 'before') setPreviousIndex((index) => index - 1);
      else setNextIndex((index) => index + 1);
      setError('');
      return true;
    } catch {
      setError('例句需要維持韓文一行、中文一行的格式，才能加入相鄰逐字稿。');
      return false;
    }
  };
  const addPreviousExample = () => {
    if (previousIndex < 0) return;
    extendExample(entries[previousIndex], 'before');
  };
  const addNextExample = () => {
    if (nextIndex >= entries.length) return;
    extendExample(entries[nextIndex], 'after');
  };
  const undoExampleExtension = () => {
    if (!exampleHistory.length) return;
    const previous = exampleHistory[exampleHistory.length - 1];
    setExamples(previous.examples);
    setPreviousIndex(previous.previousIndex);
    setNextIndex(previous.nextIndex);
    setExampleHistory((history) => history.slice(0, -1));
    setError('');
  };
  const submit = async (event) => {
    event.preventDefault();
    const korean = ko.trim();
    const chinese = zh.trim();
    if (!korean || !chinese) {
      setError('韓文與中文都是必填');
      return;
    }
    if (allItems.some((item) => normalizeKoreanKey(item.ko) === normalizeKoreanKey(korean))) {
      setError(`韓文單字「${korean}」已存在於單字本，請直接編輯既有單字卡。`);
      return;
    }
    setError('');
    let parsedExamples;
    try {
      parsedExamples = parsePairLines(examples);
    } catch (parseError) {
      setError(parseError.message || '例句格式錯誤，請確認每組都是韓文一行、中文一行。');
      return;
    }
    setSaving(true);
    try {
      const records = createRecordsForDate(todayString(), [{
        ko: korean,
        meanings: [{ zh: chinese, examples: parsedExamples }],
        related: [],
      }], allItems);
      await onAddRecords(records, { markLearned });
      onClose();
    } catch (submitError) {
      setError(describeImportError(submitError).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`從${sourceLabel}新增單字`}>
      <form className="modal-panel subtitle-quick-add-modal" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose} disabled={saving} aria-label="關閉"><X size={18} /></button>
        <div className="panel-title"><div><span className="eyebrow">Selected word</span><h2>新增單字</h2><span>{includeInitialExample ? `例句已自動帶入目前${sourceLabel}。` : '可視需要自行加入例句。'}</span></div></div>
        <div className="form-grid subtitle-quick-add-fields">
          <label>韓文<input value={ko} onChange={(event) => setKo(event.target.value)} required autoFocus /></label>
          <label>中文<input value={zh} onChange={(event) => setZh(event.target.value)} required placeholder="請填寫中文意思" /></label>
          <div className="full-width subtitle-example-field">
            <label htmlFor="subtitle-quick-add-examples">例句</label>
            {includeInitialExample && <span className="subtitle-example-extend-actions">
              <button type="button" className="small" onClick={addPreviousExample} disabled={previousIndex < 0} title="加入前一句逐字稿"><ArrowUp size={16} /><Plus size={14} /> 往前加</button>
              <button type="button" className="small" onClick={addNextExample} disabled={nextIndex >= entries.length} title="加入後一句逐字稿"><ArrowDown size={16} /><Plus size={14} /> 往後加</button>
              <button type="button" className="small subtitle-example-undo" onClick={undoExampleExtension} disabled={!exampleHistory.length} title="復原上一次例句延伸" aria-label="復原上一次例句延伸"><RotateCcw size={16} /></button>
            </span>}
            <textarea id="subtitle-quick-add-examples" value={examples} onChange={(event) => { setExamples(event.target.value); setExampleHistory([]); }} rows={4} />
          </div>
          <label className="subtitle-quick-add-learned"><input type="checkbox" checked={markLearned} onChange={(event) => setMarkLearned(event.target.checked)} /><span><strong>已學會</strong><small>同時加入「已學習」資料夾，不會出現在每日測驗。</small></span></label>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="actions grammar-editor-actions"><button type="button" onClick={onClose} disabled={saving}>取消</button><button className="primary" type="submit" disabled={saving}><Plus size={17} /> {saving ? '新增中' : '新增到單字本'}</button></div>
      </form>
    </div>
  );
}

function GrammarDetailModal({ note, category, onEdit, onDelete, onPractice, onClose }) {
  const meta = noteCategoryMeta(category);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.isComposing) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel grammar-detail-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="grammar-detail-head">
          <div><span className="eyebrow">{meta.eyebrow}</span><h2>{note.title}</h2></div>
          <div className="card-actions">
            <button className="small grammar-detail-practice" disabled={!grammarPracticeQuestions([note]).length} onClick={() => onPractice(note)}><Dumbbell size={16} /> 練習</button>
            <EditIconButton onClick={() => onEdit(note)} label={`編輯${meta.item}`} />
            <button className="edit-icon-button delete-icon-button" onClick={() => onDelete(note)} aria-label={`刪除${meta.item}`} title={`刪除${meta.item}`}><Trash2 size={15} /></button>
          </div>
        </div>
        <div className="grammar-created-at">建立於 {grammarTimestamp(note.createdAt)}</div>
        {note.notes && (
          <section className="grammar-detail-section">
            <h3>筆記</h3>
            <div className="grammar-notes-content">{note.notes}</div>
          </section>
        )}
        {!!note.examples.length && (
          <section className="grammar-detail-section">
            <h3>例句 <span>{note.examples.length}</span></h3>
            <div className="grammar-example-list">
              {note.examples.map((example, index) => (
                <article className="grammar-example" key={example.id}>
                  <div className="grammar-example-number">{index + 1}</div>
                  {example.ko && <p className="grammar-example-ko"><span>{example.ko}</span><TextSpeakButton text={example.ko} lang="ko-KR" label="播放韓文例句" /></p>}
                  {example.zh && <p className="grammar-example-zh"><span>{example.zh}</span><TextSpeakButton text={example.zh} lang="zh-TW" label="播放中文翻譯" /></p>}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function WordFolderTags({ itemId, folders = [] }) {
  const memberships = folders.filter((folder) => folder.wordIds.includes(itemId));
  if (!memberships.length) return null;
  return (
    <div className="word-folder-tags" aria-label="所屬資料夾">
      {memberships.map((folder) => <span key={folder.id}><Folder size={12} /> {folder.name}</span>)}
    </div>
  );
}

function FolderPickerDropdown({ folders, selectedFolderIds, requiredFolderIds = [], onToggle, showCounts = false, title = '加入資料夾', wide = true }) {
  const selectedSet = new Set(selectedFolderIds);
  const requiredSet = new Set(requiredFolderIds);
  const orderedFolders = selectedFoldersFirst(folders, selectedFolderIds);
  const selectedNames = folders
    .filter((folder) => selectedSet.has(folder.id))
    .map((folder) => folder.name);
  const summary = selectedNames.length
    ? selectedNames.length <= 2 ? selectedNames.join('、') : `已選 ${selectedNames.length} 個資料夾`
    : '尚未選擇';

  return (
    <details className={`${wide ? 'wide-field ' : ''}folder-picker-dropdown`}>
      <summary>
        <span className="folder-picker-dropdown-title"><Folder size={17} /><strong>{title}</strong><small>選填</small></span>
        <span className="folder-picker-dropdown-summary">{summary}</span>
        <ChevronDown size={17} className="folder-picker-chevron" />
      </summary>
      <div className="folder-picker-dropdown-menu">
        {orderedFolders.map((folder) => {
          const required = requiredSet.has(folder.id);
          return (
            <label className={selectedSet.has(folder.id) ? 'selected' : ''} key={folder.id}>
              <input
                type="checkbox"
                checked={selectedSet.has(folder.id)}
                disabled={required}
                onChange={() => onToggle(folder.id)}
              />
              <Folder size={16} />
              <span><strong>{folder.name}</strong>{showCounts && <small>{folder.wordIds.length} 個單字</small>}</span>
              {required && <small className="folder-required-label">目前資料夾</small>}
            </label>
          );
        })}
      </div>
    </details>
  );
}

function FolderAssignmentModal({ folders, wordIds, onAssign, onCreateFolderAndAssign, onClose }) {
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderTag, setNewFolderTag] = useState('');
  const [savingAction, setSavingAction] = useState('');
  const [error, setError] = useState('');
  const toggleFolder = (folderId) => setSelectedFolderIds((current) => (
    current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId]
  ));
  const submit = async (event) => {
    event.preventDefault();
    if (!selectedFolderIds.length) return;
    setSavingAction('existing');
    setError('');
    try {
      await onAssign(selectedFolderIds, wordIds);
      onClose(true);
    } catch (saveError) {
      setError(saveError.message || '加入資料夾失敗');
      setSavingAction('');
    }
  };
  const createAndAssign = async () => {
    if (!newFolderName.trim()) return;
    setSavingAction('create');
    setError('');
    try {
      await onCreateFolderAndAssign(newFolderName, wordIds, selectedFolderIds, newFolderTag);
      onClose(true);
    } catch (saveError) {
      setError(saveError.message || '建立資料夾失敗');
      setSavingAction('');
    }
  };
  const saving = !!savingAction;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="assign-folder-title">
      <form className="modal-panel folder-assignment-modal" onSubmit={submit}>
        <button type="button" className="modal-close" disabled={saving} onClick={() => onClose(false)} aria-label="關閉"><X size={18} /></button>
        <span className="eyebrow">Batch organize</span>
        <h2 id="assign-folder-title">將 {wordIds.length} 個單字加入資料夾</h2>
        <p>可以同時選擇多個資料夾；原本已存在的關聯不會重複。</p>
        {folders.length ? (
          <FolderPickerDropdown
            folders={folders}
            selectedFolderIds={selectedFolderIds}
            onToggle={toggleFolder}
            showCounts
          />
        ) : <div className="empty small-empty">還沒有資料夾，可以直接在下方建立。</div>}
        <section className="create-folder-during-assignment">
          <div>
            <FolderPlus size={20} />
            <span><strong>建立新資料夾</strong><small>新資料夾會立即加入這 {wordIds.length} 個單字</small></span>
          </div>
          <div className="create-folder-inline-form">
            <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createAndAssign(); } }} maxLength={60} placeholder="輸入新資料夾名稱" disabled={saving} />
            <input value={newFolderTag} onChange={(event) => setNewFolderTag(event.target.value)} maxLength={40} placeholder="標籤（選填）" list="assignment-folder-tag-options" disabled={saving} />
            <button type="button" className="soft-button" disabled={!newFolderName.trim() || saving} onClick={createAndAssign}>{savingAction === 'create' ? '建立中' : '建立並加入'}</button>
          </div>
          <datalist id="assignment-folder-tag-options">{[...new Set(folders.map((folder) => folder.tag).filter(Boolean))].map((tag) => <option value={tag} key={tag} />)}</datalist>
          {!!selectedFolderIds.length && <small>也會同時加入上方已勾選的 {selectedFolderIds.length} 個資料夾。</small>}
        </section>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <button type="button" onClick={() => onClose(false)} disabled={saving}>取消</button>
          <button className="primary" disabled={!selectedFolderIds.length || saving}>{savingAction === 'existing' ? '加入中' : '加入所選'}</button>
        </div>
      </form>
    </div>
  );
}

function BulkWordActions({ selectedIds, visibleIds, folders, onSelectionChange, onAssignFolders, onCreateFolderAndAssign, onDeleteRecords, currentFolder, onRemoveFromCurrentFolder }) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const selectedSet = new Set(selectedIds);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));
  const toggleVisible = () => {
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleIds);
      onSelectionChange(selectedIds.filter((id) => !visibleSet.has(id)));
    } else {
      onSelectionChange([...new Set([...selectedIds, ...visibleIds])]);
    }
  };
  const runAction = async (action, handler) => {
    setBusyAction(action);
    setError('');
    try {
      await handler();
      onSelectionChange([]);
    } catch (actionError) {
      setError(actionError.message || '批次操作失敗');
    } finally {
      setBusyAction('');
    }
  };
  const removeFromFolder = () => {
    if (!window.confirm(`確定要將所選 ${selectedIds.length} 個單字從「${currentFolder.name}」移除嗎？單字本中的卡片會保留。`)) return;
    runAction('remove', () => onRemoveFromCurrentFolder(currentFolder.id, selectedIds));
  };
  const permanentlyDelete = () => {
    if (!window.confirm(`確定要永久刪除所選 ${selectedIds.length} 個單字嗎？這些卡片也會從單字本與所有資料夾刪除，且無法復原。`)) return;
    runAction('delete', () => onDeleteRecords(selectedIds));
  };
  return (
    <>
      <div className={`bulk-word-actions ${selectedIds.length ? 'has-selection' : ''}`}>
        <div className="bulk-selection-summary">
          <ListChecks size={19} />
          <strong>{selectedIds.length ? `已選 ${selectedIds.length} 個` : '批次選取'}</strong>
          <button type="button" className="text-link" disabled={!visibleIds.length || !!busyAction} onClick={toggleVisible}>{allVisibleSelected ? '取消本頁' : '選取本頁'}</button>
          {!!selectedIds.length && <button type="button" className="text-link muted-link" disabled={!!busyAction} onClick={() => onSelectionChange([])}>清除</button>}
        </div>
        {!!selectedIds.length && <div className="bulk-action-buttons">
          <button type="button" disabled={!selectedIds.length || !!busyAction} onClick={() => setAssignOpen(true)}><FolderInput size={17} /> 加入資料夾</button>
          {currentFolder && <button type="button" disabled={!selectedIds.length || !!busyAction} onClick={removeFromFolder} title="只從目前資料夾移除，保留單字卡"><X size={17} /> {busyAction === 'remove' ? '移除中' : '移出資料夾'}</button>}
          <button type="button" className="danger-soft" disabled={!selectedIds.length || !!busyAction} onClick={permanentlyDelete} title="從單字本與所有資料夾永久刪除"><Trash2 size={17} /> {busyAction === 'delete' ? '刪除中' : '永久刪除'}</button>
        </div>}
      </div>
      {error && <div className="form-error bulk-action-error">{error}</div>}
      {assignOpen && (
        <FolderAssignmentModal
          folders={folders}
          wordIds={selectedIds}
          onAssign={onAssignFolders}
          onCreateFolderAndAssign={onCreateFolderAndAssign}
          onClose={(completed) => {
            setAssignOpen(false);
            if (completed) onSelectionChange([]);
          }}
        />
      )}
    </>
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
  const [query, setQuery] = useState('');
  const [searchScope, setSearchScope] = useState('word');
  const [pageNumber, setPageNumber] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [addExistingOpen, setAddExistingOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const starredSet = new Set(store.starred || []);
  const toggleSelected = (itemId) => setSelectedIds((current) => (
    current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
  ));

  useEffect(() => setPageNumber(1), [query, searchScope, folder?.id]);
  useEffect(() => setSelectedIds([]), [folder?.id]);

  if (!folder) return <section className="page"><div className="empty">找不到這個資料夾，可能已在其他裝置刪除。</div></section>;

  const itemById = new Map(items.map((item) => [item.id, item]));
  const folderItems = folder.wordIds.map((id) => itemById.get(id)).filter(Boolean);
  const staleIds = folder.wordIds.filter((id) => !itemById.has(id));
  const itemQuestionIds = new Map(folderItems.map((item) => [item.id, questions.filter((question) => question.itemId === item.id).map((question) => question.id)]));
  const enriched = folderItems.map((item) => {
    const stats = aggregateItemStats(store, itemQuestionIds.get(item.id) || [item.id]);
    return { ...item, ...stats };
  }).filter((item) => itemMatchesSearch(item, query, searchScope));
  const pageSize = 30;
  const pageCount = Math.max(1, Math.ceil(enriched.length / pageSize));
  const pagedItems = enriched.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  const folderItemIds = new Set(folderItems.map((item) => item.id));
  const folderQuestions = questions.filter((question) => folderItemIds.has(question.itemId));
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
          <button onClick={() => setAddOpen(true)}><Plus size={18} /> 新增</button>
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
        <label className="search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchScope === 'word' ? '搜尋韓文單字或中文意思' : '搜尋這個資料夾中的全部卡片內容'} /></label>
        <SearchScopeControl value={searchScope} onChange={setSearchScope} />
      </div>
      {!!staleIds.length && <button className="text-link" onClick={() => onRemoveWords(folder.id, staleIds)}>清理 {staleIds.length} 個不存在的單字 reference</button>}
      {exportOpen && <ExportJsonModal items={folderItems} title={`匯出 ${folder.name} JSON`} onClose={() => setExportOpen(false)} />}
      {renameOpen && <FolderNameModal folder={folder} tagSuggestions={[...new Set(folders.map((entry) => entry.tag).filter(Boolean))]} onSave={onSaveFolder} onClose={() => setRenameOpen(false)} />}
      {addExistingOpen && <AddExistingWordsModal folder={folder} items={items} onAdd={onAddWords} onClose={() => setAddExistingOpen(false)} />}
      {addOpen && (
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
          onEditExisting={(item) => { setAddOpen(false); setViewingItem(item); }}
          onClose={() => setAddOpen(false)}
        />
      )}
      {editingItem && <AddItemsModal title="編輯單字" date={editingItem.date} lockedDate editItem={editingItem} allItems={items} folders={folders} onUpdateRecord={onUpdateRecord} onClose={() => setEditingItem(null)} />}
      {viewingItem && (
        <ItemDetailModal
          item={viewingItem}
          allItems={items}
          isStarred={starredSet.has(viewingItem.id)}
          onToggleStar={() => toggleStarredItem(updateStore, viewingItem.id)}
          onOpenItem={setViewingItem}
          onEdit={(item) => { setViewingItem(null); setEditingItem(item); }}
          onDelete={onDeleteRecord}
          onClose={() => setViewingItem(null)}
        />
      )}
      <BulkWordActions
        selectedIds={selectedIds}
        visibleIds={pagedItems.map((item) => item.id)}
        folders={folders}
        onSelectionChange={setSelectedIds}
        onAssignFolders={onAssignFolders}
        onCreateFolderAndAssign={onCreateFolderAndAssign}
        onDeleteRecords={onDeleteRecords}
        currentFolder={folder}
        onRemoveFromCurrentFolder={onRemoveWords}
      />
      {pagedItems.length ? <div className="notes-grid">{pagedItems.map((item) => (
        <NoteCard
          key={item.id}
          item={item}
          allItems={items}
          folders={folders}
          compact
          onOpen={setViewingItem}
          onEdit={setEditingItem}
          onDelete={(itemId) => onRemoveWords(folder.id, [itemId])}
          deleteLabel="從資料夾移除"
          deleteConfirmMessage={`確定要將「${item.ko}」從資料夾移除嗎？單字本中的卡片不會被刪除。`}
          isStarred={starredSet.has(item.id)}
          onToggleStar={() => toggleStarredItem(updateStore, item.id)}
          selectable
          selected={selectedIds.includes(item.id)}
          onToggleSelected={toggleSelected}
        />
      ))}</div> : <div className="empty">{query ? '找不到符合的單字' : '這個資料夾還沒有單字'}</div>}
      {pageCount > 1 && <div className="pagination"><button disabled={pageNumber <= 1} onClick={() => setPageNumber(pageNumber - 1)}><ChevronLeft size={18} /> 上一頁</button><span>{pageNumber} / {pageCount} · 共 {enriched.length} 筆</span><button disabled={pageNumber >= pageCount} onClick={() => setPageNumber(pageNumber + 1)}>下一頁 <ChevronRight size={18} /></button></div>}
    </section>
  );
}

function NotebookPage({ store, updateStore, items, questions, folders = [], onAssignFolders, onCreateFolderAndAssign, onPractice, onStudy, onAddRecords, onUpdateRecord, onUpdateRecords, onDeleteRecord, onDeleteRecords }) {
  const [query, setQuery] = useState('');
  const [searchScope, setSearchScope] = useState('word');
  const [selectedLevels, setSelectedLevels] = useState([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [sort, setSort] = useState('default');
  const [pageNumber, setPageNumber] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [jsonEditOpen, setJsonEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showLearned, setShowLearned] = useState(false);
  const starredSet = new Set(store.starred || []);
  const learnedWordIds = new Set(folders.find(isLearnedFolder)?.wordIds || []);
  const notebookItems = showLearned ? items : items.filter((item) => !learnedWordIds.has(item.id));
  const folderFilteredItems = filterItemsByFolderSelection(notebookItems, folders, selectedFolderIds);
  const assignedWordIds = new Set(folders.flatMap((folder) => folder.wordIds || []));
  const unfiledCount = notebookItems.filter((item) => !assignedWordIds.has(item.id)).length;
  const toggleSelected = (itemId) => setSelectedIds((current) => (
    current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
  ));
  const toggleLevel = (level) => setSelectedLevels((current) => (
    current.includes(level) ? current.filter((entry) => entry !== level) : [...current, level]
  ));
  const toggleFolderFilter = (folderId) => setSelectedFolderIds((current) => (
    current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId]
  ));
  const toggleFolderTag = (folderIds) => setSelectedFolderIds((current) => toggleFolderGroupSelection(current, folderIds));
  const itemQuestionIds = new Map(items.map((item) => [item.id, questions.filter((q) => q.itemId === item.id).map((q) => q.id)]));
  const enriched = folderFilteredItems.map((item) => {
    const ids = itemQuestionIds.get(item.id) || [item.id];
    return { ...item, ...aggregateItemStats(store, ids) };
  }).filter((item) => {
    const matchesQuery = itemMatchesSearch(item, query, searchScope);
    const matchesLevel = matchesFamiliarityLevels(item.level, selectedLevels, item.score);
    return matchesQuery && matchesLevel;
  }).sort((a, b) => {
    if (sort === 'alphabetical') return compareItemsByKoreanAlphabet(a, b);
    if (sort === 'score') return a.score - b.score;
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.order !== b.order) return b.order - a.order;
    return a.id.localeCompare(b.id);
  });
  const pageSize = 30;
  const pageCount = Math.max(1, Math.ceil(enriched.length / pageSize));
  const pagedItems = enriched.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  const practiceQuestions = questions.filter((question) => enriched.some((item) => item.id === question.itemId));

  useEffect(() => {
    setPageNumber(1);
  }, [query, searchScope, selectedLevels, selectedFolderIds, sort]);

  useEffect(() => {
    const availableFolderIds = new Set([UNFILED_FOLDER_FILTER_ID, ...folders.map((folder) => folder.id)]);
    setSelectedFolderIds((current) => current.filter((folderId) => availableFolderIds.has(folderId)));
  }, [folders]);

  useEffect(() => {
    setPageNumber(1);
    setSelectedIds([]);
  }, [showLearned]);

  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Notebook</span><h1>單字本</h1></div>
        <div className="actions notebook-actions">
          <button className="add-date-button" onClick={() => setAddOpen(true)}><Plus size={18} /> 新增</button>
          <button onClick={() => onStudy(enriched, '篩選結果')} disabled={!enriched.length} title="學習目前篩選出的單字"><BookOpen size={18} /> 學習</button>
          <button className="primary" onClick={() => onPractice(practiceQuestions, '篩選結果測驗', { allowResultRecording: true })} disabled={!practiceQuestions.length} title="測驗目前篩選出的單字"><Dumbbell size={18} /> 測驗</button>
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
          <label className="search"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchScope === 'word' ? '搜尋韓文單字或中文意思' : '搜尋單字、例句、筆記或相關詞'} /></label>
          <SearchScopeControl value={searchScope} onChange={setSearchScope} />
        </div>
        <MultiSelectFilter
          label="熟悉度"
          options={FAMILIARITY_FILTER_OPTIONS}
          selectedValues={selectedLevels}
          onToggle={toggleLevel}
          onClear={() => setSelectedLevels([])}
        />
        <GroupedFolderMultiSelect
          folders={folders}
          selectedValues={selectedFolderIds}
          onToggle={toggleFolderFilter}
          onToggleGroup={toggleFolderTag}
          onClear={() => setSelectedFolderIds([])}
          includeUnfiled
          unfiledCount={unfiledCount}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="default">最新</option>
          <option value="alphabetical">韓文字母</option>
          <option value="score">低分優先</option>
        </select>
      </div>
      {addOpen && (
        <AddItemsModal
          title="新增單字"
          date={todayString()}
          allItems={items}
          folders={folders}
          onAddRecords={onAddRecords}
          onUpdateRecord={onUpdateRecord}
          onWriteRecords={onUpdateRecords}
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
      {viewingItem && (
        <ItemDetailModal
          item={viewingItem}
          allItems={items}
          isStarred={starredSet.has(viewingItem.id)}
          onToggleStar={() => toggleStarredItem(updateStore, viewingItem.id)}
          onOpenItem={setViewingItem}
          onEdit={(item) => {
            setViewingItem(null);
            setEditingItem(item);
          }}
          onDelete={onDeleteRecord}
          onClose={() => setViewingItem(null)}
        />
      )}
      <BulkWordActions
        selectedIds={selectedIds}
        visibleIds={pagedItems.map((item) => item.id)}
        folders={folders}
        onSelectionChange={setSelectedIds}
        onAssignFolders={onAssignFolders}
        onCreateFolderAndAssign={onCreateFolderAndAssign}
        onDeleteRecords={onDeleteRecords}
      />
      <div className="word-grid">
        {pagedItems.map((item) => (
          <WordCard
            key={item.id}
            item={item}
            folders={folders}
            onEdit={setEditingItem}
            onDelete={onDeleteRecord}
            onOpen={setViewingItem}
            isStarred={starredSet.has(item.id)}
            onToggleStar={() => toggleStarredItem(updateStore, item.id)}
            selectable
            selected={selectedIds.includes(item.id)}
            onToggleSelected={toggleSelected}
          />
        ))}
      </div>
      <div className="pagination">
        <button disabled={pageNumber <= 1} onClick={() => setPageNumber(pageNumber - 1)}><ChevronLeft size={18} /> 上一頁</button>
        <span>{pageNumber} / {pageCount} · 共 {enriched.length} 筆</span>
        <button disabled={pageNumber >= pageCount} onClick={() => setPageNumber(pageNumber + 1)}>下一頁 <ChevronRight size={18} /></button>
      </div>
    </section>
  );
}

function WordCard({ item, folders = [], onEdit, onDelete, onOpen, isStarred = false, onToggleStar, selectable = false, selected = false, onToggleSelected }) {
  return (
    <article className={`word-card clickable-card ${selected ? 'selected-word-card' : ''}`} onClick={() => onOpen(item)}>
      <div className="card-head word-card-head">
        <h3 className="speakable-heading"><span>{item.ko}</span><KoreanSpeakButton text={item.ko} /></h3>
        <div className="card-actions">
          {selectable && <label className="word-select-control" title="選取單字" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected} onChange={() => onToggleSelected(item.id)} /><span className="sr-only">選取 {item.ko}</span></label>}
          <StarButton active={isStarred} onClick={onToggleStar} />
          <EditIconButton onClick={() => onEdit(item)} />
          <DeleteIconButton item={item} onDelete={onDelete} />
          <MasteryBadge level={item.level} />
        </div>
      </div>
      <p>{item.zh}</p>
      <div className="word-meta"><span>{item.pos || '未分類'}</span><span>{item.date}</span><span>{item.total} 次</span><span>熟悉分數 {item.score > 0 ? `+${item.score}` : item.score}</span></div>
      <WordFolderTags itemId={item.id} folders={folders} />
    </article>
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

if (typeof document !== 'undefined') createRoot(document.getElementById('root')).render(<App />);
