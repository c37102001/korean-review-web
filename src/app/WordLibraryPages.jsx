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
import { WordChineseVisibilityButton, WordCollectionView } from '../features/word-library/components/WordCollectionView.jsx';
import {
  ItemDetailModal,
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
import { WORD_POS_OPTIONS } from '../words/partOfSpeech.js';
import '../styles.css';
import { CONTENT_SCHEMA_VERSION } from './AppRuntime.jsx';
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


export function ExportJsonModal({ items, title = '匯出 JSON', onClose }) {
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

export function EditJsonModal({ items, allItems, date, onSave, onClose }) {
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

export function FoldersPage({ folders, items, loading, error, onSave, onDelete, onOpen }) {
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

export function FolderDetailPage({ folder, folders, store, updateStore, items, questions, onSaveFolder, onDeleteFolder, onAddWords, onAssignFolders, onCreateFolderAndAssign, onRemoveWords, onPractice, onStudy, onAddRecords, onUpdateRecord, onUpdateRecords, onDeleteRecord, onDeleteRecords, onBack }) {
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
          <WordChineseVisibilityButton visible={collection.showAllChinese} onToggle={collection.toggleAllChinese} />
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
          onSpeak={speakText}
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

export function NotebookPage({ store, updateStore, items, questions, folders = [], onAssignFolders, onCreateFolderAndAssign, onPractice, onStudy, onAddRecords, onUpdateRecord, onUpdateRecords, onDeleteRecord, onDeleteRecords }) {
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
          <WordChineseVisibilityButton visible={collection.showAllChinese} onToggle={collection.toggleAllChinese} />
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
      <div className="filters notebook-filters">
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
        <select aria-label="詞性" value={collection.selectedPos} onChange={(event) => collection.setSelectedPos(event.target.value)}>
          <option value="">詞性：全部</option>
          {WORD_POS_OPTIONS.map((pos) => <option value={pos} key={pos}>詞性：{pos}</option>)}
        </select>
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
          onSpeak={speakText}
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

export function WrongReviewPage({
  store,
  updateStore,
  questions = [],
  allItems = [],
  folders = [],
  onPractice,
  onStudy,
  onUpdateRecord,
}) {
  const starredSet = new Set(store.starred || []);
  const itemById = useMemo(() => new Map(allItems.map((item) => [item.id, item])), [allItems]);
  const wrongItems = useMemo(() => [...new Map(
    questions
      .map((question) => itemById.get(question.itemId) || question.source)
      .filter(Boolean)
      .map((item) => [item.id, item]),
  ).values()], [questions, itemById]);
  const collection = useWordCollection({
    items: wrongItems,
    questions,
    store,
    folders,
    sourceKey: 'today-wrong-review',
    pageSize: 30,
  });
  const dialogs = useWordCollectionDialogs('today-wrong-review');

  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Review · 今日錯題</span><h1>今日答錯題目</h1></div>
        <div className="actions notebook-actions">
          <button disabled={!collection.filteredItems.length} onClick={() => onStudy(collection.filteredItems, '今日答錯題目')}><BookOpen size={18} /> 學習</button>
          <button
            className="primary"
            disabled={!collection.filteredQuestions.length}
            onClick={() => onPractice(
              collection.filteredQuestions,
              '今日答錯題目',
              { dueOnly: true, repeatable: true, wrongReview: true, allowAlphabeticalOrder: true },
            )}
          ><Dumbbell size={18} /> 測驗</button>
          <WordChineseVisibilityButton visible={collection.showAllChinese} onToggle={collection.toggleAllChinese} />
        </div>
      </div>
      <div className="word-search-tools folder-word-search">
        <label className="search"><Search size={18} /><input value={collection.query} onChange={(event) => collection.setQuery(event.target.value)} placeholder={collection.searchScope === 'word' ? '搜尋韓文單字或中文意思' : '搜尋今日錯題的全部卡片內容'} /></label>
        <SearchScopeControl value={collection.searchScope} onChange={collection.setSearchScope} />
      </div>
      {dialogs.editingWord && (
        <AddItemsModal
          title="編輯單字"
          date={dialogs.editingWord.date}
          lockedDate
          editItem={dialogs.editingWord}
          allItems={allItems}
          folders={folders}
          onUpdateRecord={onUpdateRecord}
          onClose={dialogs.closeEditor}
        />
      )}
      {dialogs.viewingWord && (
        <ItemDetailModal
          item={dialogs.viewingWord}
          allItems={allItems}
          onSpeak={speakText}
          isStarred={starredSet.has(dialogs.viewingWord.id)}
          onToggleStar={() => toggleStarredItem(updateStore, dialogs.viewingWord.id)}
          onOpenItem={dialogs.openViewer}
          onEdit={dialogs.editFromViewer}
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
        emptyMessage={questions.length ? '找不到符合的錯題單字' : '今天的錯題都已經答對了'}
        showPagination="always"
        showBulkActions={false}
      />
    </section>
  );
}
