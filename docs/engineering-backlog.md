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
| E14 | 選秀調整（需改規則書） | 下半季改為「補強選秀」：keeper 上限約 15、只選 5 輪、依上半季戰績由差到好（非蛇形）；每人可預排想要清單，並可開「託管」由系統全部代選；逾時自動選改為優先依個人清單 | 完整選秀 100 手約 1～1.5 小時，一季兩次負擔大。重播時 5 個聯盟共用時鐘、選秀未完成會擋快轉，一個聯盟拖延會卡住所有人。上半季保留完整選秀（儀式感），下半季約 15～20 分鐘、保留翻身機制。預排清單與託管可與選秀室 v3 一起做 |
| E15 | 後端程式整理 | `api/` 內的 SQL（目前 25 處，`PlayerController` 佔 15 處）移到 service／repository，controller 只處理 HTTP；回傳 `Map<String, Object>` 的端點（約 39 處，例：`AdminController.status()`）改為 record DTO | 與 E6 一起做，DTO 才能產生前端型別。不必一次大改：改到相關功能時順手搬 |
| E16 | 前端程式整理 | 拆分過大的檔案（`TeamPage.tsx` 570 行、`styles.css` 842 行，改為依頁面的 CSS Modules 或分檔）；Vitest 單元測試（計分顯示、`fantasyTeamColor`、日期格式等純函式） | 端對端測試見 E3、lint 見 E5 |
