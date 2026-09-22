import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { arrayUnion, collection, getDocFromServer, getDocs, getFirestore, serverTimestamp, writeBatch } from 'firebase/firestore';

import { buildVariantPlan } from './word-variant-candidates.mjs';

const cacheDir = join(homedir(), '.cache', 'korean-review-web-terminal');
const migrationDir = join(cacheDir, 'migrations');
const email = process.env.TERMINAL_PRACTICE_EMAIL;
const password = process.env.TERMINAL_PRACTICE_PASSWORD;
const applyArg = process.argv.find((argument) => argument.startsWith('--apply='));
const remotePreview = process.argv.includes('--remote-preview');

if (!email) throw new Error('.env 必須設定 TERMINAL_PRACTICE_EMAIL');
if (applyArg && remotePreview) throw new Error('不能同時預覽和套用');

async function cachedRecords() {
  const files = (await readdir(cacheDir)).filter((name) => name.endsWith('.json') && !name.startsWith('preferences-'));
  for (const file of files) {
    const payload = JSON.parse(await readFile(join(cacheDir, file), 'utf8'));
    if (payload.account?.email === email && Array.isArray(payload.records)) {
      return { uid: payload.account.uid, records: payload.records };
    }
  }
  throw new Error('找不到此帳號的 Terminal 本機單字快取；請先執行 Terminal 同步或使用 --remote-preview');
}

async function withRemote(callback) {
  if (!password) throw new Error('.env 必須設定 TERMINAL_PRACTICE_PASSWORD 才能讀取遠端');
  const app = initializeApp({
    apiKey: 'AIzaSyCfy63R72H6LDCb-bR7L7RwkKNnGCTHPgU',
    authDomain: 'korean-review-web.firebaseapp.com',
    projectId: 'korean-review-web',
  }, `word-variants-${Date.now()}`);
  try {
    const auth = getAuth(app);
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    const db = getFirestore(app);
    const snapshot = await getDocs(collection(db, 'users', user.uid, 'records'));
    return await callback({ uid: user.uid, db, snapshot, records: snapshot.docs.map((entry) => ({ ...entry.data(), _docId: entry.id })) });
  } finally {
    await signOut(getAuth(app)).catch(() => {});
    await deleteApp(app);
  }
}

function summary(records, plan) {
  const eligible = records.filter((record) => !record.deletedAt && ['動詞', '形容詞'].includes(record.item?.pos));
  console.log(`共 ${records.length} 份文件；動詞／形容詞 ${eligible.length} 張；待補 ${plan.changes.length} 張；略過 ${plan.skipped.length} 張。`);
  console.log(`預計新增 ${plan.changes.reduce((total, change) => total + change.additions.length, 0)} 個活用。`);
  console.log(`略過原因：${JSON.stringify(Object.fromEntries([...new Set(plan.skipped.map((entry) => entry.reason))].map((reason) => [reason, plan.skipped.filter((entry) => entry.reason === reason).length])))}`);
  for (const change of plan.changes.slice(0, 15)) console.log(`${change.ko} (${change.pos}) → ${change.additions.join('、')}`);
}

await mkdir(migrationDir, { recursive: true, mode: 0o700 });
if (applyArg) {
  const approved = JSON.parse(await readFile(applyArg.slice('--apply='.length), 'utf8'));
  if (!approved.uid || !Array.isArray(approved.changes)) throw new Error('變更清單格式不正確');
  await withRemote(async ({ uid, db, snapshot, records }) => {
    if (uid !== approved.uid) throw new Error('變更清單不屬於目前登入帳號');
    const current = buildVariantPlan(records);
    if (records.length !== approved.recordsCount || JSON.stringify(current.changes) !== JSON.stringify(approved.changes)) {
      throw new Error('遠端資料和預覽清單不同；請重新產生 --remote-preview 並檢查，未寫入任何資料');
    }
    summary(records, current);
    if (!current.changes.length) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(migrationDir, `word-variants-backup-${stamp}.json`);
    await writeFile(backupPath, JSON.stringify({ uid, records }), { mode: 0o600, flag: 'wx' });
    console.log(`原始文件已備份：${backupPath}`);
    const byId = new Map(snapshot.docs.map((entry) => [entry.id, entry.ref]));
    for (let offset = 0; offset < current.changes.length; offset += 200) {
      const batch = writeBatch(db);
      for (const change of current.changes.slice(offset, offset + 200)) {
        batch.update(byId.get(change.id), {
          'item.variants': arrayUnion(...change.additions),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      console.log(`已更新 ${Math.min(offset + 200, current.changes.length)}/${current.changes.length} 張`);
    }
    for (let offset = 0; offset < current.changes.length; offset += 25) {
      const group = current.changes.slice(offset, offset + 25);
      const verified = await Promise.all(group.map((change) => getDocFromServer(byId.get(change.id))));
      for (let index = 0; index < group.length; index += 1) {
        const variants = verified[index].data()?.item?.variants;
        if (!Array.isArray(variants) || !group[index].additions.every((form) => variants.includes(form))) {
          throw new Error(`${group[index].ko} (${group[index].id}) 寫入後驗證失敗`);
        }
      }
    }
    console.log(`已從伺服器逐張驗證 ${current.changes.length} 張卡片的新增活用。`);
  });
} else {
  const source = remotePreview
    ? await withRemote(async ({ uid, records }) => ({ uid, records }))
    : await cachedRecords();
  const plan = buildVariantPlan(source.records);
  summary(source.records, plan);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const planPath = join(migrationDir, `word-variants-plan-${stamp}.json`);
  await writeFile(planPath, JSON.stringify({ uid: source.uid, recordsCount: source.records.length, ...plan }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(`完整預覽清單：${planPath}`);
  console.log('未寫入資料庫；檢查後以 --apply=<預覽清單路徑> 套用。');
}
