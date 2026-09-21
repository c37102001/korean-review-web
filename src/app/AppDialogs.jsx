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
  offlineStatusLabel,
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
import { SPEECH_SAMPLE_TEXT, createUser, signInUser } from './AppRuntime.jsx';
export function OfflineStatusBar({ offlineMode }) {
  const { online, manual, pendingWrites, preparing, progress, error, syncDelayed } = offlineMode;
  const offline = !online || manual;
  if (!offline && !pendingWrites && !preparing && !error) return null;
  const label = offlineStatusLabel(offlineMode);
  return (
    <div className={`offline-status-bar ${offline ? 'offline' : ''} ${error ? 'error' : ''} ${syncDelayed ? 'delayed' : ''}`} role="status">
      {offline ? <CloudOff size={18} /> : <CloudDownload size={18} />}
      <span>{label}</span>
      {!offline && pendingWrites > 0 && (syncDelayed || error) && (
        <button type="button" onClick={offlineMode.checkSync}>檢查同步</button>
      )}
    </div>
  );
}

export function LoadingScreen({ text }) {
  return (
    <section className="login-page">
      <div className="panel login-card">
        <div className="brand"><Sparkles size={24} /> 韓文筆記</div>
        <p>{text}...</p>
      </div>
    </section>
  );
}

export function LoginPage() {
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
        await signInUser(email, password);
      } else {
        await createUser(email, password);
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

export function VoiceSettingsModal({ onClose }) {
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
