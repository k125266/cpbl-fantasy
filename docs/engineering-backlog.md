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
| E10 | 版本升級 | Spring Boot 3.5 → 4.x、Java 21 → 25、TypeScript 5.9 → 7 | 3.x 免費維護期較早結束，正式上線前完成 |
| E11 | 第三方新聞 | 依 `docs/rulebook-amendments.md` 實作 RSS 標題與連結 | 需雲端環境開放對外網路並逐家確認條款 |
| E12 | 2026 球季重播 | 抓取 2026 整季 box score，用 demo 時鐘重播真實球季 | 需開放 cpbl.com.tw 連線，同時完成 M0 驗證 |
