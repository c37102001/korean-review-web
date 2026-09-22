# Web 可執行操作與測試清冊

> 盤點基準：2026-09-21，`src/app/`、`src/features/`、`src/components/` 的實際互動。這是待完成清冊，不是「全部已測」聲明。優先實作順序見 [核心操作測試清單](core-workflow-test-checklist.md)，階段分配見 [八階段實作計畫](web-test-implementation-plan.md)。

## 覆蓋標準

- 範圍：本網站提供的按鈕、連結、表單、選單、鍵盤快捷鍵、觸控手勢及可點擊卡片。相同共用元件在多筆資料上重複出現，按**行為契約**列一次，另測不同入口的接線與特殊語意。瀏覽器工具列、YouTube 自身介面及作業系統 TTS 不在本清冊；本站對它們的操作／失敗提示仍在範圍內。
- 每個 ID 最終至少要有一項**執行該操作並斷言結果**的測試，及可追蹤的測試名稱／檔案。若同一列列出多個選項或相反操作，每個選項／方向都要有斷言，可用同一測試的參數案例。新增、修改、刪除、作答、同步必須驗證重新讀取後的結果；僅有純函式、SSR、原始碼字串比對或快照都不算完成。
- 狀態 `缺`：未找到會執行這個 UI 操作的測試；`局`：已有純邏輯、fixture 或部分 UI 驗證，但未達上述標準；`通`：有真實 app 入口及必要的保存回讀測試。下表目前**沒有**可標為 `通` 的完整流程。實作後將狀態改為 `通`，並填入測試檔與 test 名稱，不得僅勾核方框。
- `單元`、`瀏覽器 fixture`、`Emulator` 各有用途。新的 app-flow 測試應使用測試登入與可控 repository／Emulator，不得連正式 Firestore。每個操作至少測正常路徑；高風險保存操作再測一個失敗或離線路徑，不做所有裝置與資料組合的笛卡兒乘積。
- 同一個測試可以覆蓋多個 ID，但要在各 ID 記錄該測試。共用元件的測試之外，首頁／資料夾／日期等入口至少各有一條 smoke flow 證明接線正確。未實作的新功能不預先列入；新增互動時必須更新本清冊。

## 導覽、登入與全域狀態

| ID | 操作與可觀察的預期結果 | 現況 |
| --- | --- | --- |
| G01 | 登入：有效帳密進首頁；錯誤帳密顯示錯誤且可重試，不能卡在載入中。 | 通：`tests/app/auth-workflows.spec.js`，`G01: valid login enters the real workspace; invalid password can be retried` |
| G02 | 註冊／切回登入：切換表單模式、建立帳號後進首頁，失敗可重試。 | 通：`tests/app/auth-workflows.spec.js`，`G02: registration mode switches back to login; failed registration can be retried` |
| G03 | 登出：清除登入狀態並返回登入頁，另一帳號不看到前一帳號資料。 | 通：`tests/app/auth-workflows.spec.js`，`G03: logout and reload keep two accounts and their cached folders isolated` |
| G04 | 頂部／側邊主功能標籤：首頁、日曆、單字本、資料夾、筆記、YT 字幕、閱讀測驗均可進入且載入對應資料。 | 通：`tests/app/navigation-home.spec.js`，`G04: every main tab opens its real page and loads its own data`、`G04: mobile navigation can open and leave a feature page` |
| G05 | 全域右下返回及頁內返回：每次只退一層，保留合理的來源頁狀態。 | 通：`tests/app/navigation-home.spec.js`，`G05: global back returns one level through subtitle and folder details`；`tests/app/calendar-workflows.spec.js`，`C02: date selection, View Date and double-click navigate and return to the same date` |
| G06 | 更多／設定選單：開關、點外部及 Esc 關閉；選擇功能後不誤觸其他命令。 | 通：`tests/app/navigation-home.spec.js`，`G06: settings menu closes on Escape/outside and commands stay distinct` |
| G07 | 錯誤邊界：實際頁面渲染失敗後可展開錯誤資訊、返回或重載，不停留空白頁。 | 局：合成錯誤 fixture |
| G08 | 同步／載入錯誤與「檢查同步」：錯誤可見、重試有結果，不假報成功。 | 局：狀態文字單元測試 |

## 首頁、日曆與自選練習

| ID | 操作與可觀察的預期結果 | 現況 |
| --- | --- | --- |
| H01 | 今日測驗：只用今天到期單字開始，無題時禁用；完成後火焰／進度更新。 | 局：選題規則與原始碼比對 |
| H02 | 查看明日題數：只在點擊時計算，可再點重新計算。 | 通：`tests/app/home-controls.spec.js`，`H02: tomorrow count is calculated on demand and recalculated after data changes` |
| H03 | 首頁新增單字：進標準編輯器，儲存後單字本可找到。 | 缺 |
| H04 | 新增練習：切換單字、例句聽力、例句閱讀、文法類型；設定題數、方向、文法、搜尋／熟悉度／資料夾條件後建立相應題池。 | 局：題池 domain 測試 |
| H05 | 自選練習「開始」：未做完可續做；答對暫移出 pool、答錯仍可再抽到；完成後從待練區消失。 | 局：題池 domain 測試 |
| H06 | 移除自選練習：確認後移除，取消則保留。 | 缺 |
| H07 | 今日錯題「查看」及最不熟悉 30 題「測驗」：開啟正確題組；錯題頁可再選學習／測驗。 | 局：選題與 session factory 測試 |
| H08 | 字體縮小／放大：在界限內變更並持續生效；界限按鈕禁用。 | 通：`tests/app/home-controls.spec.js`，`H08: font size respects both bounds and survives a reload` |
| H09 | 語音設定：選韓／中文語音、試聽、取消與儲存，重新開啟保留選擇；不支援時正確禁用。 | 通：`tests/app/home-controls.spec.js`，`H09: voice previews use the selected language; cancel discards and save persists`、`H09: unsupported speech disables saving instead of pretending to play` |
| H10 | 關閉／取消新增練習視窗：不新增待練任務；保存失敗時保留所選條件並顯示錯誤。 | 缺 |
| C01 | 日曆上一月／下一月／今天：顯示相應月份並更新選取日期。 | 通：`tests/app/calendar-workflows.spec.js`，`C01: previous/next month and Today update the month and selected date` |
| C02 | 點日期、雙擊日期及「查看日期」：選取與進入該日內容的語意正確，返回後可繼續瀏覽。 | 通：`tests/app/calendar-workflows.spec.js`，`C02: date selection, View Date and double-click navigate and return to the same date` |
| C03 | 日期頁新增／學習／測驗：只對當日或目前篩選結果操作。 | 局：集合 selector |
| C04 | 日期頁匯出 JSON、修改 JSON、刪除本日單字：匯出範圍與更新／刪除範圍正確；取消刪除不變。 | 局：JSON model |

## 共用單字集合與單卡

適用入口：單字本、資料夾詳情、日期詳情、今日錯題。測試共用控制本身之後，仍需各入口 smoke flow 驗證配置差異：錯題頁不能新增，資料夾移除不等於永久刪除，日期頁只處理該日。

| ID | 操作與可觀察的預期結果 | 現況 |
| --- | --- | --- |
| W01 | 搜尋輸入與「單字／全部」範圍切換：結果及數量正確，清空恢復；韓文和中文意思皆可在「單字」找到。 | 通：`tests/app/word-collection-workflows.spec.js`，`W01 W05 W06 W07 W08: search, reveal, details, pronunciation and star work from a real list` |
| W02 | 熟悉度多選／清除：多值取聯集，重新篩選後分頁有效。 | 通：`tests/app/word-collection-workflows.spec.js`，`W02 W03 W04 W09 W14: filters compose, sort and pagination retain correct selection`、`W04 W09: page controls and select-current-page operate only on visible words` |
| W03 | 資料夾多選、無資料夾、標籤群展開／收合、群組選取與清除：結果取聯集，不重複卡片。 | 通：`tests/app/word-collection-workflows.spec.js`，`W02 W03 W04 W09 W14: filters compose, sort and pagination retain correct selection` |
| W04 | 排序「最新／韓文字母／低分優先」及上一頁／下一頁：順序、邊界與頁碼正確。 | 通：`tests/app/word-collection-workflows.spec.js`，`W02 W03 W04 W09 W14: filters compose, sort and pagination retain correct selection`、`W04 W09: page controls and select-current-page operate only on visible words` |
| W05 | 隱藏／顯示全部中文與個別眼睛：兩種控制互動後，每張卡中文顯示狀態符合操作。 | 通：`tests/app/word-collection-workflows.spec.js`，`W01 W05 W06 W07 W08: search, reveal, details, pronunciation and star work from a real list`；`tests/app/calendar-workflows.spec.js`，`C02: date selection, View Date and double-click navigate and return to the same date`；`tests/app/folder-workflows.spec.js`，`F03 F05 W10 W11: add references, remove membership, and permanently delete a card` |
| W06 | 點卡片開詳情、關閉、開相關單字；內容、例句及補充說明完整，不改動資料。 | 通：`tests/app/word-collection-workflows.spec.js`，`W01 W05 W06 W07 W08: search, reveal, details, pronunciation and star work from a real list` |
| W07 | 單字列表／詳情的韓文及例句發音按鈕：傳入正確語言與文字，不誤開詳情；中文發音屬學習／測驗控制，列入 S05／P05。 | 通：`tests/app/word-collection-workflows.spec.js`，`W01 W05 W06 W07 W08: search, reveal, details, pronunciation and star work from a real list` |
| W08 | 星號加入／取消：單卡、詳情與學習／測驗中顯示一致；重新進入保留。 | 通：`tests/app/word-collection-workflows.spec.js`，`W01 W05 W06 W07 W08: search, reveal, details, pronunciation and star work from a real list`、`W08: starred words stay selected in study and practice after reload` |
| W09 | 勾選單卡、選取／取消本頁、清除：選取數量正確，切換篩選／分頁後不誤選。 | 通：`tests/app/word-collection-workflows.spec.js`，`W02 W03 W04 W09 W14: filters compose, sort and pagination retain correct selection`、`W04 W09: page controls and select-current-page operate only on visible words` |
| W10 | 批次加入既有／新資料夾及從目前資料夾移出：只改指定 membership，回讀後一致。 | 通：`tests/app/folder-workflows.spec.js`，`F03 F05 W10 W11: add references, remove membership, and permanently delete a card` |
| W11 | 單卡或批次永久刪除：確認後單字與各資料夾 reference 消失；取消無變動。 | 通：`tests/app/folder-workflows.spec.js`，`F05 W11: stale folder references can be removed and single-card deletion clears memberships`、`F03 F05 W10 W11: add references, remove membership, and permanently delete a card`；資料文件保留 `deletedAt` tombstone 供增量同步 |
| W12 | 單卡編輯入口與列表上方新增入口：打開正確單字／日期／資料夾的編輯器。 | 局：編輯器 fixture，入口未測 |
| W13 | 列表的學習／測驗：只使用目前篩選結果；錯題頁答對後清單相應縮減。 | 局：集合／錯題 model |
| W14 | 隱藏／顯示已學習（單字本）：只影響列表可見性，不修改資料。 | 通：`tests/app/word-collection-workflows.spec.js`，`W02 W03 W04 W09 W14: filters compose, sort and pagination retain correct selection` |
| W15 | 匯出 JSON 的複製／下載：輸出目前指定範圍的完整資料，可重新解析。 | 通：`tests/app/word-collection-workflows.spec.js`，`W15: export copy and download contain parseable source data`；`tests/app/folder-workflows.spec.js`，`F03 F05 W10 W11: add references, remove membership, and permanently delete a card` |
| W16 | 批次修改 JSON 的複製、檢查變更、返回編輯、放棄、確認保存：只更新選定範圍，錯誤 JSON 不寫入。 | 局：JSON model |
| W17 | 單字本詞性單選下拉選單：切換特定詞性或全部時，卡片與數量正確；與資料夾、熟悉度等篩選條件一起生效，學習／測驗題目也只取目前結果。 | 通：`tests/app/word-pos-filter.spec.js`，`W17: notebook filters by one part of speech and combines it with folder selection`；`tests/word-collection.test.mjs`，`part-of-speech selection composes with folders and familiarity for cards and questions` |
| W18 | 批次設定／恢復「不複習」：資料寫回且不覆蓋意思；已學習中的單字不能直接恢復複習。 | 通：`tests/app/no-review.spec.js`，`noReview can be batch-set, edited, and never enters study or practice`、`adding a word to the learned folder sets noReview without erasing its meanings`；`tests/review-eligibility.test.mjs` |

## 資料夾管理與單字編輯器

| ID | 操作與可觀察的預期結果 | 現況 |
| --- | --- | --- |
| F01 | 建立、重新命名、標記 tag 的資料夾；同 tag 歸組，無 tag 進無標籤組。 | 通：`tests/app/folder-workflows.spec.js`，`F01 F02 F04: create, rename, tag, pin, collapse and delete preserve words` |
| F02 | 資料夾釘選／取消、tag 群收合／展開：順序與可見性正確。 | 通：`tests/app/folder-workflows.spec.js`，`F01 F02 F04: create, rename, tag, pin, collapse and delete preserve words` |
| F03 | 開資料夾、搜尋／切範圍、加入現有單字（搜尋、複選、確認）：回讀後成員正確。 | 通：`tests/app/folder-workflows.spec.js`，`F03 F05 W10 W11: add references, remove membership, and permanently delete a card` |
| F04 | 編輯資料夾 tag／名稱、刪除資料夾：系統資料夾限制與一般資料夾刪除語意正確，單字仍保留。 | 通：`tests/app/folder-workflows.spec.js`，`F01 F02 F04: create, rename, tag, pin, collapse and delete preserve words` |
| F05 | 在資料夾詳情編輯卡片、移出卡片、批次操作與清理失效 reference：只影響指定資料夾或指定卡片。 | 通：`tests/app/folder-workflows.spec.js`，`F05 W11: stale folder references can be removed and single-card deletion clears memberships`、`F03 F05 W10 W11: add references, remove membership, and permanently delete a card` |
| E01 | 手動新增：日期、韓文、七種詞性、活用形式、中文意思、句型、成對例句、Markdown 筆記與關聯詞可輸入並保存；必填錯誤阻止寫入。 | 局：表單 SSR、匯入驗證 |
| E02 | 新增／刪除多個意思、加入／移除活用形式、搜尋／加入／移除關聯詞：保存後結構完整，最後一個意思不可刪空。 | 局：domain model |
| E03 | 編輯既有單字的表單、資料夾複選勾選／取消：回讀後內容與 membership 一致，原作答進度不遺失。 | 局：`word-edit.spec.js` 只按未變更內容的保存 |
| E04 | 表單／JSON 模式切換、JSON 複製與清除、JSON 修改並儲存：資料內容真的變更；取消不寫入。 | 局：JSON model、未變更內容的 fixture |
| E05 | JSON 多筆匯入、缺漏／舊詞性逐筆選擇與套用修正：全部合規前不能寫入。 | 局：`word-pos-import.spec.js` 使用 mock 寫入 |
| E06 | 匯入衝突：保留既有／使用匯入／A／B／合併／編輯後結果，及不存在 related 的清空處理；每種選擇得到正確最終卡片。 | 局：衝突 model |
| E07 | 匯入的放棄、繼續檢查、全部匯入、完成與重複單字「開啟既有編輯」：狀態與實際寫入數一致，失敗可重試。 | 局：匯入 model |
| E08 | 單字「不複習」在表單與 JSON 編輯中可設定；JSON 可省略此欄位，預設參與複習；加入已學習時自動設為 true。 | 通：`tests/app/no-review.spec.js`、`tests/review-eligibility.test.mjs`；JSON 匯入多筆的畫面流程待補 |

## 學習與測驗

| ID | 操作與可觀察的預期結果 | 現況 |
| --- | --- | --- |
| S01 | 學習篩詞性、韓／中文正面、隨機、只看星號：可見卡片及順序符合選項。 | 局：model，單頁 fixture |
| S02 | 上／下一張、點卡翻面、Enter 與方向鍵操作：卡片／索引正確；在表單輸入時不攔鍵。 | 局：鍵盤 intent、一次翻面 fixture |
| S03 | 手機卡片左／中／右雙擊與磁吸：上一張／翻面／下一張，單擊與滑動不誤觸。 | 局：區域計算純函式 |
| S04 | 每張先隱藏中文、單卡顯示／隱藏及空白鍵：僅允許的卡片面生效，換張恢復預期狀態。 | 局：顯示規則純函式 |
| S05 | 自動播放開關、語音／例句語音開關及完整播放次數：播放順序與停止符合設定；退出後不繼續播放。 | 局：語音規則純函式 |
| S06 | 學習卡的發音、星號、不熟悉／已學習切換、編輯與返回：各項更改保存，返回原來源。 | 局：分類規則，無完整 UI 路徑 |
| P01 | 測驗開始前的方向、打字／心中作答、題源、星號、原順序／隨機、紀錄開關：產生對應題組和持久化政策。 | 局：session factory／policy |
| P02 | 打字確認、公佈答案、下一題；韓翻中自評答對／答錯：顯示正確答案，只有一次有效作答。 | 局：答案 model、答案畫面 fixture |
| P03 | 每日題、集合題、不熟悉題、今日錯題及自選練習完成：成績、錯題檢討、重測與每日排程各依模式處理。 | 局：review／session／pool 純函式 |
| P04 | 公布答案後的星號、不熟悉／已學習、單字編輯：保存後本輪及重新進入顯示一致。 | 局：分類規則 |
| P05 | 音效、自動發音、中文發音、重播：開關與播放語言正確，不在下一題意外重播。 | 局：語音純函式 |
| P06 | 每日複習、自選練習、各列表測驗與學習均排除 `noReview=true` 及已學習單字；既有練習題組開始時亦排除，文法題維持可練。 | 局：`tests/review-eligibility.test.mjs`、`tests/app/no-review.spec.js`；自選題組重開的完整 E2E 待補 |
| P07 | 例句聽力／閱讀、文法例句及分階段揭示：題面、答案和下一題狀態正確。 | 局：選題／揭示 model |
| P08 | 結果頁再練一次、只重測錯題、重新儲存進度：題池與遠端進度回讀正確，失敗有提示。 | 局：session policy／repository |

## 筆記、YT 字幕與閱讀測驗

| ID | 操作與可觀察的預期結果 | 現況 |
| --- | --- | --- |
| N01 | 筆記搜尋、文法／單字分類收合，打開／關閉詳情；結果只顯示符合內容。 | 局：解析與靜態 fixture |
| N02 | 兩類筆記新增、編輯 tagged 文字、改分類、取消／儲存：解析後內容與分類回讀正確，錯誤格式不寫入。 | 局：tagged parser |
| N03 | 釘選／取消釘選、刪除與確認取消：分類內置頂，回讀後狀態正確。 | 缺 |
| N04 | 勾選筆記、選取／取消本頁、清除，以及從單篇／多篇開始例句練習：題目只來自選取內容。 | 局：grammar questions model |
| Y01 | 字幕列表搜尋、標籤收合、新增／編輯／刪除、已學習及隱藏已學習：重新進入後內容、分類與可見性正確。 | 局：JSON／SRT parser 與靜態 fixture |
| Y02 | 新增／編輯字幕時切換 JSON／SRT、設定 YouTube URL 與 tag，格式錯誤顯示提示且不寫入。 | 局：parser |
| Y03 | 讀者頁開外部 YouTube、播放／暫停、點擊或鍵盤 Enter／空白選 SRT 句子跳時間、播放中提示與字幕置中捲動；無影片時有合理 fallback。 | 局：embed URL、時間查找、靜態 fixture；不依賴真實 YouTube 做 CI |
| Y04 | 字幕的中文顯示／隱藏、資料夾泡泡、編輯／刪除字幕、全句「+」：各自執行預期操作，隱藏中文不改卡片高度。 | 局：中文切換 fixture |
| Y05 | 滑鼠與觸控反白韓文（包含句首及調整選取範圍）後新增單字／開 Naver 字典；已新增單字 highlight、點字看意思／開詳情；選字時影片暫停。 | 局：選字／highlight model，無完整 UI 流程 |
| R01 | 閱讀題列表搜尋、tag 收合、複製 JSON 格式、批次匯入／編輯／刪除：題目數量、內容與 tag 回讀正確。 | 局：reading JSON model |
| R02 | 閱讀文章選項單選、確認答案、逐段中譯揭示與再做一次：答對／答錯狀態正確；提交後不可更改選項。 | 局：一次作答 fixture |
| R03 | 閱讀題已學習切換、文章編輯／刪除、開閱讀測驗資料夾：重新進入後狀態正確。 | 缺 |
| R04 | 文章／題目／選項反白新增單字與查字典、臨時畫線／取消、已建單字點擊看意思／編輯／刪除：只對正確文字和卡片生效；臨時畫線不冒充已持久化。 | 局：選字與匹配 model |

## 離線、錯誤與測試資料邊界

| ID | 操作與可觀察的預期結果 | 現況 |
| --- | --- | --- |
| O01 | 主動離線開／關：開啟後只讀本機、操作可排隊；關閉後同步並清除 pending，離線資料不跨帳號。 | 局：offline support 單元測試 |
| O02 | 下載／更新離線資料與完整重新下載：可回報進度，缺漏集合補齊；完整重建不丟未同步修改。 | 局：快取／coverage 單元測試 |
| O03 | 離線新增、編輯、刪除與每日答題，恢復連線後回讀：每筆只套用一次，錯誤顯示且可重試。 | 局：queue／Emulator 各自測，無整段 UI 流程 |
| O04 | 寫入拒絕、429、權限錯誤、網路中斷：保存頁保留輸入並可重試，不能顯示虛假的成功或永久載入。 | 局：部分狀態文字與錯誤邊界測試 |

## 現有測試證據與執行規則

- 局部證據索引：導覽／頁面配置見 `tests/app-architecture.test.mjs`；單字集合及卡片見 `tests/word-collection.test.mjs`、`tests/word-presentation.test.mjs`、`tests/visual/core-surfaces.spec.js`；匯入與表單見 `tests/word-import.test.mjs`、`tests/word-import-form.test.mjs`、`tests/visual/word-edit.spec.js`、`tests/visual/word-pos-import.spec.js`；學習與測驗見 `tests/session-model.test.mjs`、`tests/session-interactions.test.mjs`、`tests/review-engine.test.mjs`、`tests/optional-practice.test.mjs`；筆記／字幕見 `tests/import-flow.test.mjs`；閱讀見 `tests/reading-model.test.mjs`；離線／資料庫見 `tests/offline-support.test.mjs`、`tests/emulator/firestore-sync.test.mjs`。這是現有保護的索引，**不是**把整組 ID 判為完成的證據。
- `tests/visual/core-surfaces.spec.js` 的 24 個快照保留：它們驗證不同寬度的外觀與少量局部互動，**不計入**上表保存／導覽操作的完成數。`word-edit.spec.js` 儲存未變更的內容；`word-pos-import.spec.js` 使用 mock 寫入。兩者都應保留，完成欄位要等更完整測試才可標 `通`。
- `tests/emulator/firestore-sync.test.mjs` 驗證規則、同步與寫入合約；`tests/import-flow.test.mjs`、`tests/review-engine.test.mjs` 等驗證純邏輯。它們提供上表「局」的部分證據，但沒有測真實 app 的按鈕接線。
- 建議新增少量可重用的 app-level Playwright flow：共同處理測試登入、seed、重新進入、失敗注入；把多個 ID 放進同一條合理的使用者旅程。另以少量 Emulator flow 驗證寫入／離線回讀合約。不要用一張新全頁快照取代行為斷言。
- 每個新增或改動的前端互動，PR／commit 的檢查項目為：清冊 ID（或新增 ID）、預期行為、驗證該操作的測試檔與 test 名稱、錯誤狀態是否需要補測。舊測試只有在有等價替代且確認原保護效果保留時才可移除。
- 定期用 `rg -n 'onClick=|onChange=|onKeyDown=|onPointer|onDoubleClick=|<summary|href=' src/app src/features src/components` 重新盤點入口；條件式渲染的控制（例如有資料夾才出現的泡泡）也要核對。這個文字搜尋只是防漏提醒，不能代替人工確認預期行為與測試證據。
