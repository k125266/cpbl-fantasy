# CPBL Fantasy — 給 Claude 的專案說明

中華職棒 fantasy baseball 私人聯盟（5 隊、非商業、封閉、免費）。規則依據使用者提供的《規則書 v0.1》與開發 backlog（CPBLF-*），
本 repo 內的補充與決策見 `docs/`。

## 協作方式（重要）

使用者本身是工程師，希望**一起開發，而不是全部交給 Claude 寫**：
- 動手前先說明計畫與要改的檔案，等使用者同意或挑選要自己寫的部分
- 適合時採「Claude 寫測試、使用者實作」或「使用者寫、Claude review」
- 每個功能一個小 PR；不要一次改一大片
- 回覆與文件使用繁體中文；程式碼註解沿用既有的繁體中文風格

## 常用指令

```bash
docker compose up -d                 # 啟動 PostgreSQL（cpblf / cpblf_test）
cd web && npm ci && npm run build    # 前端建置，輸出到 server/src/main/resources/static
cd web && npm run dev                # 前端開發伺服器 :5173，/api 轉到 :8080
cd web && npm run typecheck          # 前端型別檢查
cd server && ./mvnw spring-boot:run  # 後端 :8080（預設 demo 模式）
cd server && ./mvnw test             # 後端測試（需要 cpblf_test 資料庫）
```

Demo 帳號：`demo1` / `demo1234`（聯盟管理員兼系統管理員），`demo2`～`demo5`。
Demo 模式用模擬賽季（虛構球員）；「聯盟 → 系統管理」可以快轉日期。

## 架構

- `server/`：Java 21、Spring Boot 3.5、JdbcClient（手寫 SQL，不用 JPA）、Flyway（`src/main/resources/db/migration`）
  - `source/` 資料源（官網爬蟲與白名單 parser）、`demo/` 模擬賽季
  - `pipeline/` 排程工作：賽程、名單同步、結算（`game_stat` 的唯一寫入者）、即時輪詢
  - `scoring/` 計分與對戰、`season/` 半季與對戰期、`roster/` 名單與鎖定、`waiver/`、`trade/`、`draft/`、`league/`
- `web/`：React 19、TypeScript、Vite；頁面在 `src/pages/`，共用元件在 `src/components.tsx`，API 型別在 `src/api.ts`
- 時間一律透過 `AppClock`（Asia/Taipei；demo 模式可調整），不要直接用 `Instant.now()` / `LocalDate.now()`

## 不可違反的規則（規則書第 10 節）

- 不得加入任何金錢元素或相關欄位（收費、獎品、可兌換點數、下注、廣告）；FAAB 欄位一律 `faab_*`
- 官網只擷取統計欄位（`CpblParsers` 白名單）；不擷取新聞、文字轉播、圖片；第三方新聞只能標題＋連結（見 `docs/rulebook-amendments.md`）
- 不使用球員照片、球隊 logo；球隊用自訂色塊（`web/src/teams.ts`），球員用背號
- 爬蟲：可識別的 User-Agent、Live Poller ≥ 60 秒、非比賽時段不輪詢、遇速率限制停止
- 系統文字不得推測傷況或出現「傷兵」字樣
- `SchemaComplianceTest` 會檢查 schema 有沒有金錢相關命名

## 其他

- 計分相關修改必須維持：比率類別先加總再相除、結算可重複執行結果一致、交易不改變歷史比分（都有測試）
- 名單是 effective-dated（`valid_from` 含、`valid_to` 不含）；鎖定球員的異動自次日生效
- 待辦清單：`docs/engineering-backlog.md`（E1–E12）
