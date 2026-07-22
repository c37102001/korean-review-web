# 韓文筆記

韓語學習與間隔測驗網頁。前端使用 Vite + React，資料使用既有 Firebase 專案 `korean-review-web` 的 Auth + Firestore。

## 本機開發

```bash
npm install
npm run dev
```

開啟 `http://localhost:5173/`，使用 Firebase Email/Password 帳號登入。

## 資料來源

學習內容直接讀寫 Firestore（schema v3）：

- `users/{uid}/records/{recordId}`：單字卡唯一資料來源
- `users/{uid}/progressShards/{00..15}`：分成 16 份的答題統計與 SRS 進度
- `users/{uid}/reviewDays/{date}`：按日期分組的作答紀錄
- `users/{uid}/settings/review`：星號、完成日期、每日認字輪次與 DB schema 版本

progress shard 只會原子更新變動題目；作答紀錄使用原子追加，避免網頁、手機與 terminal 同時使用時互相覆寫。每日認字輪次保存於 settings，不再依賴重播全部歷史紀錄。

內容 schema v2：

- 每張卡片保留穩定 `id`。
- 中文意思放在 `meanings[].zh`。
- 例句只放在 `meanings[].examples[]`。
- 備註只放在頂層 `notes`。
- 相關詞 `related` 使用卡片 id 陣列。
- 頂層不接受 `zh`、`examples` 或 `senses`。

## Firebase

沿用原本 Firebase web config，位置在：

- `src/firebase.js`

Firestore rules：

- `firestore.rules`

目前規則限制登入使用者只能讀寫自己的 `users/{uid}` 資料。

## 部署

Vite `base` 已設定為 `/korean-review-web/`，GitHub Actions workflow 在 push 到 `main` 後會部署到 GitHub Pages。

```bash
npm run build
```
