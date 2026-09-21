import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, getDocs, getFirestore, serverTimestamp, writeBatch } from 'firebase/firestore';

import { classifyLegacyWordPos } from './word-pos-classifications.mjs';
import { isAllowedWordPos } from '../src/words/partOfSpeech.js';

const email = process.env.TERMINAL_PRACTICE_EMAIL;
const password = process.env.TERMINAL_PRACTICE_PASSWORD;
if (!email || !password) throw new Error('.env 必須設定 Terminal 登入帳密');

const app = initializeApp({
  apiKey: 'AIzaSyCfy63R72H6LDCb-bR7L7RwkKNnGCTHPgU',
  authDomain: 'korean-review-web.firebaseapp.com',
  projectId: 'korean-review-web',
}, `word-pos-migration-${Date.now()}`);

try {
  const auth = getAuth(app);
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  const snapshot = await getDocs(collection(db, 'users', user.uid, 'records'));
  const changes = [];
  const unresolved = [];
  const categoryCounts = {};
  snapshot.docs.forEach((entry) => {
    const record = entry.data();
    if (record.deletedAt) return;
    const item = record.item || {};
    const pos = classifyLegacyWordPos(item);
    if (!isAllowedWordPos(pos)) unresolved.push(`${entry.id}: ${item.ko || '(無韓文)'} (${item.pos || '空白'})`);
    else {
      categoryCounts[pos] = (categoryCounts[pos] || 0) + 1;
      if (pos !== item.pos) changes.push({ ref: entry.ref, before: item.pos ?? null, after: pos });
    }
  });
  console.log(`讀取 ${snapshot.size} 份文件；需修改 ${changes.length} 份；待確認 ${unresolved.length} 份。`);
  console.log(`預計分類：${Object.entries(categoryCounts).map(([pos, count]) => `${pos} ${count}`).join('、')}`);
  if (unresolved.length) {
    console.error(unresolved.join('\n'));
    throw new Error('仍有無法判定的詞性，未寫入任何資料');
  }
  if (!process.argv.includes('--apply')) {
    console.log('僅預覽，尚未寫入。確認後加 --apply。');
  } else if (changes.length) {
    const backupDir = join(homedir(), '.cache', 'korean-review-web-terminal', 'migrations');
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const backupPath = join(backupDir, `word-pos-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(backupPath, JSON.stringify({
      uid: user.uid,
      records: snapshot.docs.map((entry) => ({ id: entry.id, data: entry.data() })),
    }), { mode: 0o600, flag: 'wx' });
    console.log(`已備份原始文件至 ${backupPath}`);
    for (let offset = 0; offset < changes.length; offset += 200) {
      const batch = writeBatch(db);
      for (const change of changes.slice(offset, offset + 200)) {
        batch.update(change.ref, { 'item.pos': change.after, updatedAt: serverTimestamp() });
      }
      await batch.commit();
      console.log(`已更新 ${Math.min(offset + 200, changes.length)}/${changes.length} 份文件`);
    }
  }
  await signOut(auth);
} finally {
  await deleteApp(app);
}
