# 韓文筆記

韓語學習與間隔測驗網頁。前端使用 Vite + React，資料使用既有 Firebase 專案 `korean-review-web` 的 Auth + Firestore。

## 本機開發

```bash
npm install
npm run dev
```

開啟 `http://localhost:5173/`，使用 Firebase Email/Password 帳號登入。

## 資料來源

目前學習內容先由本地 JSON 匯入：

- `korean_study_notes_simple_minimal_2026-07-05.json`

登入後，網站會把這份 JSON 同步到 Firestore：

- `users/{uid}/days/{date}`：每日原始 JSON 與統計
- `users/{uid}/items/{itemId}`：解析後的學習項目
- `users/{uid}/questions/{questionId}`：解析後的測驗題
- `users/{uid}/records/{recordId}`：從日曆或單字本新增的原始單字資料
- `users/{uid}/appState/reviewState`：答題紀錄、熟練度、SRS 進度、學習標記

內容 schema v2：

- 每張卡片保留穩定 `id`。
- 中文意思放在 `meanings[].zh`。
- 例句只放在 `meanings[].examples[]`。
- 備註只放在頂層 `notes`。
- 相關詞 `related` 使用卡片 id 陣列。
- 不再使用頂層 `zh`、頂層 `examples` 或 `senses`。

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
