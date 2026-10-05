# 工程待辦（POC 之後補齊）

POC 優先。以下是對照業界常見做法還缺的部分，依建議順序排列，之後一項一項補上。

| # | 項目 | 內容 | 備註 |
|---|---|---|---|
| E1 | 開發流程 | 一個功能一個小 PR；main 開啟分支保護，CI 沒過不能合併 | 分支保護需 repo 擁有者在 GitHub Settings → Branches 設定 |
| E2 | 手機推播 | PWA（可安裝到手機桌面）＋ Web Push：輪到你選秀、先發球員今日無賽、waiver 結果 | fantasy 的核心體驗 |
| E3 | 前端測試 | Playwright 端對端測試放進 CI（登入、選秀、調整名單、簽人） | |
| E4 | 後端測試 | 改用 Testcontainers，不再依賴本機 PostgreSQL | 開發環境需有 Docker |
| E5 | 程式碼品質 | 前端 ESLint + Prettier（或 Biome）、後端 Spotless；Dependabot / Renovate；CodeQL 安全掃描 | |
| E6 | 前後端介面 | springdoc-openapi 產生 API 規格，前端型別自動產生，取代手寫 `api.ts` 型別 | |
| E7 | 安全性 | 改用 Spring Security（CSRF、登入次數限制、安全標頭），評估 passkey | |
| E8 | 即時性 | 選秀室由 2 秒輪詢改為 SSE 或 WebSocket | |
| E9 | 維運 | docker-compose 一鍵啟動、Actuator 健康檢查與 Micrometer 指標、結構化 log、資料庫自動備份、決定部署平台 | |
| E10 | 版本升級 | Spring Boot 3.5 → 4.x、Java 21 → 25、TypeScript 5.9 → 7 | **Zeabur 上線前必做**：3.5 是 3.x 最後一版，免費維護已於 2026-06-30 結束。升級要處理 Jackson 2 → 3（套件 `com.fasterxml` → `tools.jackson`）、starter 拆分（例：Flyway 改用 `spring-boot-starter-flyway`）。建議與 E4、E9 同一段處理 |
| E11 | 第三方新聞 | 依 `docs/rulebook-amendments.md` 實作 RSS 標題與連結 | 需雲端環境開放對外網路並逐家確認條款 |
| E12 | 2026 球季重播 | ~~抓取 2026 整季 box score，用 demo 時鐘重播真實球季~~ | 已完成（PR #11）：進階數據網站逐場封存，`cpblf.source=replay` |
| E13 | 管理員設定頁 | 一個頁面集中管理所有參數：聯盟設定（名單結構、洋將上限、waiver、交易、資格門檻等）、資料源與排程狀態，以及球員資料的人工修正（例：洋將標記、守位） | 洋將由進階數據網站「原名」的全大寫姓氏自動判斷；少數個案（例：陳思仲，原名 John Peter CLARK，疑以本土身分登錄）需人工修正。人工修正要記錄在 `player_status_log`，同步時不得覆蓋 |
| E14 | ~~選秀調整（需改規則書）~~ | 已完成（2026-10-06）：下半季補強選秀 5 輪、依上半季戰績由差到好、每輪同順序；keeper 至多 15 人不佔輪次、揭曉前保密；順位揭曉。見 `docs/rulebook-amendments.md`「選秀與 keeper」 | 預排清單在選秀室 v3 做；託管拆到 E18 |
| E15 | 後端程式整理 | `api/` 內的 SQL（目前 25 處，`PlayerController` 佔 15 處）移到 service／repository，controller 只處理 HTTP；回傳 `Map<String, Object>` 的端點（約 39 處，例：`AdminController.status()`）改為 record DTO | 與 E6 一起做，DTO 才能產生前端型別。不必一次大改：改到相關功能時順手搬 |
| E16 | 前端程式整理 | 拆分過大的檔案（`TeamPage.tsx` 570 行、`styles.css` 842 行，改為依頁面的 CSS Modules 或分檔）；Vitest 單元測試（計分顯示、`fantasyTeamColor`、日期格式等純函式） | 端對端測試見 E3、lint 見 E5 |
| E17 | 通知改版 | 依設計稿「即時比分與通知」1c／1d：通知加類型與連結欄位（交易、Waiver、對戰、球員卡、名單、聯盟），篩選（全部／待處理／各類型）、依日期分組、待處理的帶連結直達、全部已讀、頂列鈴鐺未讀數 | 現有 `notification` 只有一行文字，需加欄位並修改約 38 處發通知的程式。設計稿的「$12」改為 FAAB 點數，不得出現金錢符號 |
| E18 | 選秀託管 | 「我不在，系統幫我全部自動選」開關：開啟後輪到你就立即照預排清單 → 缺位 → 排名代選，不等時間到 | 2026-10-06 使用者決定先不做；重播時可避免一個人拖住共用時鐘。設計稿「Keeper 與選秀抽籤」提到託管的文字先拿掉 |
