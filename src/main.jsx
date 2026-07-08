import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Flame,
  LibraryBig,
  LogOut,
  Pencil,
  Pause,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import notes from '../korean_study_notes_simple_minimal_2026-07-05.json';
import { auth, db } from './firebase.js';
import './styles.css';

const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 90];
const STUDY_DATE = '2026-07-05';
const APP_STATE_ID = 'reviewState';
const REPLACE_MARKER_ID = 'replaceCurrentAppData';
const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/gu;
const REVIEW_COMPLETION_BACKFILL_START = '2026-07-06';
const REVIEW_COMPLETION_BACKFILL_END = '2026-07-07';

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

function emptyStore() {
  return { stats: {}, progress: {}, learning: {}, attempts: [], customRecords: [], deletedRecordIds: [], completedReviewDates: [] };
}

function useAuthUser() {
  const [authState, setAuthState] = useState({ loading: true, user: null });
  useEffect(() => onAuthStateChanged(auth, (user) => setAuthState({ loading: false, user })), []);
  return authState;
}

async function seedFirebaseContent(uid, items, questions) {
  await replaceOldFirebaseData(uid);
  const stateRef = doc(db, 'users', uid, 'appState', APP_STATE_ID);
  const stateSnap = await getDoc(stateRef);
  const batch = writeBatch(db);
  const dayRef = doc(db, 'users', uid, 'days', STUDY_DATE);
  batch.set(
    dayRef,
    {
      date: STUDY_DATE,
      rawItems: notes.data,
      itemCount: items.length,
      questionCount: questions.length,
      sourceFile: 'korean_study_notes_simple_minimal_2026-07-05.json',
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  items.forEach((item) => {
    batch.set(doc(db, 'users', uid, 'items', item.id), { ...item, updatedAt: serverTimestamp() }, { merge: true });
  });
  questions.forEach((question) => {
    const { source, ...questionDoc } = question;
    batch.set(doc(db, 'users', uid, 'questions', question.id), { ...questionDoc, updatedAt: serverTimestamp() }, { merge: true });
  });
  if (!stateSnap.exists()) {
    batch.set(stateRef, { ...emptyStore(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
}

async function fetchCustomRecords(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'records'));
  return snap.docs.map((documentSnap) => documentSnap.data()).sort((a, b) => {
    if (a.date === b.date) return (a.createdAt || '').localeCompare(b.createdAt || '');
    return a.date.localeCompare(b.date);
  });
}

async function deleteCollectionDocs(uid, collectionName) {
  const snap = await getDocs(collection(db, 'users', uid, collectionName));
  await Promise.all(snap.docs.map((documentSnap) => deleteDoc(documentSnap.ref)));
}

async function replaceOldFirebaseData(uid) {
  const markerRef = doc(db, 'users', uid, 'meta', REPLACE_MARKER_ID);
  const markerSnap = await getDoc(markerRef);
  if (markerSnap.exists()) return;

  await Promise.all([
    deleteCollectionDocs(uid, 'cards'),
    deleteCollectionDocs(uid, 'days'),
    deleteCollectionDocs(uid, 'items'),
    deleteCollectionDocs(uid, 'questions'),
    deleteCollectionDocs(uid, 'records'),
    deleteCollectionDocs(uid, 'appState'),
  ]);

  await setDoc(markerRef, {
    replacedAt: serverTimestamp(),
    note: 'Old Korean review data was deleted and replaced by the current app structure.',
  });
}

function useFirestoreStore(user, items, questions) {
  const [state, setState] = useState({ loading: true, error: '', store: emptyStore() });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) return;
      setState((current) => ({ ...current, loading: true, error: '' }));
      try {
        await seedFirebaseContent(user.uid, items, questions);
        const snap = await getDoc(doc(db, 'users', user.uid, 'appState', APP_STATE_ID));
        const customRecords = await fetchCustomRecords(user.uid);
        const data = snap.exists() ? snap.data() : emptyStore();
        if (!cancelled) {
          setState({
            loading: false,
            error: '',
            store: {
              stats: data.stats || {},
              progress: data.progress || {},
              learning: data.learning || {},
              attempts: data.attempts || [],
              deletedRecordIds: data.deletedRecordIds || [],
              completedReviewDates: data.completedReviewDates || [],
              customRecords,
            },
          });
        }
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error.message, store: emptyStore() });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user, items, questions]);

  const update = async (updater) => {
    const next = updater(state.store);
    setState((current) => ({ ...current, store: next }));
    const { customRecords, ...persistedState } = next;
    await setDoc(
      doc(db, 'users', user.uid, 'appState', APP_STATE_ID),
      { ...persistedState, updatedAt: serverTimestamp() },
      { merge: true },
    );
  };

  return [state.store, update, state.loading, state.error];
}

function normalizeRelated(value) {
  if (!value) return [];
  return value.map((entry) => (typeof entry === 'string' ? { ko: entry } : entry));
}

function baseRecords() {
  return notes.data.map((item, index) => ({
    id: `${STUDY_DATE}-item-${index}`,
    date: STUDY_DATE,
    item,
    createdAt: `${STUDY_DATE}T00:00:00.000Z`,
  }));
}

function normalizeRecords(records) {
  const items = records.map((record, index) => ({
    ...record.item,
    id: record.id,
    date: record.date,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    index,
    related: normalizeRelated(record.item.related),
  }));

  const questions = [];
  const seenExamples = new Set();
  const addExampleQuestion = (item, example, id) => {
    const key = `${example.ko}\n${example.zh}`;
    if (seenExamples.has(key)) return;
    seenExamples.add(key);
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
    const isComparisonCard = !!item.items?.length && !item.examples?.length && !item.senses?.length;
    if (!isComparisonCard) {
      questions.push({
        id: item.id,
        itemId: item.id,
        date: item.date,
        kind: 'term',
        pos: item.pos || '比較',
        ko: item.ko,
        zh: item.zh,
        source: item,
      });
    }
    (item.examples || []).forEach((example, exampleIndex) => {
      addExampleQuestion(item, example, `${item.id}-ex-${exampleIndex}`);
    });
    (item.senses || []).forEach((sense, senseIndex) => {
      (sense.examples || []).forEach((example, exampleIndex) => {
        addExampleQuestion(item, example, `${item.id}-sense-${senseIndex}-ex-${exampleIndex}`);
      });
    });
  });
  return { items, questions };
}

function parseJsonItems(text) {
  const parsed = JSON.parse(text);
  const data = Array.isArray(parsed) ? parsed : parsed.data;
  if (!Array.isArray(data)) throw new Error('JSON 需要是 { "data": [...] } 或陣列格式');
  data.forEach((item) => {
    if (!item?.ko || !item?.zh) throw new Error('每筆資料都需要 ko 和 zh');
  });
  return data;
}

function linesToArray(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function parsePairLines(text) {
  return linesToArray(text).map((line) => {
    const separator = line.includes('|') ? '|' : '=';
    const [ko, ...rest] = line.split(separator);
    return { ko: ko.trim(), zh: rest.join(separator).trim() };
  }).filter((entry) => entry.ko && entry.zh);
}

function createRecordsForDate(date, rawItems) {
  const now = new Date().toISOString();
  return rawItems.map((item) => ({
    id: `${date}-custom-${crypto.randomUUID()}`,
    date,
    item,
    createdAt: now,
  }));
}

async function writeLearningRecords(uid, records) {
  const { items, questions } = normalizeRecords(records);
  const batch = writeBatch(db);
  const byDate = records.reduce((acc, record) => {
    acc[record.date] = acc[record.date] || [];
    acc[record.date].push(record.item);
    return acc;
  }, {});

  Object.entries(byDate).forEach(([date, rawItems]) => {
    batch.set(
      doc(db, 'users', uid, 'days', date),
      {
        date,
        lastAddedItems: rawItems,
        itemCount: rawItems.length,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
  records.forEach((record) => {
    batch.set(doc(db, 'users', uid, 'records', record.id), { ...record, updatedAt: serverTimestamp() }, { merge: true });
  });
  items.forEach((item) => {
    batch.set(doc(db, 'users', uid, 'items', item.id), { ...item, updatedAt: serverTimestamp() }, { merge: true });
  });
  questions.forEach((question) => {
    const { source, ...questionDoc } = question;
    batch.set(doc(db, 'users', uid, 'questions', question.id), { ...questionDoc, updatedAt: serverTimestamp() }, { merge: true });
  });
  await batch.commit();
}

async function deleteQuestionsForRecord(uid, recordId) {
  const snap = await getDocs(collection(db, 'users', uid, 'questions'));
  await Promise.all(snap.docs
    .filter((documentSnap) => documentSnap.data().itemId === recordId)
    .map((documentSnap) => deleteDoc(documentSnap.ref)));
}

async function writeLearningRecord(uid, record) {
  await deleteQuestionsForRecord(uid, record.id);
  await writeLearningRecords(uid, [record]);
}

async function deleteLearningRecord(uid, recordId) {
  await deleteQuestionsForRecord(uid, recordId);
  await Promise.all([
    deleteDoc(doc(db, 'users', uid, 'records', recordId)),
    deleteDoc(doc(db, 'users', uid, 'items', recordId)),
  ]);
}

function getStats(store, id) {
  const stats = store.stats[id] || { total: 0, correct: 0, wrong: 0 };
  const rate = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;
  let level = '學習中';
  if (stats.total >= 2 && rate < 55) level = '不熟悉';
  if (stats.total >= 3 && rate >= 75) level = '熟悉';
  if (stats.total >= 6 && rate >= 90) level = '已熟練';
  return { ...stats, rate, level };
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

function termQuestions(questions) {
  return questions.filter((question) => question.kind === 'term');
}

function groupTasks(store, questions, date = todayString()) {
  const groups = new Map();
  dueQuestions(store, questions, date).forEach((question) => {
    const progress = getProgress(store, question);
    const key = `${question.date}-${progress.nextDue}`;
    const existing = groups.get(key) || {
      id: key,
      studyDate: question.date,
      dueDate: progress.nextDue,
      questions: [],
      overdue: progress.nextDue < date,
    };
    existing.questions.push(question);
    existing.overdue = existing.overdue || progress.nextDue < date;
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
  const previous = getProgress(store, question);
  const stage = correct ? Math.min(previous.stage + 1, REVIEW_INTERVALS.length - 1) : 0;
  return {
    ...store,
    stats: {
      ...store.stats,
      [question.id]: {
        total: (store.stats[question.id]?.total || 0) + 1,
        correct: (store.stats[question.id]?.correct || 0) + (correct ? 1 : 0),
        wrong: (store.stats[question.id]?.wrong || 0) + (correct ? 0 : 1),
        lastAnsweredAt: now,
        lastResult: correct ? 'correct' : 'wrong',
      },
    },
    progress: {
      ...store.progress,
      [question.id]: {
        stage,
        nextDue: addDays(todayString(), REVIEW_INTERVALS[stage]),
        lastAnsweredAt: now,
        lastResult: correct ? 'correct' : 'wrong',
      },
    },
    attempts: [{ id: crypto.randomUUID(), questionId: question.id, correct, time: now }, ...store.attempts].slice(0, 300),
  };
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

function speakText(text, lang) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = lang.startsWith('ko') ? 0.9 : 1;
  window.speechSynthesis.speak(utterance);
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

function App() {
  const builtInRecords = useMemo(() => baseRecords(), []);
  const builtInData = useMemo(() => normalizeRecords(builtInRecords), [builtInRecords]);
  const { loading: authLoading, user } = useAuthUser();
  const [store, updateStore, storeLoading, storeError] = useFirestoreStore(user, builtInData.items, builtInData.questions);
  const [page, setPage] = useState('home');
  const [pageStack, setPageStack] = useState([]);
  const [selectedDate, setSelectedDate] = useState(STUDY_DATE);
  const [practiceSet, setPracticeSet] = useState(null);
  const [studySet, setStudySet] = useState(null);
  const allRecords = useMemo(() => {
    const byId = new Map();
    builtInRecords.forEach((record) => byId.set(record.id, record));
    (store.customRecords || []).forEach((record) => byId.set(record.id, record));
    (store.deletedRecordIds || []).forEach((id) => byId.delete(id));
    return [...byId.values()];
  }, [builtInRecords, store.customRecords, store.deletedRecordIds]);
  const { items, questions } = useMemo(() => normalizeRecords(allRecords), [allRecords]);
  const dailyQuestions = useMemo(() => termQuestions(questions), [questions]);
  const completedAttemptDates = useMemo(
    () => [...new Set((store.attempts || []).map((attempt) => attempt.time?.slice(0, 10)).filter(Boolean))],
    [store.attempts],
  );

  useEffect(() => {
    if (!user || storeLoading) return;
    const today = todayString();
    const backfillDates = completedAttemptDates.filter(
      (date) => date >= REVIEW_COMPLETION_BACKFILL_START && date <= REVIEW_COMPLETION_BACKFILL_END && dueQuestions(store, dailyQuestions, date).length === 0,
    );
    const datesToMark = [...backfillDates];
    if (dueQuestions(store, dailyQuestions, today).length === 0) datesToMark.push(today);

    const missingDates = [...new Set(datesToMark)].filter((date) => !(store.completedReviewDates || []).includes(date));
    if (!missingDates.length) return;
    updateStore((current) => missingDates.reduce((nextStore, date) => markReviewDateComplete(nextStore, date), current));
  }, [user, storeLoading, store.completedReviewDates, store.progress, completedAttemptDates, dailyQuestions, updateStore]);

  const navTop = (next) => {
    setPageStack([]);
    setPage(next);
  };
  const navChild = (next) => {
    setPageStack((stack) => [...stack, page]);
    setPage(next);
  };
  const goUp = () => {
    if (!pageStack.length) return;
    setPage(pageStack[pageStack.length - 1]);
    setPageStack(pageStack.slice(0, -1));
  };
  const startPractice = (sourceQuestions, label, options = {}) => {
    setPracticeSet({ questions: sourceQuestions, label, dueOnly: !!options.dueOnly });
    navChild('practice');
  };
  const startStudy = (sourceItems, label) => {
    setStudySet({ items: sourceItems, label });
    navChild('study');
  };
  const addLearningRecords = async (records) => {
    await updateStore((current) => ({
      ...current,
      customRecords: [...(current.customRecords || []), ...records],
    }));
    await writeLearningRecords(user.uid, records);
  };
  const updateLearningRecord = async (record) => {
    await updateStore((current) => {
      const records = [...(current.customRecords || [])];
      const index = records.findIndex((existing) => existing.id === record.id);
      if (index >= 0) records[index] = record;
      else records.push(record);
      return { ...current, customRecords: records };
    });
    await writeLearningRecord(user.uid, record);
  };
  const deleteLearningRecordFromStore = async (recordId) => {
    await updateStore((current) => ({
      ...current,
      customRecords: (current.customRecords || []).filter((record) => record.id !== recordId),
      deletedRecordIds: [...new Set([...(current.deletedRecordIds || []), recordId])],
      stats: Object.fromEntries(Object.entries(current.stats || {}).filter(([id]) => id !== recordId && !id.startsWith(`${recordId}-`))),
      progress: Object.fromEntries(Object.entries(current.progress || {}).filter(([id]) => id !== recordId && !id.startsWith(`${recordId}-`))),
      learning: Object.fromEntries(Object.entries(current.learning || {}).filter(([id]) => id !== recordId)),
      attempts: (current.attempts || []).filter((attempt) => attempt.questionId !== recordId && !attempt.questionId?.startsWith(`${recordId}-`)),
    }));
    await deleteLearningRecord(user.uid, recordId);
  };

  if (authLoading) return <LoadingScreen text="正在確認登入狀態" />;
  if (!user) return <LoginPage />;
  if (storeLoading) return <LoadingScreen text="正在同步 Firebase 資料" />;

  const views = {
    home: <HomePage store={store} items={items} questions={dailyQuestions} onPractice={startPractice} onStudy={startStudy} />,
    calendar: <CalendarPage store={store} items={items} questions={questions} selectedDate={selectedDate} setSelectedDate={setSelectedDate} onOpenNotes={() => navChild('notes')} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} />,
    notes: <NotesPage items={items.filter((item) => item.date === selectedDate)} questions={questions.filter((q) => q.date === selectedDate)} date={selectedDate} allItems={items} onPractice={startPractice} onStudy={startStudy} onUpdateRecord={updateLearningRecord} onDeleteRecord={deleteLearningRecordFromStore} />,
    study: <StudyPage store={store} updateStore={updateStore} set={studySet || { items, label: '全部內容' }} />,
    practice: <PracticePage store={store} updateStore={updateStore} set={practiceSet || { questions: dailyQuestions, label: '今日複習', dueOnly: true }} />,
    notebook: <NotebookPage store={store} items={items} questions={questions} onPractice={startPractice} onStudy={startStudy} onAddRecords={addLearningRecords} onUpdateRecord={updateLearningRecord} onDeleteRecord={deleteLearningRecordFromStore} />,
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <button className={`brand brand-button ${page === 'home' ? 'active' : ''}`} onClick={() => navTop('home')}><Sparkles size={24} /> 韓文筆記</button>
        <button className={page === 'calendar' || page === 'notes' ? 'active' : ''} onClick={() => navTop('calendar')}><CalendarDays size={18} /> 日曆</button>
        <button className={page === 'notebook' ? 'active' : ''} onClick={() => navTop('notebook')}><LibraryBig size={18} /> 單字本</button>
        <button className="logout-button" onClick={() => signOut(auth)}><LogOut size={18} /> 登出</button>
      </aside>
      <main>
        {storeError && <div className="sync-error">Firebase 同步失敗：{storeError}</div>}
        {!!pageStack.length && <button className="back-button" onClick={goUp}><ChevronLeft size={18} /> 返回上一層</button>}
        {views[page]}
      </main>
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
        <h1>{mode === 'login' ? '登入後開始複習' : '建立新帳號'}</h1>
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

function HomePage({ store, items, questions, onPractice, onStudy }) {
  const today = todayString();
  const tasks = groupTasks(store, questions, today);
  const due = dueQuestions(store, questions, today);
  const answeredToday = store.attempts.filter((attempt) => attempt.time.startsWith(today));
  const correctToday = answeredToday.filter((attempt) => attempt.correct).length;
  const weak = questions.filter((question) => getStats(store, question.id).level === '不熟悉').slice(0, 6);
  const mastered = questions.filter((question) => getStats(store, question.id).level === '已熟練').length;
  const progress = due.length ? Math.max(0, Math.round((answeredToday.length / (answeredToday.length + due.length)) * 100)) : 100;

  return (
    <section className="page">
      <div className="hero">
        <div>
          <span className="eyebrow">Today · {dateLabel(today)}</span>
          <h1>今天也來練一點韓文</h1>
          <p>目前有 {due.length} 題等待主動回想，答錯會自動回到第一階段重新安排。</p>
          <div className="actions">
            <button className="primary" disabled={!due.length} onClick={() => onPractice(due, '今日複習', { dueOnly: true })}><Dumbbell size={18} /> 開始今日複習</button>
            <button onClick={() => onStudy(items, '全部內容')}><BookOpen size={18} /> 先用單字卡學習</button>
          </div>
        </div>
        <div className="hero-meter">
          <div className="ring" style={{ '--progress': `${progress}%` }}>{progress}%</div>
          <span>今日完成度</span>
        </div>
      </div>

      <div className="stats-grid">
        <Stat icon={<Target />} label="待複習" value={`${due.length} 題`} />
        <Stat icon={<Check />} label="今日答對" value={`${correctToday}/${answeredToday.length || 0}`} />
        <Stat icon={<Trophy />} label="已熟練" value={`${mastered} 題`} />
        <Stat icon={<Flame />} label="不熟悉" value={`${weak.length} 題`} />
      </div>

      <div className="split">
        <div className="panel">
          <div className="panel-title"><h2>複習任務</h2><span>{tasks.length ? '未完成任務會保留' : '目前沒有到期任務'}</span></div>
          <div className="task-list">
            {tasks.map((task) => (
              <div className="task-card" key={task.id}>
                <div>
                  <span className={task.overdue ? 'badge danger' : 'badge'}>{task.overdue ? '逾期' : '今日'}</span>
                  <h3>{dateLabel(task.studyDate)} 的內容</h3>
                  <p>到期日 {task.dueDate} · {task.questions.length} 題 · 未完成</p>
                </div>
                <button className="primary small" onClick={() => onPractice(task.questions, `${task.studyDate} 複習`, { dueOnly: true })}>開始</button>
              </div>
            ))}
            {!tasks.length && <div className="empty">今天沒有排程到期。你可以從日曆或單字本主動練習。</div>}
          </div>
        </div>
        <div className="panel">
          <div className="panel-title"><h2>不熟悉清單</h2><span>依答題紀錄更新</span></div>
          {weak.length ? weak.map((question) => <MiniQuestion key={question.id} question={question} store={store} />) : <div className="empty">還沒有被標記為不熟悉的內容。</div>}
          <button className="wide" disabled={!weak.length} onClick={() => onPractice(weak, '不熟悉加強')}>練習不熟悉內容</button>
        </div>
      </div>
    </section>
  );
}

function Stat({ icon, label, value }) {
  return <div className="stat">{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function CalendarPage({ store, items, questions, selectedDate, setSelectedDate, onOpenNotes, onAddRecords, onUpdateRecord }) {
  const [cursor, setCursor] = useState(new Date(`${selectedDate}T00:00:00`));
  const [addOpen, setAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const completedDates = new Set(store.completedReviewDates || []);
  const streaks = calculateReviewStreaks(store.completedReviewDates || []);
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
            <button key={day.key} className={`day ${day.current ? '' : 'muted'} ${day.hasStudy ? 'has-study' : ''} ${day.isToday ? 'today' : ''} ${day.key === selectedDate ? 'selected' : ''}`} onClick={() => setSelectedDate(day.key)}>
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
          <button className="primary wide" disabled={!selectedItems.length} onClick={onOpenNotes}>查看日期筆記</button>
          <button className="wide add-date-button" onClick={() => setAddOpen(true)}>新增單字</button>
        </div>
      </div>
      {addOpen && (
        <AddItemsModal
          title="新增這一天的單字"
          date={selectedDate}
          lockedDate
          allItems={items}
          onAddRecords={onAddRecords}
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
          onUpdateRecord={onUpdateRecord}
          onClose={() => setEditingItem(null)}
        />
      )}
    </section>
  );
}

function NotesPage({ items, questions, date, allItems, onPractice, onStudy, onUpdateRecord, onDeleteRecord }) {
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);
  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Notes · {dateLabel(date)}</span><h1>日期筆記</h1></div>
        <div className="actions">
          <button onClick={() => onStudy(items, `${date} 學習`)}><BookOpen size={18} /> 開始學習</button>
          <button className="primary" onClick={() => onPractice(questions, `${date} 測驗`)}><Dumbbell size={18} /> 開始測驗</button>
        </div>
      </div>
      {editingItem && (
        <AddItemsModal
          title="編輯單字"
          date={editingItem.date}
          lockedDate
          editItem={editingItem}
          allItems={allItems}
          onUpdateRecord={onUpdateRecord}
          onDeleteRecord={onDeleteRecord}
          onClose={() => setEditingItem(null)}
        />
      )}
      {viewingItem && (
        <ItemDetailModal
          item={viewingItem}
          onEdit={(item) => {
            setViewingItem(null);
            setEditingItem(item);
          }}
          onDelete={onDeleteRecord}
          onClose={() => setViewingItem(null)}
        />
      )}
      <div className="notes-grid">{items.map((item) => <NoteCard key={item.id} item={item} compact onOpen={setViewingItem} onEdit={setEditingItem} onDelete={onDeleteRecord} />)}</div>
    </section>
  );
}

function NotePreview({ item }) {
  return <div className="mini"><strong>{item.ko}</strong><span>{item.zh}</span></div>;
}

function AddItemsPanel({ title, date, lockedDate = false, onAddRecords, allItems = [] }) {
  return <AddItemsForm title={title} date={date} lockedDate={lockedDate} onAddRecords={onAddRecords} allItems={allItems} />;
}

function AddItemsModal({ title, date, lockedDate = false, onAddRecords, onUpdateRecord, onEditExisting, editItem, allItems = [], onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <AddItemsForm
          title={title}
          date={date}
          lockedDate={lockedDate}
          onAddRecords={onAddRecords}
          onUpdateRecord={onUpdateRecord}
          onEditExisting={onEditExisting}
          editItem={editItem}
          allItems={allItems}
          onSaved={onClose}
          compactPanel
        />
      </div>
    </div>
  );
}

function AddItemsForm({ title, date, lockedDate = false, onAddRecords, onUpdateRecord, onEditExisting, editItem, allItems = [], onSaved, compactPanel = false }) {
  const isEditing = Boolean(editItem);
  const [mode, setMode] = useState('manual');
  const [formDate, setFormDate] = useState(date);
  const [jsonText, setJsonText] = useState('');
  const [manual, setManual] = useState(() => itemToManual(editItem));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFormDate(date);
    setManual(itemToManual(editItem));
    setMode('manual');
  }, [date, editItem]);

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    setDuplicates([]);
    setSaving(true);
    try {
      const targetDate = lockedDate ? date : formDate;
      if (isEditing) {
        const record = {
          id: editItem.id,
          date: editItem.date,
          item: mergeEditedItem(editItem, manual, allItems),
          createdAt: editItem.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await onUpdateRecord(record);
        setMessage('已更新單字');
      } else {
        const rawItems = mode === 'json' ? parseJsonItems(jsonText) : [manualToItem(manual, allItems)];
        const repeatedInInput = rawItems.map((item) => item.ko.trim()).filter((ko, index, list) => list.indexOf(ko) !== index);
        if (repeatedInInput.length) {
          setError(`這次新增內容中有重複韓文：${[...new Set(repeatedInInput)].join('、')}`);
          return;
        }
        const existing = rawItems
          .map((rawItem) => allItems.find((item) => item.ko.trim() === rawItem.ko.trim()))
          .filter(Boolean);
        if (existing.length) {
          setDuplicates(existing);
          setError('不能新增重複韓文單字。請直接編輯既有單字卡。');
          return;
        }
        const records = createRecordsForDate(targetDate, rawItems);
        await onAddRecords(records);
        setMessage(`已新增 ${records.length} 筆到 ${targetDate}`);
        setJsonText('');
        setManual(itemToManual());
      }
      if (onSaved) setTimeout(onSaved, 450);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={`${compactPanel ? '' : 'panel'} add-panel`} onSubmit={submit}>
      <div className="panel-title">
        <div><h2>{title}</h2><span>{isEditing ? '修改後會覆蓋這筆單字資料' : '可貼上整份 JSON，或手動新增一筆'}</span></div>
        {!isEditing && <div className="segmented compact">
          <button type="button" className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>手動填寫</button>
          <button type="button" className={mode === 'json' ? 'active' : ''} onClick={() => setMode('json')}>貼上 JSON</button>
        </div>}
      </div>

      <div className="form-grid">
        <label>
          日期
          <input type="date" value={isEditing ? editItem.date : lockedDate ? date : formDate} onChange={(event) => setFormDate(event.target.value)} disabled={lockedDate || isEditing} required />
        </label>
        {mode === 'manual' ? (
          <>
            <label>
              韓文 *
              <input value={manual.ko} onChange={(event) => setManual({ ...manual, ko: event.target.value })} required />
            </label>
            <label>
              中文 *
              <input value={manual.zh} onChange={(event) => setManual({ ...manual, zh: event.target.value })} required />
            </label>
            <label>
              詞性 / 類型
              <select value={manual.pos} onChange={(event) => setManual({ ...manual, pos: event.target.value })}>
                <option value="">不指定</option>
                {['名詞', '動詞', '形容詞', '副詞', '片語', '動詞片語', '句子', '文法', '比較'].map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label>
              常見句型 / 搭配
              <input value={manual.pattern} onChange={(event) => setManual({ ...manual, pattern: event.target.value })} />
            </label>
            <label className="wide-field">
              例句
              <textarea value={manual.examples} onChange={(event) => setManual({ ...manual, examples: event.target.value })} placeholder="每行一筆：韓文 | 中文" />
            </label>
            <label className="wide-field">
              補充說明
              <textarea value={manual.notes} onChange={(event) => setManual({ ...manual, notes: event.target.value })} placeholder="每行一筆說明" />
            </label>
            <RelatedSelector manual={manual} setManual={setManual} allItems={allItems} editItem={editItem} />
          </>
        ) : (
          <label className="wide-field">
            JSON 內容
            <textarea className="json-input" value={jsonText} onChange={(event) => setJsonText(event.target.value)} placeholder='{ "data": [{ "ko": "뉴스", "zh": "新聞", "pos": "名詞" }] }' required />
          </label>
        )}
      </div>

      {message && <div className="form-success">{message}</div>}
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
      <div className="form-actions">
        <button className="primary" disabled={saving}>{saving ? '儲存中' : isEditing ? '儲存修改' : '新增到單字庫'}</button>
      </div>
    </form>
  );
}

function RelatedSelector({ manual, setManual, allItems, editItem }) {
  const query = manual.relatedQuery || '';
  const selected = manual.relatedSelected || [];
  const selectedSet = new Set(selected);
  const results = allItems
    .filter((item) => item.id !== editItem?.id)
    .filter((item) => !selectedSet.has(item.ko))
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
          {selected.map((ko) => {
            const item = allItems.find((candidate) => candidate.ko === ko);
            return (
              <button type="button" key={ko} onClick={() => setManual({ ...manual, relatedSelected: selected.filter((entry) => entry !== ko) })}>
                {ko}{item?.zh ? ` · ${item.zh}` : ''} ×
              </button>
            );
          })}
        </div>
      )}
      <div className="related-results">
        {results.map((item) => (
          <button type="button" key={item.id} onClick={() => setManual({ ...manual, relatedSelected: [...selected, item.ko], relatedQuery: '' })}>
            <strong>{item.ko}</strong><span>{item.zh}</span>
          </button>
        ))}
        {query.trim() && !results.length && <div className="empty small-empty">找不到符合的既有單字</div>}
      </div>
    </div>
  );
}

function manualToItem(manual, allItems = []) {
  if (!manual.ko.trim() || !manual.zh.trim()) throw new Error('韓文和中文是必填');
  const item = {
    ko: manual.ko.trim(),
    zh: manual.zh.trim(),
  };
  if (manual.pos) item.pos = manual.pos;
  if (manual.pattern.trim()) item.pattern = manual.pattern.trim();
  const examples = parsePairLines(manual.examples);
  if (examples.length) item.examples = examples;
  const notesList = linesToArray(manual.notes);
  if (notesList.length) item.notes = notesList;
  const related = (manual.relatedSelected || []).map((ko) => {
    const item = allItems.find((candidate) => candidate.ko === ko);
    return item ? { ko: item.ko, zh: item.zh } : { ko };
  });
  if (related.length) item.related = related;
  return item;
}

function itemToManual(item) {
  if (!item) {
    return { ko: '', zh: '', pos: '', pattern: '', examples: '', notes: '', relatedSelected: [], relatedQuery: '' };
  }
  return {
    ko: item.ko || '',
    zh: item.zh || '',
    pos: item.pos || '',
    pattern: item.pattern || '',
    examples: (item.examples || []).map((example) => `${example.ko || ''} | ${example.zh || ''}`).join('\n'),
    notes: (item.notes || []).join('\n'),
    relatedSelected: (item.related || []).map((entry) => (typeof entry === 'string' ? entry : entry.ko)).filter(Boolean),
    relatedQuery: '',
  };
}

function mergeEditedItem(original, manual, allItems = []) {
  const edited = manualToItem(manual, allItems);
  const {
    id,
    date,
    index,
    createdAt,
    updatedAt,
    total,
    rate,
    level,
    ...content
  } = original;
  const next = { ...content, ...edited };
  ['pos', 'pattern', 'examples', 'notes', 'related'].forEach((key) => {
    if (edited[key] === undefined) delete next[key];
  });
  return next;
}

function exportNotebookItems(items) {
  const cleanItems = items.map((item) => {
    const {
      id,
      date,
      index,
      createdAt,
      updatedAt,
      total,
      rate,
      level,
      ...content
    } = item;
    return { date, ...content };
  });
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data: cleanItems }, null, 2)], { type: 'application/json' });
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
    item.pattern,
    ...(item.notes || []),
    ...(item.examples || []).flatMap((example) => [example.ko, example.zh]),
    ...(item.senses || []).flatMap((sense) => [sense.zh, sense.pattern, ...(sense.examples || []).flatMap((example) => [example.ko, example.zh])]),
    ...(item.related || []).flatMap((entry) => (typeof entry === 'string' ? [entry] : [entry.ko, entry.zh, entry.relation])),
    ...(item.components || []).flatMap((entry) => [entry.ko, entry.zh]),
    ...(item.items || []).flatMap((entry) => [entry.ko, entry.zh]),
  ].filter(Boolean).join(' ').toLowerCase();
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

function DeleteIconButton({ item, onDelete }) {
  if (!onDelete) return null;
  return (
    <button
      className="edit-icon-button delete-icon-button"
      onClick={async (event) => {
        event.stopPropagation();
        if (!window.confirm(`確定要刪除「${item.ko}」嗎？`)) return;
        await onDelete(item.id);
      }}
      aria-label="刪除"
      title="刪除"
    >
      <Trash2 size={15} />
    </button>
  );
}

function ItemDetailModal({ item, onEdit, onDelete, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel detail-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <NoteCard item={item} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

function NoteCard({ item, onEdit, onDelete, compact = false, onOpen }) {
  const examplesCount = (item.examples?.length || 0) + (item.senses || []).reduce((sum, sense) => sum + (sense.examples?.length || 0), 0);
  return (
    <article className={`note-card ${compact ? 'compact-card clickable-card' : ''}`} onClick={compact ? () => onOpen(item) : undefined}>
      <div className="card-head">
        <h3>{item.ko}</h3>
        <div className="card-actions">
          {onEdit && <EditIconButton onClick={() => onEdit(item)} />}
          <DeleteIconButton item={item} onDelete={onDelete} />
          {item.pos && <span className="badge">{item.pos}</span>}
        </div>
      </div>
      <p className="zh">{item.zh}</p>
      {compact && (
        <div className="compact-meta">
          <span>{item.date}</span>
          {!!examplesCount && <span>{examplesCount} 個例句</span>}
          {!!item.notes?.length && <span>{item.notes.length} 則筆記</span>}
        </div>
      )}
      {!compact && <>
      {item.pattern && <p className="pattern">{item.pattern}</p>}
      {!!item.examples?.length && <div className="subblock"><b>例句</b>{item.examples.map((ex) => <p key={ex.ko}>{ex.ko}<br /><span>{ex.zh}</span></p>)}</div>}
      {!!item.senses?.length && <div className="subblock"><b>意思</b>{item.senses.map((sense) => <p key={sense.zh}>{sense.zh}{sense.pattern ? ` · ${sense.pattern}` : ''}</p>)}</div>}
      {!!item.notes?.length && <div className="subblock tips">{item.notes.map((note) => <p key={note}>{note}</p>)}</div>}
      {!!item.related?.length && <div className="tags">{item.related.map((entry) => <span key={entry.ko}>{entry.ko}{entry.zh ? ` · ${entry.zh}` : ''}</span>)}</div>}
      {!!item.components?.length && <div className="tags">{item.components.map((entry) => <span key={entry.ko}>{entry.ko} · {entry.zh}</span>)}</div>}
      {!!item.items?.length && <div className="subblock">{item.items.map((entry) => <p key={entry.ko}>{entry.ko}<br /><span>{entry.zh}</span></p>)}</div>}
      </>}
    </article>
  );
}

function StudyPage({ store, updateStore, set }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [filter, setFilter] = useState('全部');
  const [relatedItems, setRelatedItems] = useState(null);
  const [frontSide, setFrontSide] = useState('ko');
  const [random, setRandom] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(Date.now());
  const [autoPlay, setAutoPlay] = useState(false);
  const [playVoice, setPlayVoice] = useState(true);
  const types = ['全部', ...new Set(set.items.map((item) => item.pos || '比較'))];
  const filtered = useMemo(() => set.items.filter((item) => filter === '全部' || item.pos === filter), [set.items, filter]);
  const ordered = useMemo(() => (random ? shuffleItems(filtered, shuffleSeed) : filtered), [filtered, random, shuffleSeed]);
  const item = ordered[index % Math.max(ordered.length, 1)];
  const learning = item ? store.learning[item.id] : null;
  const mark = (status) => updateStore((current) => ({ ...current, learning: { ...current.learning, [item.id]: { status, at: new Date().toISOString() } } }));
  const frontText = frontSide === 'ko' ? item?.ko : item?.zh;
  const backText = frontSide === 'ko' ? item?.zh : item?.ko;
  const frontLang = frontSide === 'ko' ? 'ko-KR' : 'zh-TW';
  const backLang = frontSide === 'ko' ? 'zh-TW' : 'ko-KR';
  const goPrev = () => {
    setIndex((index - 1 + ordered.length) % ordered.length);
    setFlipped(false);
  };
  const goNext = () => {
    setIndex((index + 1) % ordered.length);
    setFlipped(false);
  };

  useLayoutEffect(() => {
    setFlipped(false);
  }, [item?.id]);

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
  }, [filter, random, shuffleSeed, frontSide]);

  useEffect(() => {
    if (autoPlay || !playVoice || !item) return;
    speakText(frontText, frontLang);
  }, [autoPlay, playVoice, item?.id, frontSide]);

  useEffect(() => {
    if (!autoPlay || !item) return undefined;
    setFlipped(false);
    if (playVoice) speakText(frontText, frontLang);
    const flipTimer = window.setTimeout(() => {
      setFlipped(true);
      if (playVoice) speakText(backText, backLang);
    }, 1800);
    const nextTimer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % ordered.length);
      setFlipped(false);
    }, 3900);
    return () => {
      window.clearTimeout(flipTimer);
      window.clearTimeout(nextTimer);
    };
  }, [autoPlay, item?.id, frontSide, playVoice, ordered.length]);

  if (!filtered.length) return <section className="page"><div className="empty">沒有可學習的卡片。</div></section>;
  return (
    <section className="page study-page">
      <div className="topbar">
        <div><span className="eyebrow">Flashcards · {set.label}</span><h1>學習模式</h1></div>
        <select value={filter} onChange={(e) => { setFilter(e.target.value); setIndex(0); }}>{types.map((type) => <option key={type}>{type}</option>)}</select>
      </div>
      <div className="study-toolstrip">
        <button className={frontSide === 'ko' ? 'selected-soft' : ''} onClick={() => setFrontSide('ko')}>韓文正面</button>
        <button className={frontSide === 'zh' ? 'selected-soft' : ''} onClick={() => setFrontSide('zh')}>中文正面</button>
        <button className={random ? 'selected-soft' : ''} onClick={() => { setRandom(!random); setShuffleSeed(Date.now()); }}><Shuffle size={16} /> 隨機</button>
        <button className={autoPlay ? 'selected-soft' : ''} onClick={() => setAutoPlay(!autoPlay)}>{autoPlay ? <Pause size={16} /> : <Play size={16} />} 自動</button>
        <button className={playVoice ? 'selected-soft' : ''} onClick={() => setPlayVoice(!playVoice)}>{playVoice ? <Volume2 size={16} /> : <VolumeX size={16} />} 語音</button>
      </div>
      <div className="flashcard-wrap">
        <button className="card-arrow left" onClick={goPrev} aria-label="上一張"><ChevronLeft size={26} /></button>
        <div className={`flashcard ${flipped ? 'flipped' : ''}`} role="button" tabIndex={0}
          onClick={() => { const next = !flipped; setFlipped(next); if (playVoice) speakText(next ? backText : frontText, next ? backLang : frontLang); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { const next = !flipped; setFlipped(next); if (playVoice) speakText(next ? backText : frontText, next ? backLang : frontLang); } }}
        >
          <div className="flash-face front">
            <span>{index + 1} / {ordered.length}</span>
            <strong>{frontText}</strong>
            <small>{frontSide === 'ko' ? item.pos || '比較' : '點擊看韓文'}</small>
            <button className="card-speak-btn" onClick={(e) => { e.stopPropagation(); speakText(frontText, frontLang); }} aria-label="播放發音"><Volume2 size={18} /></button>
          </div>
          <div className="flash-face back">
            <strong>{backText}</strong>
            <button className="card-speak-btn" onClick={(e) => { e.stopPropagation(); speakText(backText, backLang); }} aria-label="播放發音"><Volume2 size={18} /></button>
          </div>
        </div>
        <button className="card-arrow right" onClick={goNext} aria-label="下一張"><ChevronRight size={26} /></button>
      </div>
      {flipped && <div className="card-details"><StudyDetails item={item} allItems={set.items} onOpenRelated={setRelatedItems} /></div>}
      {relatedItems && <RelatedCardsModal items={relatedItems} onClose={() => setRelatedItems(null)} />}
      <div className="study-controls">
        <button onClick={() => mark('想再看一次')} className={learning?.status === '想再看一次' ? 'selected-soft' : ''}>想再看一次</button>
        <button onClick={() => mark('不熟悉')} className={learning?.status === '不熟悉' ? 'selected-soft' : ''}>不熟悉</button>
        <button onClick={() => mark('已熟悉')} className={learning?.status === '已熟悉' ? 'selected-soft' : ''}>已熟悉</button>
      </div>
    </section>
  );
}

function relatedKoList(item) {
  return (item.related || []).map((entry) => (typeof entry === 'string' ? entry : entry.ko)).filter(Boolean);
}

function collectRelatedItems(currentItem, clickedKo, allItems) {
  const byKo = new Map(allItems.map((entry) => [entry.ko, entry]));
  const selected = new Set([currentItem.ko, clickedKo]);
  let changed = true;
  while (changed) {
    changed = false;
    allItems.forEach((entry) => {
      const related = relatedKoList(entry);
      const shouldInclude = selected.has(entry.ko) || related.some((ko) => selected.has(ko));
      if (shouldInclude) {
        if (!selected.has(entry.ko)) {
          selected.add(entry.ko);
          changed = true;
        }
        related.forEach((ko) => {
          if (byKo.has(ko) && !selected.has(ko)) {
            selected.add(ko);
            changed = true;
          }
        });
      }
    });
  }
  return [...selected].map((ko) => byKo.get(ko)).filter(Boolean);
}

function RelatedCardsModal({ items, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel related-panel">
        <button className="modal-close" onClick={onClose} aria-label="關閉"><X size={18} /></button>
        <div className="panel-title related-title">
          <div><h2>相關單字比較</h2><span>{items.length} 張關聯卡片</span></div>
        </div>
        <div className="related-grid">
          {items.map((relatedItem) => <NoteCard key={relatedItem.id} item={relatedItem} />)}
        </div>
      </div>
    </div>
  );
}

function StudyDetails({ item, allItems, onOpenRelated }) {
  const hasDetails = item.pattern || item.examples?.length || item.senses?.length || item.notes?.length || item.related?.length || item.components?.length || item.items?.length;
  if (!hasDetails) return <div className="empty">這張卡片沒有額外例句或補充說明。</div>;
  return (
    <div className="study-details">
      {item.pattern && <p className="pattern">{item.pattern}</p>}
      {!!item.examples?.length && <div className="subblock"><b>例句</b>{item.examples.map((ex) => <p key={ex.ko}>{ex.ko}<br /><span>{ex.zh}</span></p>)}</div>}
      {!!item.senses?.length && <div className="subblock"><b>意思</b>{item.senses.map((sense) => <p key={sense.zh}>{sense.zh}{sense.pattern ? ` · ${sense.pattern}` : ''}</p>)}</div>}
      {!!item.notes?.length && <div className="subblock tips">{item.notes.map((note) => <p key={note}>{note}</p>)}</div>}
      {!!item.related?.length && (
        <div className="tags">
          {item.related.map((entry) => {
            const ko = typeof entry === 'string' ? entry : entry.ko;
            const zh = typeof entry === 'string' ? '' : entry.zh;
            return (
              <button key={ko} type="button" onClick={() => onOpenRelated(collectRelatedItems(item, ko, allItems))}>
                {ko}{zh ? ` · ${zh}` : ''}
              </button>
            );
          })}
        </div>
      )}
      {!!item.components?.length && <div className="tags">{item.components.map((entry) => <span key={entry.ko}>{entry.ko} · {entry.zh}</span>)}</div>}
      {!!item.items?.length && <div className="subblock">{item.items.map((entry) => <p key={entry.ko}>{entry.ko}<br /><span>{entry.zh}</span></p>)}</div>}
    </div>
  );
}

function PracticePage({ store, updateStore, set }) {
  const [direction, setDirection] = useState('zh-ko');
  const [source, setSource] = useState('term');
  const fixedTermOnly = set.termOnly || set.dueOnly;
  const [started, setStarted] = useState(false);
  const [questionQueue, setQuestionQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState(false);
  const [lastCorrect, setLastCorrect] = useState(null);
  const sourceQuestions = useMemo(() => {
    const activeSource = fixedTermOnly ? 'term' : source;
    const filtered = set.questions.filter((q) => activeSource === 'all' || q.kind === activeSource);
    return set.dueOnly ? dueQuestions(store, filtered) : filtered;
  }, [set.questions, source, fixedTermOnly, set.dueOnly, store]);
  const queue = started ? questionQueue : sourceQuestions;
  const question = queue[index];
  const resetSession = () => {
    setStarted(false);
    setQuestionQueue([]);
    setIndex(0);
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
  };
  const startSession = () => {
    const nextQuestions = shuffleItems(sourceQuestions, Date.now());
    if (!nextQuestions.length) {
      resetSession();
      return;
    }
    setQuestionQueue(nextQuestions);
    setStarted(true);
    setIndex(0);
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
  };
  const goNext = () => {
    setInput('');
    setResult(null);
    setRevealed(false);
    setGraded(false);
    setLastCorrect(null);
    if (index + 1 < queue.length) setIndex(index + 1);
    else resetSession();
  };
  // Used by the 公佈答案 give-up path and 韓翻中's self-grade buttons: records
  // the answer and immediately moves on, same as before.
  const submit = (correct) => {
    updateStore((current) => recordAnswer(current, question, correct));
    goNext();
  };
  // Used when 確認/Enter auto-grades a typed answer: records the result right
  // away (no manual 答對/答錯 choice) but keeps the question on screen so the
  // outcome is visible until the user presses Enter for the next one.
  const gradeAndRecord = (correct) => {
    updateStore((current) => recordAnswer(current, question, correct));
    setGraded(true);
    setLastCorrect(correct);
  };
  const handleConfirm = () => {
    if (graded || !input.trim()) return;
    const checkResult = compareAnswer(input, question.ko);
    setResult(checkResult);
    if (checkResult.isCorrect) {
      gradeAndRecord(true);
    } else {
      setRevealed(true);
      gradeAndRecord(false);
    }
  };
  const revealTypedAnswerAsWrong = () => {
    if (graded) return;
    setRevealed(true);
    setResult(null);
    gradeAndRecord(false);
  };

  useEffect(() => {
    if (!started) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Enter' && graded && !event.isComposing) {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [started, graded, index, queue.length]);

  if (!started) {
    return (
      <section className="page practice-start">
        <div className="panel start-panel">
          <span className="eyebrow">Practice · {set.label}</span>
          <h1>選擇練習方向</h1>
          <div className="segmented">
            <button className={direction === 'zh-ko' ? 'active' : ''} onClick={() => setDirection('zh-ko')}>中翻韓</button>
            <button className={direction === 'ko-zh' ? 'active' : ''} onClick={() => setDirection('ko-zh')}>韓翻中</button>
          </div>
          {fixedTermOnly ? (
            <div className="fixed-source-note">每日複習只包含單字 / 片語。</div>
          ) : (
            <div className="segmented">
              <button className={source === 'term' ? 'active' : ''} onClick={() => setSource('term')}>單字 / 片語</button>
              <button className={source === 'example' ? 'active' : ''} onClick={() => setSource('example')}>例句</button>
              <button className={source === 'all' ? 'active' : ''} onClick={() => setSource('all')}>全部</button>
            </div>
          )}
          <p>{sourceQuestions.length} 題可練習。中翻韓只會出打字題，韓翻中會先思考再公佈答案。</p>
          <button className="primary wide" disabled={!sourceQuestions.length} onClick={startSession}>開始</button>
        </div>
      </section>
    );
  }

  return (
    <section className="page practice-page">
      <div className="practice-layout">
        <div className="practice-shell">
          <div className="progress-line"><span style={{ width: `${((index + 1) / queue.length) * 100}%` }} /></div>
          <div className="quiz-meta quiz-meta-row"><span>{index + 1} / {queue.length} · {direction === 'zh-ko' ? '中翻韓' : '韓翻中'}</span><button onClick={() => setSummary(true)}>結束練習</button></div>
          {direction === 'zh-ko' ? (
            <>
              <div className="prompt">
                <span>請輸入韓文</span>
                <h1>{question.zh}</h1>
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
                <div className="actions answer-actions">
                  {!graded && !revealed ? (
                    <>
                      <button className="primary" onClick={handleConfirm}><Check size={18} /> 確認</button>
                      <button onClick={revealTypedAnswerAsWrong}><RotateCcw size={18} /> 公佈答案</button>
                    </>
                  ) : (
                    graded && lastCorrect && <CorrectFireworks />
                  )}
                </div>
              </div>
              {result && <DiffResult result={result} />}
            </>
          ) : (
            <>
              <div className="prompt ko"><span>請在心中想中文意思</span><h1>{question.ko}</h1></div>
              {!revealed ? <button className="primary wide" onClick={() => setRevealed(true)}>公佈答案</button> : (
                <div className="answer-panel grade-banner">
                  <strong><Check size={18} /> 請看右側單字卡後自評</strong>
                </div>
              )}
            </>
          )}
        </div>
        <PracticeAnswerPanel
          question={question}
          visible={revealed || graded}
          graded={graded}
          correct={lastCorrect}
          onCorrect={() => submit(true)}
          onWrong={() => submit(false)}
          onNext={goNext}
        />
      </div>
    </section>
  );
}

function PracticeAnswerPanel({ question, visible, graded, correct, onCorrect, onWrong, onNext }) {
  return (
    <aside className={`practice-answer-panel ${visible ? 'visible' : ''}`}>
      <div className="answer-panel-inner">
        {!visible ? (
          <div className="answer-placeholder">
            <span>答案卡片</span>
            <strong>答題後會顯示完整單字卡</strong>
          </div>
        ) : (
          <>
            <div className="answer-review-head">
              <span>{graded ? (correct ? '答對' : '答錯') : '公布答案'}</span>
              {question.kind === 'example' && <strong>例句來自這張卡片</strong>}
              {graded && <small>再按 Enter 進入下一題</small>}
            </div>
            <div className="answer-card-stage">
              <NoteCard item={question.source} />
            </div>
            <div className="answer-review-actions">
              {graded ? (
                <button className="primary wide" onClick={onNext}><ChevronRight size={18} /> 下一題</button>
              ) : (
                <>
                  <button className="success" onClick={onCorrect}><Check size={18} /> 答對</button>
                  <button className="danger-button" onClick={onWrong}><X size={18} /> 答錯</button>
                </>
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

function AnswerPanel({ question, revealed, onCorrect, onWrong }) {
  return (
    <div className="answer-panel">
      {revealed && <div><span>正確答案</span><strong>{question.ko}</strong><p>{question.zh}</p></div>}
      <div className="actions">
        <button className="success" onClick={onCorrect}><Check size={18} /> 答對</button>
        <button className="danger-button" onClick={onWrong}><X size={18} /> 答錯</button>
      </div>
    </div>
  );
}

function NotebookPage({ store, items, questions, onPractice, onStudy, onAddRecords, onUpdateRecord, onDeleteRecord }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('全部');
  const [level, setLevel] = useState('全部');
  const [sort, setSort] = useState('default');
  const [pageNumber, setPageNumber] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);
  const types = ['全部', ...new Set(items.map((item) => item.pos || '比較'))];
  const itemQuestionIds = new Map(items.map((item) => [item.id, questions.filter((q) => q.itemId === item.id).map((q) => q.id)]));
  const enriched = items.map((item) => {
    const ids = itemQuestionIds.get(item.id) || [item.id];
    const itemStats = ids.map((id) => getStats(store, id));
    const total = itemStats.reduce((sum, stat) => sum + stat.total, 0);
    const correct = itemStats.reduce((sum, stat) => sum + stat.correct, 0);
    const rate = total ? Math.round((correct / total) * 100) : 0;
    const levelValue = itemStats.some((stat) => stat.level === '不熟悉') ? '不熟悉' : itemStats.some((stat) => stat.level === '已熟練') ? '已熟練' : itemStats.some((stat) => stat.level === '熟悉') ? '熟悉' : '學習中';
    return { ...item, total, rate, level: levelValue };
  }).filter((item) => {
    const matchesQuery = !query || itemSearchText(item).includes(query.toLowerCase());
    const matchesType = type === '全部' || item.pos === type;
    const matchesLevel = level === '全部' || item.level === level;
    return matchesQuery && matchesType && matchesLevel;
  }).sort((a, b) => {
    if (sort === 'rate') return a.rate - b.rate;
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    const aTime = a.createdAt || `${a.date}T00:00:00.000Z`;
    const bTime = b.createdAt || `${b.date}T00:00:00.000Z`;
    if (aTime !== bTime) return bTime.localeCompare(aTime);
    return b.index - a.index;
  });
  const pageSize = 30;
  const pageCount = Math.max(1, Math.ceil(enriched.length / pageSize));
  const pagedItems = enriched.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  const practiceQuestions = questions.filter((question) => enriched.some((item) => item.id === question.itemId));

  useEffect(() => {
    setPageNumber(1);
  }, [query, type, level, sort]);

  return (
    <section className="page">
      <div className="topbar">
        <div><span className="eyebrow">Notebook</span><h1>單字本</h1></div>
        <div className="actions">
          <button onClick={() => exportNotebookItems(items)}>匯出 JSON</button>
          <button className="add-date-button" onClick={() => setAddOpen(true)}>新增單字</button>
          <button onClick={() => onStudy(enriched, '篩選結果')}><BookOpen size={18} /> 學習篩選結果</button>
          <button className="primary" onClick={() => onPractice(practiceQuestions, '篩選結果測驗')}><Dumbbell size={18} /> 練習篩選結果</button>
        </div>
      </div>
      <div className="filters">
        <label className="search"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋單字、例句、筆記或相關詞" /></label>
        <select value={type} onChange={(e) => setType(e.target.value)}>{types.map((option) => <option key={option}>{option}</option>)}</select>
        <select value={level} onChange={(e) => setLevel(e.target.value)}>{['全部', '不熟悉', '學習中', '熟悉', '已熟練'].map((option) => <option key={option}>{option}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="default">最新加入優先</option><option value="rate">答對率低優先</option></select>
      </div>
      {addOpen && (
        <AddItemsModal
          title="新增單字"
          date={todayString()}
          allItems={items}
          onAddRecords={onAddRecords}
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
          onUpdateRecord={onUpdateRecord}
          onClose={() => setEditingItem(null)}
        />
      )}
      {viewingItem && (
        <ItemDetailModal
          item={viewingItem}
          onEdit={(item) => {
            setViewingItem(null);
            setEditingItem(item);
          }}
          onDelete={onDeleteRecord}
          onClose={() => setViewingItem(null)}
        />
      )}
      <div className="word-grid">
        {pagedItems.map((item) => <WordCard key={item.id} item={item} onEdit={setEditingItem} onDelete={onDeleteRecord} onOpen={setViewingItem} />)}
      </div>
      <div className="pagination">
        <button disabled={pageNumber <= 1} onClick={() => setPageNumber(pageNumber - 1)}><ChevronLeft size={18} /> 上一頁</button>
        <span>{pageNumber} / {pageCount} · 共 {enriched.length} 筆</span>
        <button disabled={pageNumber >= pageCount} onClick={() => setPageNumber(pageNumber + 1)}>下一頁 <ChevronRight size={18} /></button>
      </div>
    </section>
  );
}

function MiniQuestion({ question, store }) {
  const stats = getStats(store, question.id);
  return <div className="mini"><strong>{question.ko}</strong><span>{question.zh}</span><MasteryBadge level={stats.level} /></div>;
}

function WordCard({ item, onEdit, onDelete, onOpen }) {
  return (
    <article className="word-card clickable-card" onClick={() => onOpen(item)}>
      <div className="card-head">
        <h3>{item.ko}</h3>
        <div className="card-actions">
          <EditIconButton onClick={() => onEdit(item)} />
          <DeleteIconButton item={item} onDelete={onDelete} />
          <MasteryBadge level={item.level} />
        </div>
      </div>
      <p>{item.zh}</p>
      <div className="word-meta"><span>{item.pos || '比較'}</span><span>{item.date}</span><span>{item.total} 次</span><span>{item.rate}%</span></div>
    </article>
  );
}

createRoot(document.getElementById('root')).render(<App />);
