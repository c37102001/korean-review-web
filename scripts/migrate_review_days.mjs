import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDocs,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

import {
  REVIEW_DAY_STORAGE_VERSION,
  reviewAttemptSegmentId,
} from '../src/repositories/reviewDaysRepository.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCfy63R72H6LDCb-bR7L7RwkKNnGCTHPgU',
  authDomain: 'korean-review-web.firebaseapp.com',
  projectId: 'korean-review-web',
};

const email = process.env.TERMINAL_PRACTICE_EMAIL;
const password = process.env.TERMINAL_PRACTICE_PASSWORD;
const apply = process.argv.includes('--apply');
const cleanupLegacy = process.argv.includes('--cleanup-legacy');
if (!email || !password) throw new Error('.env 必須提供 TERMINAL_PRACTICE_EMAIL 與 TERMINAL_PRACTICE_PASSWORD');

const app = initializeApp(firebaseConfig, `review-day-migration-${Date.now()}`);
const auth = getAuth(app);
const { user } = await signInWithEmailAndPassword(auth, email, password);
const db = getFirestore(app);
const days = await getDocs(collection(db, 'users', user.uid, 'reviewDays'));
const pending = days.docs.filter((snapshot) => Array.isArray(snapshot.data().attempts) && snapshot.data().attempts.length);
const attemptCount = pending.reduce((sum, snapshot) => sum + snapshot.data().attempts.length, 0);

console.log(`${apply || cleanupLegacy ? '開始遷移' : '預覽'}：${pending.length} 天、${attemptCount} 筆舊版作答紀錄。`);
if (!apply && !cleanupLegacy) {
  console.log('尚未寫入 Firestore。確認後執行：npm run db:migrate-review-days -- --apply');
  process.exit(0);
}

for (let index = 0; index < pending.length; index += 1) {
  const snapshot = pending[index];
  const attempts = snapshot.data().attempts;
  const groups = new Map();
  attempts.forEach((attempt) => {
    if (!attempt?.id) return;
    const segmentId = reviewAttemptSegmentId(attempt.id);
    if (!groups.has(segmentId)) groups.set(segmentId, []);
    groups.get(segmentId).push(attempt);
  });
  const batch = writeBatch(db);
  groups.forEach((entries, segmentId) => {
    batch.set(doc(snapshot.ref, 'attemptSegments', segmentId), {
      date: snapshot.id,
      segmentId,
      attempts: arrayUnion(...entries),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
  batch.set(snapshot.ref, {
    date: snapshot.id,
    attemptStorageVersion: REVIEW_DAY_STORAGE_VERSION,
    migratedAt: serverTimestamp(),
    ...(cleanupLegacy ? { attempts: deleteField() } : {}),
  }, { merge: true });
  await batch.commit();
  console.log(`${index + 1}/${pending.length} ${snapshot.id}：${attempts.length} 筆 -> ${groups.size} 段`);
}

console.log(`遷移完成：${pending.length} 天、${attemptCount} 筆紀錄。`);
if (!cleanupLegacy && pending.length) {
  console.log('已保留舊 attempts 供尚未更新的網頁使用。新版部署後可執行：npm run db:migrate-review-days -- --cleanup-legacy');
}
