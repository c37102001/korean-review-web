# 韓文複習網頁

依「艾賓浩斯遺忘曲線」(1 → 3 → 7 → 14 → 30 → 90 天) 安排複習，含月曆學習紀錄、每日自動複習待辦（考試形式，多元題型）、單字本（依詞性/熟練度篩選）。前端 Vite + React，資料庫用 Firebase（Firestore + Auth，皆為免費 Spark 方案），部署到 GitHub Pages。

## 本機開發

```bash
npm install
npm run dev
```

在能實際登入前，需要先完成下面「Firebase 專案設定」。

## Firebase 專案設定（一次性，約 10 分鐘）

1. 前往 [Firebase Console](https://console.firebase.google.com/) → 新增專案（免費 Spark 方案即可，不需要綁信用卡）。
2. 左側選單 **Build → Firestore Database** → 建立資料庫 → 選 production mode → 選一個離你近的 region。
3. 建立資料庫後，切到 **規則 (Rules)** 分頁，貼上本專案 `firestore.rules` 的內容並發布：
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
4. 左側選單 **Build → Authentication** → 開始使用 → **Sign-in method** → 啟用 **電子郵件/密碼**。
5. 切到 **Users** 分頁 → 新增使用者，輸入你自己要用的 email/密碼（這是你唯一會用到的帳號，網站本身沒有註冊頁面）。
6. 左側選單齒輪 → **專案設定** → 往下捲到「你的應用程式」→ 新增網頁應用程式（不需要勾選 Hosting）→ 複製顯示的 `firebaseConfig` 物件。
7. 打開 `src/firebase.js`，把裡面的 `REPLACE_ME` 換成你複製的實際值。
   > Firebase 網頁端的 config（apiKey 等）本來就設計成可以公開，安全性是靠上面的 Firestore 規則 + 登入驗證把關，所以直接提交進 repo 是沒問題的，不需要另外處理環境變數或 CI 密鑰。
8. `npm run dev`，用你剛剛建立的帳號登入測試。

## 匯入第一批筆記

可以直接用專案內 `korean_study_notes_simple_2026-07-05.json` 的內容測試：進入「月曆」分頁，點選任一日期 → 「新增/貼上 JSON」→ 貼上該檔案中 `{ "data": [...] }` 的完整內容 → 預覽 → 確認匯入。

之後每天把讀書筆記整理成同樣格式的 JSON（可參考 `README.txt` 的格式說明；實際欄位不需要完全照著 enum，程式會盡量寬容解析），貼到當天日期即可。

## 部署到 GitHub Pages

1. 在 GitHub 建立一個新專案，**名稱務必是 `korean-review-web`**（因為 `vite.config.js` 裡的 `base` 設定是 `/korean-review-web/`；如果你想用別的專案名稱，記得同步修改該設定）。
2. 把這個資料夾初始化 git 並 push 上去：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <你的 GitHub 專案 git URL>
   git push -u origin main
   ```
3. **重要**：到 GitHub 專案的 **Settings → Pages**，把 **Source** 改成 **GitHub Actions**（預設是 "Deploy from a branch"，不改的話 `.github/workflows/deploy.yml` 就算跑成功也不會真的發佈，會一直 404）。
4. Push 後（或去 **Actions** 分頁手動觸發 `Deploy to GitHub Pages` workflow）會自動 build 並部署，完成後網站會在：
   `https://<你的 GitHub 帳號>.github.io/korean-review-web/`
   （在專案的 **Settings → Pages** 頁面可以看到確切網址；在 **Actions** 分頁可以看部署進度/log。）
5. 之後每次 push 到 `main` 分支都會自動重新部署。「No releases published」是 GitHub 的 Releases 功能（跟 Pages 部署無關），不用理它。

## 架構重點（給未來維護參考）

- **SRS 規則**（`src/lib/srs.js`）：間隔階段 `[1, 3, 7, 14, 30, 90]` 天。答對進下一階段，答錯重置回第 1 階段（1 天後再考）。「今日待複習」= 所有 `nextReviewDate <= 今天` 的字卡，未複習完會自然累積到隔天。
- **熟練度**（`src/lib/mastery.js`）：複習 ≥3 次後才會判定；正確率 ≥85% 且已進到 14 天以上階段 → 熟練；正確率 <50% → 不熟悉；其餘為普通。
- **資料解析**（`src/lib/cardParser.js`）：以 `ko` 欄位（去空白）當作字卡的唯一鍵去重；`type: "contrast"` 的比較群組會被當成獨立的「選出正確相似字」題型卡片。
- **出題邏輯**（`src/lib/quizGenerator.js`）：依字卡有哪些欄位（`related`/`examples`/`forms`）隨機挑選題型 —— 韓譯中、中譯韓、相似字選擇、例句翻譯、動詞變化形。選擇題自動計分；回想題採自評（顯示答案後自己按答對/答錯），這是因為韓文/中文的自由輸入比對容易誤判，用「主動回想 + 自評」更貼近筆記裡提到的間隔重複方法。
- **Firestore 結構**：`users/{uid}/days/{date}`（當天原始貼上內容）與 `users/{uid}/cards/{cardId}`（正規化後的字卡 + SRS 狀態 + 統計數字）。
