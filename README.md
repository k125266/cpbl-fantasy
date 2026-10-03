# CPBL Fantasy Baseball

中華職棒 fantasy baseball 私人聯盟系統。非商業、封閉、免費。

- 規則依據：《CPBL Fantasy Baseball 規則書 v0.1》
- 開發依據：開發 backlog（CPBLF-*）
- 規則書未明定之處的實作選擇：[`docs/decisions.md`](docs/decisions.md)
- 資料來源實測結論（M0）：[`docs/m0-data-feasibility.md`](docs/m0-data-feasibility.md)
- 計分類別（R、HR、H、BB、AVG ／ QS、K、W+SV、ERA、WHIP）修訂草案：[`docs/rulebook-amendment-categories.md`](docs/rulebook-amendment-categories.md)

> ⚠️ **資料來源**：官網 cpbl.com.tw 的 CDN 會擋爬蟲，改用中職進階數據網站 stats.cpbl.com.tw（`CPBLF_SOURCE=stats`）。
> 名單、賽程與已結束比賽的 box score 已實測可用；**即時比分與開賽時間尚待比賽進行中實測**。
> 預設仍是 **demo 模式**（模擬賽季、虛構球員）。詳見 `docs/m0-data-feasibility.md`。

## 技術架構

| 層 | 技術 |
|---|---|
| 後端 | Java 21、Spring Boot 3.5、JdbcClient、Flyway |
| 資料庫 | PostgreSQL 16 |
| 前端 | React 19、TypeScript、Vite（手機直式優先，建置後由後端一併提供） |

```
server/src/main/java/tw/cpblf/
├── source/     資料源介面、cpbl.com.tw 爬蟲（欄位白名單 parser、禮貌 HTTP client）
├── demo/       模擬賽季資料源、demo 種子資料、時間快轉
├── pipeline/   Schedule Poller、Registration Sync、Settlement、Live Poller、對帳、監控、排程
├── scoring/    十類別計算、對戰判定、provisional / 鎖定、半季冠軍與總冠軍
├── season/     半季 / 雙週對戰期 / 每期雙對手賽程、戰績
├── roster/     effective-dated 名單、每日鎖定、位置資格、缺陣狀態、NA 回歸、註銷釋出
├── waiver/     Waiver 與 FAAB
├── trade/      交易與聯盟審核
├── draft/      Snake draft、keeper、排名
├── league/     聯盟、隊伍、設定、通知
├── auth/       帳號與 session
└── api/        REST controllers
```

## 本機執行（demo 模式）

需要 Java 21、Node 24、Docker（用來跑 PostgreSQL）。Maven 不用另外安裝，使用 repo 內的 `./mvnw`。

```bash
# 1. 資料庫（同時建立 cpblf 與測試用的 cpblf_test）
docker compose up -d

# 2. 前端（輸出至 server/src/main/resources/static）
cd web && npm ci && npm run build && cd ..

# 3. 後端
cd server && ./mvnw spring-boot:run
```

開啟 http://localhost:8080，以 `demo1` / `demo1234` 登入。
`demo1` 是聯盟管理員兼系統管理員；`demo2`～`demo5` 是其他隊伍。

Demo 流程：

1. 「選秀」頁 →「開始選秀」→「剩餘全部自動選取」（或自己選）
2. 「系統」頁 →「快轉 N 天」。系統會依正式排程順序，執行每日維護、waiver、名單同步、賽程、結算、對戰推進
3. 「系統」頁 → 跳到比賽時段（例如 19:30）可以看即時比分

模擬賽季會出現延賽與跨日補賽、和局、賽後數據修正、升降二軍（含洋將 15 日）、註銷、改名、一軍未出賽，
可用來檢驗規則書第 6 節的各種情況。

前端開發可另外執行 `cd web && npm run dev`（Vite 會把 `/api` proxy 到 8080）。

### 真實資料（stats 模式）

用另一個資料庫，避免和 demo 的虛構球員混在一起：

```powershell
docker compose exec db psql -U cpblf -c "create database cpblf_stats"
cd server
$env:CPBLF_SOURCE='stats'; $env:CPBLF_DB_URL='jdbc:postgresql://localhost:5432/cpblf_stats'; $env:CPBLF_SCHEDULER_ENABLED='false'
.\mvnw.cmd spring-boot:run
```

第一位註冊的帳號是系統管理員。之後在「系統」頁手動執行 job：
- `registration-sync`：名單同步。第一次約 15 分鐘，要逐一讀取每位新球員的個人頁。
- `schedule-poller`：從 sitemap 取得近期比賽。
- `settlement`：結算已結束的比賽。

## 測試

```bash
cd server && ./mvnw test   # 需要 PostgreSQL：CPBLF_TEST_DB_URL（預設 jdbc:postgresql://localhost:5432/cpblf_test）
cd web && npm run typecheck
```

涵蓋 backlog 明訂需要測試的項目：

| 項目 | 測試 |
|---|---|
| Settlement 重跑一百次結果一致、修正寫 revision log、未知球員中斷、24 小時 is_final（CPBLF-14） | `SettlementJobTest` |
| 交易後歷史對戰比分不變（CPBLF-22） | `SeasonFlowTest.tradeDoesNotChangeHistoricalScores` |
| 非白名單欄位不會被寫入（CPBLF-70） | `CpblParsersTest` |
| 進階數據網站的名單、二軍、洋將、比賽頁解析（真實頁面 fixture）、QS 推導（CPBLF-2） | `StatsSiteParsersTest` |
| 頻率與 User-Agent 設定不合規時啟動失敗（CPBLF-71） | `CrawlerSettingsValidatorTest` |
| Schema 無金錢相關欄位（CPBLF-73） | `SchemaComplianceTest` |
| 比率類別先加總再相除、無數據不判敗、5:5 和局 | `MatchupScorerTest` |
| Provisional → 48 小時鎖定、補賽依實際開打日歸屬、鎖定球員異動次日生效、waiver 同價戰績差者優先、註銷次日釋出、狀態文字不含傷勢推測 | `SeasonFlowTest` |

## 正式模式設定

| 環境變數 | 說明 | 預設 |
|---|---|---|
| `CPBLF_SOURCE` | `demo`、`stats`（中職進階數據網站）或 `web`（官網，目前被 CDN 擋） | `demo` |
| `CPBLF_DB_URL` / `CPBLF_DB_USER` / `CPBLF_DB_PASSWORD` | 資料庫 | localhost/cpblf |
| `CPBLF_SEASON_YEAR` | 賽季年度 | 2026 |
| `CPBLF_USER_AGENT` | 爬蟲 User-Agent，**必填**，請包含聯絡方式 | — |
| `CPBLF_LIVE_POLL_SECONDS` | 即時輪詢間隔，**低於 60 啟動失敗** | 60 |
| `CPBLF_ALERT_WEBHOOK` | 告警轉送 webhook（選填，例如 Discord） | — |
| `CPBLF_SCHEDULER_ENABLED` | 是否啟用排程 | true |

正式模式的流程：

1. 第一位註冊的使用者成為系統管理員，不需要邀請碼。
2. 在「尚未加入聯盟」頁建立聯盟，取得邀請碼。
3. 其他玩家用邀請碼註冊。
4. 聯盟管理員在「聯盟」頁產生賽程，再到「選秀」頁建立並開始選秀。

`Dockerfile` 會把前端與後端打包成單一映像。

### 排程（Asia/Taipei）

| 時間 | 工作 |
|---|---|
| 00:10 | 名單維護：註銷球員自動釋出、NA 回歸、對戰期推進 |
| 每 5 分鐘 | 到期的 waiver（03:00）、交易審核、對戰期推進與鎖定 |
| 05:30 | 一軍登錄名單同步 |
| 06:00 | 賽程同步 |
| 每 10 分鐘 | Settlement（只處理已結束、尚未定版的比賽） |
| 每 60 秒 | Live Poller（只在比賽時段發出請求） |
| 09:00 | 每日摘要 |
| 週一 04:00 | 當季全量對帳（只輸出差異並告警，不自動修正） |
| 8/29–9/2 每 3 小時 | 註冊大限全量名單同步，大量異動時產出報表 |

## 法遵（規則書第 10 節）

本專案的硬性約束如下，PR template 內有對應的檢查清單：

- 沒有任何金錢元素，也不預留相關欄位或開關。FAAB 只是聯盟內部虛擬預算。
- 只擷取統計數據欄位（parser 白名單），不儲存新聞、文字轉播、圖片。
- 不使用球員照片、球隊 logo 或隊徽；球隊以自訂色塊 + 縮寫呈現（`web/src/teams.ts`）。
- 爬蟲有可識別的 User-Agent、請求間隔下限、指數退避；遇到速率限制即停用該 job，需管理員確認後才重新啟用。
- 不提供傷況，只呈現客觀出賽狀態；介面不使用「傷兵」字樣。
- 提供隱私權政策（`/privacy`），頁尾聲明與中華職棒無隸屬關係。

## Backlog 對照

| Milestone | 狀態 |
|---|---|
| M0 資料可行性 | ⚠️ 依參考原始碼佐證；box score 與一軍名單需在可連線環境驗證 |
| M1 Pipeline | ✅ CPBLF-10～15。CPBLF-16 只完成週一全量對帳（與官網比對），**cpbl-opendata 匯入未實作** |
| M2 計分引擎 | ✅ CPBLF-20～23 |
| M3 聯盟與 Roster | ✅ CPBLF-30～37 |
| M4 選秀 | ✅ CPBLF-40～41（同步以 2 秒輪詢實作） |
| M5 前端 | ✅ CPBLF-50～54（名單調整採點選交換，未做拖放） |
| M6 維運 | ✅ CPBLF-60、61；CPBLF-62 完成修正歷程查詢，cpbl-opendata 差異清單待 CPBLF-16 |
| M7 法遵 | ✅ CPBLF-70～75 |
