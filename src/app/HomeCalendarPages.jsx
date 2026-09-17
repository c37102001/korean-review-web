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
import { FONT_SCALE_MAX, FONT_SCALE_MIN, dateLabel, monthTitle } from './AppRuntime.jsx';
import { OptionalPracticeModal, VoiceSettingsModal } from './AppDialogs.jsx';
export function HomePage({ store, items, questions, dueQuestionsForToday, wrongQuestionsForToday, optionalPractice, grammarNotes, onPractice, onOpenWrongReview, onAddRecords, onUpdateRecord, onWriteRecords, folders = [], offlineMode, fontScale, onFontScaleChange }) {
  const [addOpen, setAddOpen] = useState(false);
  const [practiceCreatorOpen, setPracticeCreatorOpen] = useState(false);
  const [practiceError, setPracticeError] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const today = todayString();
  const due = dueQuestionsForToday;
  const wrongReview = due.length ? [] : wrongQuestionsForToday;
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
                  <button className="primary small" onClick={onOpenWrongReview}><Eye size={16} /> 查看</button>
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

export function CalendarPage({ store, items, selectedDate, setSelectedDate, onOpenNotes }) {
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

export function NotesPage({ store, updateStore, items, questions, date, allItems, folders = [], onAssignFolders, onCreateFolderAndAssign, onPractice, onStudy, onAddRecords, onUpdateRecord, onUpdateRecords, onDeleteRecord, onDeleteRecords }) {
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
          <WordChineseVisibilityButton visible={collection.showAllChinese} onToggle={collection.toggleAllChinese} />
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
          onSpeak={speakText}
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
