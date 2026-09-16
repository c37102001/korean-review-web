# 韓文筆記架構重構指南

> 盤點基準：2026-09-16，commit `ddc601b`
>
> 本文件是後續重構的決策依據，不代表要一次重寫整個專案。所有階段都應維持既有 Firestore schema、離線同步與使用者操作行為，採小步搬移、逐頁驗證。

## 1. 結論

目前專案功能完整，但前端已出現明顯的「功能集中、呈現分裂」問題：

- `src/main.jsx` 已有 9,198 行，資料存取、領域規則、頁面、元件、流程狀態與路由都集中在同一檔案。
- `src/styles.css` 已有 6,738 行，同一元件在多個區段及 media query 中被覆寫，樣式來源不容易追蹤。
- `terminal_review_practice.py` 已有 5,610 行，API、快取、領域計算、語音與 curses 畫面都在同一模組。
- 單字本使用 `WordCard`，日期與資料夾使用 `NoteCard compact`。它們描述同一種單字資料，卻有不同 DOM 與 CSS，因此單字本排版修正不會套用到資料夾。
- 學習與測驗並非每個入口都各寫一份。網頁目前已有集中式 `StudyPage` 與 `PracticePage`，這是正確方向；問題是兩個元件本身過大，而且啟動方式依賴大量 boolean 選項，模式差異散落在條件分支中。
- Firestore 的 cache-first、增量同步與 tombstone 已開始抽成 repository，這也是正確方向；但 CRUD、資料正規化與 UI state 仍有不少留在 `main.jsx`。

因此，不建議全面重寫。最有效的策略是先建立清楚的模組邊界，再將現有行為逐項搬入共用模組。第一優先應是統一單字卡及單字集合頁，因為這正是目前已發生 UI 漂移的地方。

## 2. 目前架構盤點

### 2.1 已經具備、應保留的基礎

以下內容已有合理的共用方向，不應在重構時推翻：

- `src/repositories/incrementalCollectionRepository.js` 已集中 cache-first 與 `updatedAt` 增量監聽。
- `src/repositories/reviewDaysRepository.js` 已集中每日作答分段儲存。
- `src/folders/model.js`、`src/notes/model.js`、`src/subtitles/model.js` 已開始承接正規化與純領域函式。
- `src/review-engine/store.js`、`src/practice/optionalPractice.js` 已將部分複習與自選練習規則移出 UI。
- 所有網頁學習入口最後都進入 `StudyPage`，所有網頁測驗入口最後都進入 `PracticePage`。
- 筆記已用 `category` 共用文法／單字筆記的資料模型，而不是維護兩份近似功能。這可作為其他功能重構的參考。

### 2.2 主要集中點

| 區域 | 現況 | 直接風險 |
| --- | --- | --- |
| `src/main.jsx` | 9,198 行，包含幾乎所有 Web 功能 | 修改範圍難界定、測試耦合、多人修改衝突高 |
| `PracticePage` | 約 694 行，處理多種測驗模式 | boolean 組合增加時容易產生未涵蓋狀態 |
| `AddItemsForm` | 約 460 行，表單與 JSON 匯入流程混合 | 單字編輯、匯入、衝突解決互相牽動 |
| `StudyPage` | 約 455 行，導覽、語音、自動播放、觸控、資料夾操作混合 | 小改動容易影響鍵盤、手機或自動播放 |
| `YoutubeSubtitleReader` | 約 330 行 | 播放器、選字、同步捲動與新增單字耦合 |
| `ReadingTestPage` | 約 262 行 | 閱讀作答與可選文字工具重複處理 |
| `App` | 約 217 行，手動路由及所有依賴注入 | prop 鏈很長，頁面載入政策與導航難獨立測試 |
| `styles.css` | 6,738 行 | 同名 selector 分散，頁面特例持續累積 |
| Terminal 主程式 | 5,610 行 | Web／Terminal 領域規則容易逐漸不一致 |

## 3. 最高優先：統一單字卡與單字集合頁

### 3.1 已確認的問題

目前同一筆單字至少有兩套列表卡片：

- 單字本在 `src/main.jsx:9074` 使用 `WordCard`，元件定義於 `src/main.jsx:9100`。
- 資料夾在 `src/main.jsx:8871` 使用 `NoteCard compact`，元件定義於 `src/main.jsx:5114`。
- 日期頁在 `src/main.jsx:3944` 也使用 `NoteCard compact`。
- 詳情 modal 與測驗答案又重用非 compact 的 `NoteCard`，見 `src/main.jsx:5048` 與 `src/main.jsx:6617`。

`WordCard` 將標題與操作列拆成上下兩列，相關 CSS 位於 `src/styles.css:5372`；`NoteCard` 仍把標題與所有操作放在同一個 `.card-head`。這就是資料夾中的韓文被按鈕擠窄、單字本卻正常的直接原因。

這不是單純補一段資料夾 CSS 就能長期解決的問題。若繼續保留兩套卡片，下次新增 badge、資料夾 tag、手機排版或操作按鈕時仍會再次分歧。

### 3.2 目標設計

建立唯一的列表卡片元件 `WordCard`，並以明確 variant／slot 處理情境差異：

```jsx
<WordCard
  word={word}
  stats={stats}
  folders={folders}
  density="compact"
  actions={{
    selectable: true,
    editable: true,
    deletable: true,
    deletePolicy: 'remove-from-folder',
  }}
  metadata={['partOfSpeech', 'date', 'score']}
  onOpen={openWord}
/>
```

規則：

- 單字文字、發音按鈕、操作列、中文摘要、metadata、資料夾 tag 的 DOM 只能有一份來源。
- 頁面只能決定「顯示哪些 metadata」及「刪除代表什麼」，不能自行重寫卡片。
- 從資料夾刪除是移除 reference；從單字本刪除是永久刪除。這是 action policy 差異，不是卡片呈現差異。
- 詳情內容應使用獨立的 `WordDetails`，列表卡片不應透過 `compact` boolean 同時扮演完整詳情。
- `PracticeAnswerPanel`、學習背面與詳情 modal 應共用 `WordDetails` 的內容區塊，但可各自提供不同 toolbar。

### 3.3 統一集合頁

單字本、資料夾內容、日期內容本質上都是「某個來源範圍內的單字集合」。目前三者分別管理搜尋、分頁、多選、modal、星號、學習與測驗入口：

- `NotesPage`：`src/main.jsx:3806`
- `FolderDetailPage`：`src/main.jsx:8767`
- `NotebookPage`：`src/main.jsx:8895`

建議抽出：

```text
WordCollectionPage
├── WordCollectionToolbar
├── WordCollectionFilters
├── BulkWordActions
├── WordGrid
│   └── WordCard
├── Pagination
└── WordDialogs
```

頁面只提供 configuration：

```js
{
  source: { kind: 'all' | 'folder' | 'date', id },
  title,
  availableFilters,
  defaultSort,
  deletePolicy: 'permanent' | 'remove-membership',
  canEditCollection,
}
```

共用 hook `useWordCollection` 應負責：

- 來源篩選、搜尋 scope、熟悉度篩選、資料夾篩選與排序。
- stats join，避免每個頁面各自建立 `itemQuestionIds` 並反覆 `questions.filter(...)`。
- 分頁與篩選改變後回到第一頁。
- 多選集合、全選目前結果、清除失效 selection。
- 產生目前集合的學習 items 與測驗 questions。

頁面保留的責任只有 header、來源特有操作與 delete policy。這樣未來修改單字卡或篩選只會改一處。

### 3.4 第一階段驗收條件

- 同一筆單字在單字本、資料夾與日期頁有相同標題寬度、按鈕位置及手機換行規則。
- 卡片功能新增一次，就能在三個頁面同時出現。
- 資料夾的刪除仍只移除 reference；單字本／日期的永久刪除行為不變。
- 三個頁面的搜尋、篩選、多選、分頁及開啟詳情都有 component test。
- 用 Playwright 在 desktop 與 mobile 對三個頁面做同一筆長單字的 screenshot regression。

## 4. 學習與測驗：共用核心，不合併成萬用大元件

### 4.1 現況判斷

這部分不是每個來源各自實作整套測驗。`App.startStudy` 與 `App.startPractice` 已把不同入口導向同一頁，見 `src/main.jsx:3123`。這項集中應保留。

目前真正的風險是 `startPractice` 建立一個含許多 boolean 的鬆散物件：

- `dueOnly`
- `dailyReview`
- `grammarOnly`
- `repeatable`
- `wrongReview`
- `allowAlphabeticalOrder`
- `allowResultRecording`
- `optionalKind`
- `mode`

`PracticePage` 再依這些旗標組合決定排序、顯示、紀錄方式、完成方式與重練方式。模式增加後，很難知道哪些 boolean 組合有效。

### 4.2 目標設計

以具名 session factory 取代散落的 options：

```js
createDailyReviewSession(...)
createCollectionPracticeSession(...)
createWrongAnswerSession(...)
createOptionalPracticeSession(...)
createGrammarPracticeSession(...)
createStudySession(...)
```

每個 factory 回傳具判別欄位的 session definition：

```js
{
  kind: 'daily-word-review',
  source,
  direction: 'ko-zh',
  answerMode: 'self-grade',
  orderPolicy: 'review-kind-shuffle',
  resultPolicy: 'record-daily-review',
  retryPolicy: 'daily-wrong-pool',
  revealPolicy: 'word-details',
}
```

再拆成四層：

1. `session factories`：定義某種測驗／學習允許哪些設定。
2. `queue engine`：排序、隨機、下一題、錯題重練。
3. `result policy`：是否記錄、如何更新每日排程、如何更新自選 pool。
4. `presentation`：題面、揭曉答案、輸入或自評、語音與快捷鍵。

`StudyPage` 與 `PracticePage` 不應完全合併。兩者的互動目的不同，但可共用：

- `SessionShell`：標題、進度、返回、鍵盤事件邊界。
- `WordDetails`：答案／背面完整內容。
- `WordClassificationActions`：已學習／不熟悉 toggle。
- `AudioController`：單字、例句、中文語音及自動播放取消。
- `SessionNavigator`：上一張、下一張、索引與順序。
- `EditWordDialog`：答案揭曉後編輯單字。

### 4.3 驗收條件

- 新增一種測驗模式時，不需要在 `PracticePage` 多處加入 boolean 判斷。
- 每種 session kind 有一組純函式測試，明確驗證是否記錄、如何排序、完成後去哪裡。
- 每日測驗、自主測驗、自選練習、錯題重練的 persistence policy 不會互相誤用。
- 學習與測驗共用的單字內容及資料夾 toggle 不再各維護一份 optimistic state 邏輯。

## 5. 資料存取與 Firestore 邊界

### 5.1 現況

增量 subscription 已共用，但各功能 hook 仍同時處理：

- React loading/error state。
- 文件正規化與排序。
- Firestore path。
- validation。
- save/remove/tombstone 格式。

例子包括 `useGrammarNotes`（`src/main.jsx:624`）、`useYoutubeSubtitles`（`:723`）、`useReadingTests`（`:788`）及 `useWordFolders`（`:855`）。單字批次寫入、來源資料夾建立與刪除也仍在 `main.jsx:2020` 之後。

### 5.2 目標分層

```text
UI component
  -> feature hook / controller
    -> application service
      -> repository
        -> Firebase SDK
```

- repository：只知道 collection path、Firestore serialization、tombstone、batch／transaction。
- service：處理「新增單字並加入資料夾」「永久刪除單字並清理 folder references」這類跨文件 use case。
- feature hook：把 repository 狀態轉成畫面需要的 loading/data/error/actions。
- component：不直接 import Firebase SDK，也不組合 Firestore path。

建議 repositories：

```text
wordRepository
folderRepository
noteRepository
subtitleRepository
readingTestRepository
reviewRepository
settingsRepository
```

建議 services：

```text
wordLibraryService
folderMembershipService
reviewAnswerService
sourceWordCaptureService
offlineSyncService
```

### 5.3 資料庫注意事項

這一輪架構重構不需要更改 Firestore schema。現有「一張單字一份文件」、固定 progress shards、review day segments、`updatedAt` checkpoint 與 tombstone 應維持。

需要特別封裝的是資料夾 membership。目前 `folder.wordIds` 是 reference array，這對目前規模可接受，但所有更新都必須經過 `folderMembershipService`，避免某個頁面只更新單字、漏更新資料夾，或永久刪除後留下 stale id。

repository 應提供讀取預算測試：

- 已有 baseline 時，只接收 checkpoint 後變更。
- tombstone 能從本機集合移除資料。
- 空增量查詢不觸發全量 fallback。
- 多分頁／多裝置不會因 hook mount 重複建立全量 listener。

## 6. YT 字幕與閱讀測驗的共用文字工具

兩個功能都需要：

- 反白韓文。
- 顯示新增單字／查字典操作泡泡。
- 顯示已建立單字的 highlight 與解釋泡泡。
- 開啟快速新增單字 modal。

目前 `ReadingKoreanText`（`src/main.jsx:7337`）、`SubtitleKoreanText`（`:7850`）與兩個 reader 各自處理部分行為。應抽成：

```text
SelectableKoreanText
SelectionActionPopover
KnownWordHighlight
WordDefinitionPopover
QuickAddWordModal
useTextSelectionActions
```

來源差異透過 policy 注入：

- YT 字幕可暫停／跳轉播放器並延伸前後字幕。
- 閱讀測驗沒有播放器，但可使用文章／選項作為例句。
- 新增目的資料夾分別為 `YT字幕` 與 `閱讀測驗`。

共用選字核心後，修正「句首選字」「拖曳 selection」「popover 定位」時才不會只修到其中一頁。

## 7. 筆記、YT 字幕、閱讀題列表的 Library Pattern

這些頁面雖不是同一種 domain entity，但列表行為高度相似：

- 搜尋。
- 依 tag／category 分組及收合。
- 釘選優先。
- 隱藏已學習。
- 新增／編輯／刪除。
- 空狀態與錯誤狀態。

不應建立一個知道所有 entity 欄位的 `UniversalLibraryPage`。建議共用 layout primitives：

```text
LibraryPageShell
LibraryToolbar
CollapsibleGroup
EntityGrid
EntityCardShell
LearnedVisibilityToggle
PinButton
```

各 feature 保留自己的 card body、editor、validation 與 domain model。這能共用排列及互動，但不把不相干的資料模型硬塞成同一種型別。

## 8. App、導航與載入政策

`App` 在 `src/main.jsx:3029` 同時負責：

- 啟用／停用每個 Firestore collection。
- 全域 normalized data 與 derived data。
- page stack。
- 所有寫入 service adapter。
- 每個頁面的完整 prop 組裝。

短期不必立刻引入 React Router，但應先拆成：

```text
AppProviders
AppDataProvider
AppNavigator
RouteView
Feature routes
```

中期可使用 route registry 或 React Router，讓 feature page 能 lazy load。現在所有功能都在同一個 `main.jsx`，使用者即使只開首頁也必須下載並解析字幕 reader、閱讀測驗 editor 與所有 modal。

目標：

- `main.jsx` 只保留 bootstrap，約數十行。
- 頁面載入政策由 route 定義，不用在 `App` 寫多個 `page === ...`。
- 導航 stack 的上一層語意有單一來源。
- feature 可以 route-level lazy import，降低初始 bundle。

## 9. CSS 與響應式設計

目前同一元件 selector 分布在基礎區、功能區與多個 media query。例如 `.word-card` 同時出現在 `src/styles.css:455`、`:2763`、`:5372`，手機答案卡又有額外覆寫。這使得 CSS 修正很容易只對某一頁或某一 viewport 生效。

建議：

- 保留全域 design tokens、reset、button/input primitives。
- 每個 feature 將 CSS 與元件放在同一資料夾，或至少拆成獨立 stylesheet。
- `WordCard` 只允許一個基礎 style owner；variant 使用 modifier class，不由頁面祖先 selector 重寫結構。
- 建立 `Stack`、`Inline`、`Toolbar`、`Grid` 等少量 layout primitives，減少每頁重新定義 flex/grid。
- 避免 `page .component` 深層 selector；元件應由自己的 class 決定版面。
- 對 360px、390px、desktop 建立視覺回歸，特別測試長韓文、所有 action 同時存在、字體放大 105% 以上。

## 10. Terminal 模組化與 Web 行為一致性

`terminal_review_practice.py` 同時包含：

- Firebase REST client 與登入。
- cache／incremental sync／offline merge。
- Web schema 解析。
- SRS、熟悉度、自選練習與錯題規則。
- TTS、YouTube 音訊。
- curses primitives 與所有畫面流程。

建議逐步拆成 Python package：

```text
terminal_app/
├── api/firebase_client.py
├── sync/cache.py
├── sync/offline.py
├── domain/models.py
├── domain/review.py
├── domain/practice.py
├── audio/tts.py
├── audio/youtube.py
├── ui/primitives.py
├── ui/screens/study.py
├── ui/screens/practice.py
├── ui/screens/notebook.py
├── ui/screens/folders.py
└── app.py
```

JS 與 Python 無法直接共用 runtime code，因此必須共用「資料合約與 fixture」：

- 同一組 JSON records/progress/attempts fixture。
- JS 與 Python 都跑熟悉分數、到期日、錯題 pool、資料夾排除測試。
- schema/version constants 與 review intervals 由一份 versioned JSON contract 產生或至少交叉驗證。
- 新增規則時，Definition of Done 必須包含 Web 與 Terminal parity test。

## 11. 測試架構

目前 `tests/import-flow.test.mjs` 有 1,308 行，並透過 Vite SSR 載入整個 `src/main.jsx` 才取得純函式。`main.jsx` 底部也因此 export 大量不屬於 app entry 的 helper（`src/main.jsx:9120`）。這是模組邊界不清楚的直接訊號。

建議測試層次：

1. 純 domain unit tests：直接 import `words/model.js`、`review-engine/...`，不啟動 React/Firebase。
2. component tests：`WordCard`、`WordDetails`、filters、session controls。
3. integration tests：WordCollection 的 Notebook／Folder／Date configuration。
4. Firestore Emulator tests：repository、tombstone、offline merge、多 client concurrency、read budget。
5. Playwright E2E／screenshots：核心手機流程與跨頁一致性。

測試檔應依 feature 拆分，不再把 import、review、folder、subtitle 等規則集中在單一測試檔。

## 12. 建議目錄

以下是目標方向，不要求一次全部建立：

```text
src/
├── app/
│   ├── App.jsx
│   ├── AppDataProvider.jsx
│   └── navigation.js
├── components/
│   ├── actions/
│   ├── layout/
│   └── modal/
├── domain/
│   ├── words/
│   ├── folders/
│   ├── review/
│   ├── notes/
│   ├── subtitles/
│   └── reading/
├── data/
│   ├── repositories/
│   └── services/
├── features/
│   ├── word-library/
│   │   ├── components/WordCard.jsx
│   │   ├── components/WordDetails.jsx
│   │   ├── components/WordGrid.jsx
│   │   ├── hooks/useWordCollection.js
│   │   └── pages/
│   ├── sessions/
│   │   ├── core/
│   │   ├── study/
│   │   └── practice/
│   ├── notes/
│   ├── subtitles/
│   └── reading/
└── main.jsx
```

## 13. 分階段重構計畫

### Phase 0：保護現有行為

- 為單字本、資料夾、日期頁建立同資料 fixture 與 screenshots。
- 為各種 session kind 建立 characterization tests。
- 記錄目前 Firestore collections 與每個核心流程的大致 read/write budget。
- 不改 UI、不改 DB schema。

### Phase 1：統一單字呈現

**狀態：已完成（2026-09-16）**

- [x] 抽出 `WordCard`、`WordDetails`、`WordCardActions`、`WordMetadata`。
- [x] 資料夾、單字本與日期頁共用同一個 `WordCard`。
- [x] 詳情 modal、測驗答案與學習背面共用 `WordDetails`。
- [x] 刪除舊 `NoteCard compact` 路徑及對應 CSS。
- [x] 通用編輯、星號與發音按鈕放入共用 actions 層，避免其他 feature 依賴單字模組。
- [x] 新增組件特性測試，並完成桌面與手機版視覺驗證。

這一階段直接解決使用者目前看到的排版不一致。

### Phase 2：統一單字集合控制器

- 抽出 selectors、stats join、filter/sort/pagination。
- 抽出 selection、bulk actions 與 word dialogs controller。
- Notebook、Folder、Date 依序改用 `WordCollectionPage` configuration。
- 每遷移一頁就刪除原頁重複 state，不保留雙軌。

### Phase 3：整理學習／測驗 session

- 先建立 session factories 與具名 policy，不改 UI。
- 將 queue、result、retry、audio controller 從 `PracticePage`／`StudyPage` 抽出。
- 共用 `WordDetails`、分類按鈕、編輯 modal 與導航元件。
- 最後移除舊 boolean branches。

### Phase 4：資料層與 App 拆分

- 將 CRUD 移到 repositories/services。
- 將 collection hook 改為共用 adapter pattern。
- 拆 `AppDataProvider` 與導航。
- 將 feature pages 從 `main.jsx` 移出並 lazy load。

### Phase 5：內容工具與 Terminal

- 共用 YT／閱讀的 selectable text 工具。
- 共用 Library layout primitives。
- 拆分 Terminal package，加入 Web／Terminal contract fixtures。

## 14. 重構工作規則

後續每個 PR／commit 應遵守：

1. 一次只遷移一個 ownership boundary，不同時改資料 schema、UI 與規則。
2. 搬移前先寫 characterization test，搬移後確認輸出相同。
3. 共用元件以實際重複需求為依據，不建立含數十個 boolean props 的萬用元件。
4. 頁面負責組合與 policy；domain 負責規則；repository 負責 persistence；元件負責呈現。
5. 同一個 domain entity 的列表卡片只能有一個 canonical component。
6. 所有測驗入口只能建立 session definition，不得自行實作答題循環。
7. 所有 Firestore 存取只能經 repository/service，不得從頁面直接新增 Firebase SDK 呼叫。
8. Web 與 Terminal 的共用規則必須有同 fixture parity tests。
9. 共用行為修正完成後，要刪掉舊實作，不長期保留兩套。
10. 每階段都執行 unit tests、build、mobile/desktop screenshot 與 Firestore read/write 檢查。

## 15. 避免過度重構

以下做法不建議：

- 不要一次重寫 9,000 行 `main.jsx`。
- 不要為了「共用」把單字、筆記、字幕、閱讀題硬塞成同一個資料模型。
- 不要把學習與測驗合併成另一個更大的 conditional component。
- 不要在 UI 重構期間改 Firestore schema；若未來需要更改，應是獨立 migration 專案。
- 不要只搬檔案但保留原本互相 import 的責任，檔案變多不等於模組化。
- 不要先建立抽象框架再尋找用途；先以 Notebook／Folder／Date 的真實重複流程定義介面。

## 16. 優先順序摘要

| 優先度 | 工作 | 原因 |
| --- | --- | --- |
| P0 | 統一 `WordCard`／`WordDetails` | 已造成可見 bug，收益立即且範圍可控 |
| P0 | 建立跨頁卡片視覺與互動測試 | 防止同類問題再次發生 |
| P1 | `WordCollectionPage` + `useWordCollection` | 移除 Notebook／Folder／Date 大量重複 |
| P1 | session factories + result policies | 控制測驗模式組合複雜度 |
| P1 | repository/service 邊界 | 降低 Firestore 與 UI 耦合、便於讀寫預算測試 |
| P2 | 拆分 `main.jsx` 與 feature CSS | 改善維護、bundle 與衝突 |
| P2 | 共用字幕／閱讀選字工具 | 避免互動修正只套用一邊 |
| P2 | Terminal package 與 parity fixtures | 避免 Web／Terminal 規則漂移 |
| P3 | route lazy loading、完整 Library primitives | 在核心邊界穩定後再做 |

最合理的第一個實作任務是：建立 canonical `WordCard`，讓 Notebook、Folder、Date 使用同一元件，同時保留各自 delete policy。完成後再抽 `WordCollectionPage`，而不是反過來先建立一個尚未驗證的通用頁面框架。
