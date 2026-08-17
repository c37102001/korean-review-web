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
- `users/{uid}/settings/review`：星號、完成日期、每日單字例句聽力輪次與 DB schema 版本

progress shard 只會原子更新變動題目；作答紀錄使用原子追加，避免網頁、手機與 terminal 同時使用時互相覆寫。每日單字例句聽力輪次保存於 settings，不再依賴重播全部歷史紀錄。

內容 schema v2：

- 每張卡片保留穩定 `id`。
- `order` 是同一天內的排序值，必須是安全整數。日期頁由小到大排列，單字本則由大到小顯示最新內容；未提供時，JSON 匯入會依陣列順序自動產生，匯出時也會保留。
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

## Terminal 測驗

```bash
python3 -m pip install -r requirements-terminal.txt
python3 terminal_review_practice.py
```

每日單字例句聽力使用 Microsoft Neural 韓文語音，並將產生的音檔快取在
`~/.cache/korean-review-web/tts`。系統需要 `cvlc` 或 `ffplay` 播放音檔；
無網路或 Neural 語音不可用時，程式會退回 `spd-say`／`espeak-ng`。

單字例句聽力快捷鍵：`7` 重播目前例句、`8` 公佈完整單字卡，之後以
`1`（答錯）或 `2`（答對）自評。

每日到期單字測驗公佈答案後會自動播放第一個韓文例句；使用 `7` 重播目前
例句，或使用 `+` 切換並播放下一個例句。

每日文法例句聽力會依建立時間每天輪到一個文法，並測驗該文法的全部例句。
使用 `7` 重播；`8` 會依序顯示中文提示與韓文答案，翻面後用 `1`（答錯）
或 `2`（答對）自評。結果不計入正確率，完成整組後隔天會輪到下一個文法。

主選單的「文法筆記」可瀏覽完整筆記與全部例句；詳細頁使用 `4/6` 切換文法、
`7` 播放目前例句、`9` 切換並播放下一句。

每日到期單字若在本次答題前已累積答對至少 5 次，答對後可選擇將下一次複習
直接安排到 30 天後；網頁與 Terminal 都會先詢問，不選擇延後則維持原排程。

## 部署

Vite `base` 已設定為 `/korean-review-web/`，GitHub Actions workflow 在 push 到 `main` 後會部署到 GitHub Pages。

```bash
npm run build
```
