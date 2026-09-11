import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  waitForPendingWrites,
} from 'firebase/firestore';

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

export async function prepareOfflineFirestoreData(uid, today, onProgress) {
  const targets = [
    ['單字', () => getDocsFromServer(collection(db, 'users', uid, 'records'))],
    ['熟悉度與複習排程', () => getDocsFromServer(collection(db, 'users', uid, 'progressShards'))],
    ['資料夾', () => getDocsFromServer(collection(db, 'users', uid, 'folders'))],
    ['筆記', () => getDocsFromServer(collection(db, 'users', uid, 'grammarNotes'))],
    ['YT 字幕文字', () => getDocsFromServer(collection(db, 'users', uid, 'ytSubtitles'))],
    ['閱讀測驗', () => getDocsFromServer(collection(db, 'users', uid, 'readingTests'))],
    ['測驗設定', () => getDocFromServer(doc(db, 'users', uid, 'settings', 'review'))],
    ['自選練習', () => getDocFromServer(doc(db, 'users', uid, 'settings', 'grammarReview'))],
    ['今日作答紀錄', () => getDocFromServer(doc(db, 'users', uid, 'reviewDays', today))],
  ];
  let documentCount = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const [label, load] = targets[index];
    onProgress?.({ current: index + 1, total: targets.length, label });
    const snapshot = await load();
    documentCount += 'size' in snapshot ? snapshot.size : Number(snapshot.exists());
  }
  return { documentCount, sectionCount: targets.length };
}

export function waitForFirestoreSync() {
  return waitForPendingWrites(db);
}
