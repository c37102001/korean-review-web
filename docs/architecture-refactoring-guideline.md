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

**狀態：已完成（2026-09-16）**

- [x] 抽出 selectors、一次性 stats join、filter／sort／pagination。
- [x] 抽出 selection hook、bulk actions、filters 與 word dialogs controller。
- [x] Notebook、Folder、Date 改用同一個 `useWordCollection` 與 `WordCollectionView`，只保留來源及刪除 policy 差異。
- [x] 刪除三頁原有的重複集合 state、逐字掃描 questions、卡片 grid 與分頁實作，不保留雙軌。
- [x] 新增集合 selector 的組合測試，並以手機／桌面瀏覽器驗證三個入口。

### Phase 3：整理學習／測驗 session

**狀態：已完成（2026-09-16）**

- [x] 建立 daily review、collection、wrong answer、optional、grammar、fixed word 與 study session factories。
- [x] 以具名 order／result／retry／reveal policy 取代 `PracticePage` 內的舊 boolean 組合。
- [x] 將選題、queue 排序、錯題重練與 persistence decision 搬到可直接測試的 session model。
- [x] 將學習語音序列與 wake lock lifecycle 搬出 `StudyPage`。
- [x] 學習與測驗共用 `WordDetails`、`useWordClassification`、`WordFolderButtons` 與單字編輯 dialog。
- [x] 為各 session kind 補上排序、紀錄、重試及完成 callback 的純函式測試。

頁面目前只依 session 的語意 view／policy 呈現，不再直接解讀 `dueOnly`、`dailyReview`、`wrongReview`、`optionalKind` 等啟動旗標。新增模式時應新增 factory 與 policy 測試，不得重新把模式判斷散回 `PracticePage`。

### Phase 4：資料層與 App 拆分

**狀態：已完成（2026-09-16）**

- [x] 建立 user content、folder 與 Firestore write repositories，將筆記、字幕、閱讀題與資料夾 CRUD 移出 UI。
- [x] 建立 `wordLibraryService`，集中單字批次寫入、來源資料夾指派與永久刪除時的 reference 清理。
- [x] 四個 collection hook 改為 repository adapter，不再 import Firebase SDK 或組合 Firestore path。
- [x] 建立 `AppDataProvider`、route data policy、可測試的 navigation stack 與 `AppShell`。
- [x] 筆記、YT 字幕列表與閱讀測驗列表移出 `main.jsx`，透過 `React.lazy` 產生獨立 route chunks。
- [x] 共用的語音、ActionMenu、剪貼簿、時間格式與 JSON parser 各自移到單一 owner，lazy routes 不反向依賴 app entry。
- [x] 補上 route collection policy、逐層返回與 feature hook repository boundary 測試。

Firestore schema、collection 名稱、增量 checkpoint、tombstone 與離線寫入策略均未更動。後續 feature 不得把 Firebase SDK 呼叫放回 page component；新增 collection 時應先建立 repository，再由 hook 對 UI 提供 actions。

### Phase 5：內容工具與 Terminal

**狀態：已完成（2026-09-16）**

- [x] YT／閱讀共用 `SelectableKoreanText`、selection lifecycle hook、操作泡泡、單字解釋泡泡與快速新增 modal；來源頁只注入影片暫停、畫線及目的資料夾 policy。
- [x] 筆記、YT 字幕與閱讀題共用 `LibraryPageShell`、`CollapsibleGroup`、`EntityGrid`、`EntityCardShell`、`LearnedVisibilityToggle` 與 `PinButton`，保留各 feature 的 editor、validation 與 card body。
- [x] 建立 `terminal_app` package，將 models、複習規則、自選練習、Firestore codec、cache、TTS adapter 與 curses 文字寬度 primitive 移出入口檔；`terminal_review_practice.py` 保留 CLI orchestration 與舊 import API 相容性。
- [x] 建立 `contracts/review-rules-v1.json`，由 Web 與 Terminal 各自跑同一份熟悉分數、負分排程、錯題 pool、已學習排除及 review intervals parity tests。
- [x] 新增 ownership boundary tests，防止 YT／閱讀重新建立第二套 selection listener，或 Library 頁退回各自維護版型。

Terminal 後續新增領域規則時必須放入 `terminal_app/domain` 並擴充共用 contract；CLI 畫面流程可再按功能逐步移入 `terminal_app/ui/screens`，不得為了搬檔而一次改寫 curses 導航行為。

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

Phase 0～5 已完成。後續工作不再重做上述元件，而是依下一節的 Phase 6～14 繼續縮小 Web 與 Terminal 入口檔，最後建立可持續執行的架構邊界檢查。

## 17. Phase 5 後的剩餘技術債盤點

> 盤點基準：2026-09-16，commit `1786029`

### 17.1 Web

`src/main.jsx` 已從最初的 9,198 行降至 5,769 行，但仍同時擁有下列責任：

| 行數區域 | 責任 | 建議 owner |
| --- | --- | --- |
| 約 239～722 | YouTube API loader、登入、離線狀態、Firestore store adapter | `app/hooks`、`features/auth`、repositories |
| 約 723～1,246 | 單字 JSON validation、import draft、衝突處理、單字 JSON 編輯 | `features/word-import` |
| 約 1,247～1,699 | stats、到期選題、錯題 pool、每日 round、作答寫入與文字比對 | `review-engine` |
| 約 1,810～2,492 | App composition、登入、首頁、語音設定、自選練習 modal | `app`、`features/home`、`features/auth` |
| 約 2,493～3,568 | 日曆、日期單字、單字新增／匯入／編輯、詳情 modal | `features/calendar`、`features/word-editor` |
| 約 3,585～4,680 | `StudyPage`、`PracticePage` 及結果元件 | `features/sessions` |
| 約 4,710～5,211 | JSON dialogs、閱讀 reader、YT reader | 對應 feature pages/components |
| 約 5,212～5,769 | 資料夾與單字本 pages | `features/folders`、`features/word-library` |

其他明顯問題：

- `tests/import-flow.test.mjs` 仍透過 Vite SSR 載入整個 `main.jsx` 取得純函式，代表 import domain 尚未有獨立 owner。
- `src/styles.css` 仍有 6,712 行與 8 個分散的 responsive 區段，feature ownership 不清楚。
- production 主 chunk 約 1.16 MB；lazy routes 已開始生效，但 Study、Practice、Word Editor、readers 仍進入主 chunk。
- `main.jsx` 底部仍 export 大量 helper 供測試使用，entry point 尚未回到單純 bootstrap。

### 17.2 Terminal

`terminal_review_practice.py` 已從 5,610 行降至 5,346 行，但仍包含：

- 約 550 行的 `FirebaseClient`，混合 REST transport、authentication、repository、離線 journal 與 review persistence。
- 約 800 行的 record hydration、review selectors、排程與搜尋規則。
- 約 270 行的 TTS、YouTube download 與 audio player lifecycle。
- 約 320 行的 curses drawing、輸入、menu 與 prompt primitives。
- 約 2,800 行的 notes、subtitles、study、practice、folders、calendar screens 與主導航。

目前 `terminal_app` 已有可用的 package 基礎，但 Terminal 測試仍主要 import `terminal_review_practice` facade。若不繼續拆分，後續新增畫面仍會回到主程式。

## 18. 最終目標與依賴規則

### 18.1 Web 目標

```text
main.jsx (bootstrap only)
  -> app/App.jsx + providers + route registry
    -> feature pages/controllers
      -> application services
        -> repositories
          -> Firebase SDK

feature UI -> feature domain / shared UI
domain     -> shared pure utilities only
repository -> Firebase adapter only
```

硬性規則：

1. `src/main.jsx` 最終不超過 80 行，只能掛載 React root、global CSS 與 `App`。
2. feature、service、repository、test 都不得 import `main.jsx`。
3. domain/model 不得 import React、Firebase、DOM API 或 feature page。
4. page 不得直接 import Firebase SDK、組 Firestore path 或自行處理 batch writes。
5. 共用元件不得 import 某個 feature page；feature 可以依賴 shared，shared 不得反向依賴 feature。
6. 單一 React page/controller 原則上不超過 350 行；超過時必須說明其 state ownership 為何不可再拆。

### 18.2 Terminal 目標

```text
terminal_review_practice.py (compatibility entry)
  -> terminal_app/app.py
    -> ui/screens + controllers
      -> application services
        -> domain / sync / api / audio
```

硬性規則：

1. `terminal_review_practice.py` 最終不超過 100 行，只保留相容 imports 與 `main()`。
2. `terminal_app/domain` 不得 import curses、network、filesystem、subprocess 或 UI。
3. `terminal_app/api` 不得知道 curses screen 或 menu；REST transport 必須可注入 fake transport。
4. `terminal_app/ui/screens` 不得直接組 Firestore payload，僅呼叫 application service。
5. screen 返回值要明確表示 `BACK`、`COMPLETE`、`LOGOUT`，不得靠多層 function return 意外跳過導航層級。
6. Web／Terminal 共用規則變更必須先擴充 `contracts/` fixture，再各自實作。

## 19. 後續分階段實作計畫

每一階段必須獨立完成、驗證並 commit，不把多個 ownership boundary 混在同一個 commit。以下行數是方向性上限，不應為了達標而製造無意義的小檔案。

### Phase 6：單字匯入與編輯 domain

**狀態：已完成（2026-09-16）**

目標目錄：

```text
src/features/word-import/
├── model/validation.js
├── model/draft.js
├── model/conflicts.js
├── model/editJson.js
├── components/ImportReviewPanel.jsx
├── components/ImportConflictResolver.jsx
├── components/ImportProgressPanel.jsx
└── components/WordImportForm.jsx
```

工作：

- 將 JSON validation、draft、related resolution、duplicate conflict、merge／replace 與 single-word JSON edit 從 `main.jsx` 移出。
- 將 `AddItemsForm` 拆成 controller、手動表單與 JSON import flow；共用儲存介面仍由 `wordLibraryService` 提供。
- `tests/import-flow.test.mjs` 改為直接 import domain modules，不再 SSR load `main.jsx`。
- 保留 schema v2、匯入順序、既有 id、衝突視窗與錯誤訊息，不改 Firestore 格式。

驗收：

- import domain 測試不啟動 Vite、React 或 Firebase。
- 新增、取代、合併、取消、重試與 JSON 編輯的既有 fixture 全數通過。
- `main.jsx` 不再包含 import validation／conflict 純函式。

建議 commit：`refactor word import and editor modules`

### Phase 7：複習引擎完整抽離

**狀態：已完成（2026-09-16）**

目標目錄：

```text
src/review-engine/
├── rules.js
├── selectors.js
├── schedules.js
├── answers.js
├── rounds.js
└── textComparison.js
```

工作：

- 搬移 `getStats`、`getProgress`、due selectors、最低熟悉度選題、每日錯題與 streak 計算。
- 搬移 daily round／recognition／grammar schedule 與 replay attempt 規則。
- 搬移 answer reducers、文字正規化、韓文字數與 diff comparison。
- UI 不直接 mutate store；所有作答都經 named reducer／result policy。
- 擴充 versioned contract，覆蓋 due date、round rollover、learned exclusion、wrong review 與 flame completion。

驗收：

- review-engine 可在 Node 中直接測試，不 import React、Firebase 或 `main.jsx`。
- Web／Terminal 對 contract fixture 的結果完全一致。
- 每日複習與 optional practice 的 persistence policy 測試保持隔離。

建議 commit：`refactor review engine boundaries`

### Phase 8：Web feature pages 與 App composition

**狀態：已完成（2026-09-16）**

工作順序：

1. 搬移 `ReadingTestPage`、`YoutubeSubtitleReader` 到各自 feature route，讓列表與 reader 同屬一個 feature。
2. 搬移 `HomePage`、`CalendarPage`、日期單字 page、Folders pages、Notebook page。
3. 搬移 `LoginPage`、`VoiceSettingsModal`、offline status 與 auth/offline hooks。
4. 將 `AppWorkspace` 改成 route registry 組裝，不手動傳遞所有 feature props。
5. 建立 `src/app/App.jsx`，`main.jsx` 只保留 bootstrap。

頁面只能取得 feature controller 提供的 view model/actions，不得重新建立資料 join 或 persistence 邏輯。

驗收：

- 各 route 可以 lazy import，首頁不載入 YT player、reading editor 或 folder editor。
- navigation stack、返回上一層與 collection enable policy 測試維持通過。
- `main.jsx` 降至 1,500 行以下；剩餘內容只應是尚未搬移的 sessions 與少量相容 export。

建議 commit：`refactor app routes and feature pages`

### Phase 9：Study／Practice controllers 與 UI 拆分

**狀態：已完成（2026-09-16）**

目標：

```text
src/features/sessions/
├── core/
├── study/
│   ├── StudyPage.jsx
│   ├── useStudyController.js
│   ├── useStudyKeyboard.js
│   └── useStudyAudio.js
└── practice/
    ├── PracticePage.jsx
    ├── usePracticeController.js
    ├── usePracticeKeyboard.js
    ├── PracticePrompt.jsx
    ├── PracticeAnswerPanel.jsx
    ├── PracticeDecisionBar.jsx
    └── PracticeResult.jsx
```

工作：

- controller 負責 session state machine；component 只呈現 view model。
- keyboard、touch、scroll、audio、wake lock 各有單一 hook owner，並在 modal/input focus 時停用快捷鍵。
- `StudyPage` 與 `PracticePage` 保持不同流程，不合併成萬用 conditional component。
- 共用 `SessionShell`、`SessionNavigator`、`WordDetails`、classification actions 與 edit dialog。

驗收：

- 每個 session kind 可用純 controller test 驗證完整生命週期。
- 手機 double tap、固定卡片高度、語音取消、錯題重練與每日寫入行為不變。
- `main.jsx` 不超過 80 行，tests 不再 import entry helpers。

建議 commit：`refactor study and practice controllers`

### Phase 10：Terminal API 與同步邊界

**狀態：已完成（2026-09-16）**

目標目錄：

```text
terminal_app/
├── api/auth.py
├── api/firestore_client.py
├── api/transport.py
├── repositories/
│   ├── words.py
│   ├── folders.py
│   ├── review.py
│   └── content.py
└── sync/
    ├── cache.py
    ├── incremental.py
    ├── journal.py
    └── service.py
```

工作：

- 拆分 `FirebaseClient`：HTTP transport、token refresh、Firestore paths、repositories、offline synchronization 分離。
- `load_data`／incremental load／hydrate 移入 sync service；normalization 移入 domain serializers。
- offline journal merge 保持 atomic、idempotent，quota fallback 不可觸發隱性全量讀取。
- repository methods 回傳 domain data，不把 Firestore REST value 暴露給 screens。

驗收：

- API/repository 測試使用 fake transport，不 monkeypatch 巨型 `FirebaseClient`。
- 有 cache 時只執行 checkpoint 後增量查詢；429 fallback 完全不存取網路。
- 同一作答、folder toggle、optional task 不產生額外全量 reads。

建議 commit：`refactor terminal api and sync services`

### Phase 11：Terminal domain 與 audio 完整抽離

**狀態：已完成（2026-09-16）**

工作：

- 搬移 record／grammar／subtitle normalization、搜尋、filter、排序與 folder selectors。
- 搬移 daily due、wrong review、grammar、recognition round 與 answer reducers；共用 contract parity tests。
- 將 TTS cache、player、YouTube downloader、audio lifecycle 分至 `audio/tts.py` 與 `audio/youtube.py`。
- 下載器與播放器使用 adapter，screen 不直接呼叫 `subprocess`。

驗收：

- `terminal_app/domain` 全部是 deterministic pure functions。
- domain tests 不初始化 curses、網路、音訊或 home cache。
- audio adapter 可用 fake command runner 測試 403 fallback、seek、pause 與 cleanup。

建議 commit：`refactor terminal domain and audio adapters`

### Phase 12：Terminal screens 與導航

**狀態：已完成**

目標目錄：

```text
terminal_app/ui/
├── primitives.py
├── navigation.py
├── controllers/
└── screens/
    ├── home.py
    ├── study.py
    ├── practice.py
    ├── notebook.py
    ├── folders.py
    ├── notes.py
    └── subtitles.py
```

工作：

- 先完整搬移 drawing/menu/input primitives，再按 screen 一個一個搬移。
- 導航改用明確 stack/result，不讓單一 `Esc` 跳過多層。
- Study／Practice 共用 answer details、scroll model、audio controls 與 classification commands。
- `terminal_app/app.py` 負責依賴注入和主 loop；舊 script 僅作 compatibility entry。

驗收：

- 每個 screen 可使用 fake window、fake service 測試 Esc、上下捲動與完成 callback。
- `terminal_review_practice.py` 不超過 100 行。
- 現有啟動指令與 `--offline`、`--sync` 介面不變。

建議 commit：`refactor terminal screens and navigation`

實際結果：

- `terminal_app/app.py` 成為應用組裝與主 loop 的唯一 owner，舊 script 縮為相容入口。
- 新增明確的 `NavigationStack`／`ScreenResult`，確保返回動作一次只退一層。
- 新增共用 `ScrollModel` 與 screen protocol，讓畫面互動可脫離 curses 測試。
- 保留既有啟動方式、`--offline`、`--sync` 與歷史 import/monkeypatch 相容性。

### Phase 13：CSS ownership、bundle 與視覺回歸

**狀態：已完成**

工作：

- 保留 `tokens.css`、`base.css`、`forms.css`、`layout.css`，其餘樣式移到 feature stylesheet。
- 合併重複 media queries；元件只由自己的 class/modifier 控制，不依賴深層 page ancestor override。
- 對 WordCard、Study、Practice、YT reader、Library pages 建立 360px／390px／desktop screenshot baselines。
- 分析 bundle，將 sessions、word editor 與 media readers route-level lazy load。

驗收：

- 不再有同一 canonical component 的基礎 selector 散落於多個 feature 區段。
- 主要手機流程無文字擠壓、橫向 overflow 或控制項重疊。
- 初始主 chunk 有明確預算；建議壓縮後低於 200 KB，超過必須在 PR 說明原因。

建議 commit：`refactor feature styles and route bundles`

實際結果：

- 將單一 stylesheet 依序拆為 tokens、base、layout、content libraries、sessions、forms 與 responsive owners。
- 保留原有 cascade 順序，feature 樣式不再與全域 reset 存在同一檔案。
- React、Firebase、icons 與 Markdown 改為穩定 vendor chunks，既有大型頁面維持 lazy load。
- build 新增 200 KiB gzip 初始 entry 預算檢查，超標會直接失敗。

### Phase 14：架構守門與 CI

**狀態：已完成**

工作：

- 新增 dependency boundary tests：禁止 feature/import entry、domain/import Firebase、Terminal domain/import curses。
- 新增 file-size report；超過上限先警告，穩定後改為 CI failure。
- 建立 Firestore Emulator integration suite：增量同步、tombstone、多 client、offline merge、read/write budget。
- 建立不連 production Firebase 的 authenticated Playwright fixture，跑核心桌面／手機流程。
- 將 Web tests、Python tests、build、emulator tests、E2E 分層執行並輸出清楚失敗範圍。

驗收：

- 新功能若破壞依賴方向，CI 在 merge 前直接阻止。
- 測試不使用 production account，不消耗正式 Firestore quota。
- README 說明如何執行每一層測試與新增 feature 的標準位置。

建議 commit：`add architecture and integration guardrails`

實際結果：

- dependency boundary tests 會阻止 feature 回頭依賴 entry、domain 依賴 Firebase，以及 Terminal domain 依賴 curses/API。
- entry 行數成為硬性限制；大型 owner 先以 CI annotation 警告並持續追蹤。
- Emulator suite 新增穩態增量讀取預算與多 client merge，所有 fixture 使用獨立測試 project。
- CI 分開呈現 Web、Terminal、architecture、Emulator 與 build 的失敗範圍，部署不接觸測試帳號。

## 20. 後續收尾計畫（Phase 15～18）

Phase 1～14 已完成資料層、domain、共用元件、entry、bundle 與 CI 的主要邊界；但目前仍有三個大型 owner，且視覺回歸尚未真正自動化。以下階段是這輪架構重構的收尾工作，不應以「把原檔整份搬到另一個檔案」取代責任拆分。

### Phase 15：Web App orchestration 完整拆分

**狀態：已完成（2026-09-16）**

目前問題：

- `src/app/App.jsx` 約 2,400 行，仍同時負責 authentication、offline lifecycle、資料組裝、頁面 routing、modal state 與大量 mutation callbacks。
- feature page 雖已抽離一部分，仍有不少頁面與對話框只能透過 App 的大量 props 運作。
- 修改單一流程時仍可能影響其他不相關頁面，且 App 很難用小型 fixture 測試。

目標結構：

```text
src/app/
├── App.jsx
├── AppRouter.jsx
├── AppProviders.jsx
├── controllers/
│   ├── useAuthController.js
│   ├── useOfflineController.js
│   └── useDialogController.js
└── pages/
    ├── HomePage.jsx
    └── CalendarPage.jsx

src/features/
├── word-library/pages/
├── folders/pages/
└── word-import/dialogs/
```

工作：

- `App.jsx` 只保留 provider composition、route selection 與全域 error boundary。
- authentication、speech preferences、offline preparation/sync 各自移入 controller/provider。
- 首頁、日曆、單字本、資料夾及其 detail page 由 feature 擁有，不在 App 內宣告大型 page component。
- 新增／編輯／匯入／刪除 modal 移到對應 feature，由 typed dialog state 或明確 action 開啟。
- mutation callback 優先呼叫 service/repository command，避免 UI 組裝 Firestore payload。
- 刪除所有搬移後的舊 implementation，不保留 re-export 以外的雙軌版本。

驗收：

- `src/app/App.jsx` <= 500 行，且不直接 import `firebase/auth` 或 `firebase/firestore`。
- App 不包含超過 80 行的 page/modal component。
- feature pages 可用 fake controller/repository render，不需初始化 Firebase。
- 現有 navigation、離線模式、登入與所有 modal 行為維持不變。
- architecture test 阻止 App 再次直接取得 Firestore SDK。

建議 commit：`refactor web app orchestration`

實際結果：

- `App.jsx` 由 2,437 行降至 365 行，只保留登入 gate、provider、navigation composition 與既有測試 helper exports。
- Firebase/auth/offline/store lifecycle 集中於 `AppRuntime.jsx`；`App.jsx` 與頁面 owners 不再直接 import Firebase SDK。
- workspace route composition、登入／語音／自選練習 dialogs、首頁／日曆，以及單字本／資料夾頁面已分成獨立 owners。
- architecture test 將 App 500 行與禁止 Firebase SDK 依賴設為硬性門檻。
- Web tests、Terminal tests、production build 與 200 KiB entry budget 全部通過。

### Phase 16：Terminal screens 真正拆分

**狀態：已完成（2026-09-16）**

實作結果：

- `terminal_app/app.py` 由約 4,874 行縮減為不到 300 行，只保留 CLI、登入、依賴組裝與 top-level loop。
- Firebase/cache/domain 共用執行環境移至 `terminal_app/runtime.py`；curses primitives 移至 `terminal_app/ui/curses_helpers.py`。
- notes、subtitles、reading、optional practice、session setup、grammar、recognition、practice session、study、library 已拆成獨立 screen owner，個別檔案均低於 700 行。
- `terminal_review_practice.py` 的歷史 import 與 monkeypatch 介面由 compatibility module forwarding 保留，`--offline`、`--sync` 介面不變。
- 架構測試會拒絕超過 600 行的 `terminal_app/app.py`、超過 700 行的 screen，以及 screen 直接匯入 HTTP、subprocess 或 repository。

目前問題：

- `terminal_review_practice.py` 已是小型相容入口，但 `terminal_app/app.py` 仍約 4,600 行。
- Phase 12 建立了 navigation contract、screen protocol 與 scroll model，但大多數 curses 畫面尚未搬入 `terminal_app/ui/screens/`。
- screen、domain command、audio lifecycle 與 repository 呼叫仍可能在同一函式中交錯。

目標結構：

```text
terminal_app/
├── app.py
├── services.py
└── ui/
    ├── navigation.py
    ├── primitives.py
    ├── controllers/
    │   ├── answer_details.py
    │   ├── audio_controls.py
    │   └── classification.py
    └── screens/
        ├── home.py
        ├── calendar.py
        ├── notebook.py
        ├── folders.py
        ├── study.py
        ├── practice.py
        ├── notes.py
        └── subtitles.py
```

工作：

- 依序搬移 home、collection menus、study、practice、notes、subtitles，每次只移動一個可驗證流程。
- screen 只接收 application service/domain data，不直接知道 REST payload、cache path 或 subprocess。
- Study／Practice 共用 answer details、scroll、audio 與 classification controllers。
- 所有 screen 以 `ScreenResult` 回傳 push/back/complete/exit，不以巢狀函式直接跳轉多層。
- `terminal_app/app.py` 最終只負責 CLI parsing、dependency injection、login 與 top-level loop。
- compatibility entry 的 import/monkeypatch 行為及既有 `--offline`、`--sync` 介面不得改變。

驗收：

- `terminal_app/app.py` <= 600 行；個別 screen 建議 <= 700 行。
- 每個 screen 都有 fake window、fake service 測試 Esc、上下移動／捲動、完成 callback 與錯誤狀態。
- domain、repository 與 audio tests 不 import curses；screen tests 不連網、不播放實際音訊。
- Terminal 全套測試及 Web／Terminal review contract parity tests 通過。
- file-size report 對 `terminal_app/app.py` 的限制由 warning 改成 failure。

建議 commit：`extract terminal screen modules`

### Phase 17：Session UI 分拆與共用互動元件

**狀態：待實作**

目前問題：

- `src/features/sessions/SessionPages.jsx` 約 1,200 行，Study 與 Practice 雖已有 feature owner，仍集中在同一大型檔案。
- 卡片導航、語音、答案詳情、分類按鈕與結果檢討存在高度相似的 UI lifecycle。

目標結構：

```text
src/features/sessions/
├── shared/
│   ├── SessionToolbar.jsx
│   ├── SessionWordDetails.jsx
│   ├── ClassificationActions.jsx
│   ├── useSessionAudio.js
│   └── useCardNavigation.js
├── study/
│   ├── StudyPage.jsx
│   ├── StudyCard.jsx
│   └── useStudyController.js
└── practice/
    ├── PracticePage.jsx
    ├── PracticePrompt.jsx
    ├── AnswerPanel.jsx
    ├── MistakeReview.jsx
    └── usePracticeController.js
```

工作：

- Study 與 Practice 維持不同 controller，不以大量 boolean props 合併成一個萬用頁面。
- 抽取真正共享的 presentation 與 interaction hooks；SRS 寫入仍由 session policy 決定。
- 語音取消、wake lock、鍵盤操作、mobile double-tap 與 scroll behavior 都由單一 hook/owner 管理。
- 錯題檢討、重練與完成畫面拆成可獨立測試元件。

驗收：

- 不再存在 `SessionPages.jsx` 聚合實作；入口檔只允許小型 exports。
- Study/Practice page 各 <= 500 行，共用元件不依賴具體 session kind 的隱性條件。
- 每個 keyboard/touch/audio action 都有 controller test，daily 與 optional persistence policy 維持隔離。
- file-size report 對 session page 上限改成 failure。

建議 commit：`split study and practice session ui`

### Phase 18：CSS ownership 與自動化視覺回歸收尾

**狀態：待實作**

目前問題：

- CSS 已依區域拆檔，但主要是保留原 cascade 的結構性拆分，仍需確認 selector 是否由正確 feature 擁有。
- responsive rules 仍集中於 `responsive.css`，同一元件的 desktop/mobile 規則可能分散。
- 尚未建立可重現的 Playwright authenticated fixture 與 screenshot baselines。

工作：

- 將 responsive rules 移回其元件／feature stylesheet，合併重複 media queries。
- 清除深層 page ancestor override；canonical component 只由自身 class、variant 或 data attribute 控制。
- 建立完全不連 production Firebase 的 fixture，以 repository fakes 提供固定單字、資料夾、筆記、字幕及測驗資料。
- 建立 360px、390px、desktop baselines：WordCard、單字本、資料夾、Study、Practice、YT reader、筆記與閱讀測驗。
- 加入 overflow、按鈕重疊、文字截斷與核心互動 assertions，不只比較 screenshot。
- 視覺測試獨立成 CI job，失敗時上傳 diff artifacts。

驗收：

- 同一 canonical component 的基礎 selector 只存在於一個 owner stylesheet。
- 360px 與 390px 無非預期水平 overflow、控制項重疊或韓文單字被 action icons 擠成直排。
- Playwright fixture 不含 production API key/account，不產生任何 Firestore quota。
- screenshot baselines 可在 CI 穩定重現，差異會阻止 merge。
- 本機具備 Java 時完整跑過 Emulator suite，並確認 CI 的 Emulator 與 visual jobs 均成功。

建議 commit：`add visual regression and css ownership`

## 21. 後續階段執行原則

1. 先為待搬流程增加 characterization test，再搬 owner；不可先刪除後憑印象重寫。
2. 大型檔案減少的行數必須在同一 commit 中可追蹤到新 owner，不能以移除功能換取行數。
3. 每個 Phase 完成後獨立 non-amend commit，並記錄實際行數、bundle 與測試結果。
4. Phase 15～17 每完成一個子頁面就刪除原 implementation，禁止長期維持兩套 caller。
5. Phase 18 的 screenshot update 必須人工檢視，不可因 CI 失敗直接無條件更新 baseline。
6. 若拆分只形成另一個超過門檻的大檔案，該 Phase 不視為完成。

## 22. 每階段的固定執行流程

1. 先建立 characterization test，紀錄搬移前輸出與互動。
2. 建立新 owner，先搬 pure logic，再搬 controller，最後搬 UI。
3. 更新所有 caller 後，在同一階段刪除舊實作；不得長期保留雙軌。
4. 執行 `npm test`、Python tests、`npm run build` 與 `git diff --check`。
5. 涉及 UI 時執行 390px 與 desktop screenshot；涉及 persistence 時跑 emulator/read budget tests。
6. 更新本指南中該 Phase 的 checklist 與實際差異。
7. 一個 Phase 完成後自動建立一個 non-amend commit，再開始下一階段。

## 23. Definition of Done

整體模組化重構只有在以下條件全數達成後才算完成：

- `main.jsx` <= 80 行，`terminal_review_practice.py` <= 100 行。
- tests 不再為取得 helper 而 import Web／Terminal entry point。
- Firebase access 只存在 repositories／api adapters；screens/pages 不知道 Firestore payload。
- Web／Terminal 複習規則由 versioned contract 持續做 parity validation。
- 單字匯入、session、offline sync、selection tools 各有唯一 owner，沒有舊版平行實作。
- desktop/mobile 核心流程有自動化視覺與互動回歸。
- Firestore Emulator 證明正常啟動、增量同步與單次作答符合 read/write budget。
- 架構 boundary tests 與 CI 能阻止責任重新集中到入口檔。
- `src/app/App.jsx` <= 500 行，且不直接依賴 Firebase SDK。
- `terminal_app/app.py` <= 600 行，所有主要 screen 有獨立 owner 與 fake-based tests。
- Study 與 Practice 不再集中於單一大型 `SessionPages.jsx`。
- CSS selector ownership 與 360px／390px／desktop Playwright baselines 已由 CI 強制執行。
