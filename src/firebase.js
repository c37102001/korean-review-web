import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  collection,
  disableNetwork,
  doc,
  enableNetwork,
  getDocFromCache,
  getDocFromServer,
  getDocsFromCache,
  getDocsFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  waitForPendingWrites,
} from 'firebase/firestore';
import {
  clearOfflineDataCoverage,
  manualOfflineEnabled,
  markOfflineSectionReady,
  offlineDataCoverage,
} from './offlineSupport.js';
import { clearRecordSyncCheckpoint, updateRecordSyncCheckpoint } from './firestoreSync.js';
import { reviewAttemptSegmentsRef } from './repositories/reviewDaysRepository.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCfy63R72H6LDCb-bR7L7RwkKNnGCTHPgU',
  authDomain: 'korean-review-web.firebaseapp.com',
  projectId: 'korean-review-web',
  storageBucket: 'korean-review-web.firebasestorage.app',
  messagingSenderId: '340404658075',
  appId: '1:340404658075:web:cf77a3d166613cba930b3e',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Reuse the same IndexedDB-backed cache across browser tabs to avoid re-reading
// the complete notebook whenever this trusted-device app is reopened.
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  // Private browsing or blocked IndexedDB should not prevent online access.
  db = getFirestore(app);
}
export { db };

// Apply the saved manual mode before page listeners are attached. Firestore then
// serves snapshots from IndexedDB and keeps writes pending until network resumes.
if (manualOfflineEnabled()) disableNetwork(db).catch(() => {});

export function setFirestoreNetworkEnabled(enabled) {
  return enabled ? enableNetwork(db) : disableNetwork(db);
}

export async function prepareOfflineFirestoreData(uid, today, onProgress, { forceFull = false } = {}) {
  const targets = [
    ['records', '單字', collection(db, 'users', uid, 'records')],
    ['progress', '熟悉度與複習排程', collection(db, 'users', uid, 'progressShards')],
    ['folders', '資料夾', collection(db, 'users', uid, 'folders')],
    ['grammarNotes', '筆記', collection(db, 'users', uid, 'grammarNotes')],
    ['ytSubtitles', 'YT 字幕文字', collection(db, 'users', uid, 'ytSubtitles')],
    ['readingTests', '閱讀測驗', collection(db, 'users', uid, 'readingTests')],
    ['reviewSettings', '測驗設定', doc(db, 'users', uid, 'settings', 'review')],
    ['grammarReview', '自選練習', doc(db, 'users', uid, 'settings', 'grammarReview')],
    [`reviewDay:${today}`, '今日作答紀錄', doc(db, 'users', uid, 'reviewDays', today)],
    [`reviewAttemptSegments:${today}`, '今日分段作答紀錄', reviewAttemptSegmentsRef(db, uid, today)],
  ];
  if (forceFull) {
    clearOfflineDataCoverage(uid);
    clearRecordSyncCheckpoint(uid);
  }
  const coverage = offlineDataCoverage(uid);
  let documentCount = 0;
  let downloadedCount = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const [section, label, reference] = targets[index];
    const cached = !forceFull && Boolean(coverage[section]);
    const isDocument = reference.type === 'document';
    onProgress?.({ current: index + 1, total: targets.length, label, cached });
    let snapshot;
    try {
      snapshot = isDocument
        ? await (cached ? getDocFromCache(reference) : getDocFromServer(reference))
        : await (cached ? getDocsFromCache(reference) : getDocsFromServer(reference));
    } catch (error) {
      if (!cached) throw error;
      snapshot = isDocument ? await getDocFromServer(reference) : await getDocsFromServer(reference);
      downloadedCount += 'size' in snapshot ? snapshot.size : Number(snapshot.exists());
    }
    const count = 'size' in snapshot ? snapshot.size : Number(snapshot.exists());
    documentCount += count;
    if (!cached) downloadedCount += count;
    markOfflineSectionReady(uid, section);
    if (section === 'records' && !snapshot.metadata.fromCache) updateRecordSyncCheckpoint(uid, snapshot.docs || []);
  }
  return { documentCount, downloadedCount, sectionCount: targets.length, forceFull };
}

export function waitForFirestoreSync() {
  return waitForPendingWrites(db);
}
