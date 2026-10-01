# M0 資料可行性驗證：現況

> 對應 backlog CPBLF-1 ～ CPBLF-5。

## 先說結論

開發環境的網路政策封鎖了 `cpbl.com.tw`，所以 **M0 沒辦法對官網做實際請求驗證**。
目前的結論來自 PyPI 套件 `mcp-cpbl-statistics` 0.1.1 的原始碼（backlog 建議的參考來源）。
它已經對官網做過實際整合，可以佐證 endpoint、CSRF 流程與部分欄位名稱。

系統已經做成可以在 M0 結果出來前先開發、驗證所有規則的形式：

- 資料源抽象為 `CpblDataSource`，有兩個實作：
  - `CpblWebDataSource`：官網爬蟲
  - `SimulatedDataSource`：確定性的模擬賽季，demo 與測試用
- 官網欄位名稱只出現在 `CpblParsers` 一個檔案裡，同時也是欄位白名單（CPBLF-70）。
  M0 驗證完成後，如果欄位名稱不同，只要改這個檔案。

## 已佐證（來自 mcp-cpbl-statistics 原始碼）

| 項目 | 結論 |
|---|---|
| 存取方式 | 純 HTTP 即可，不需要 headless browser。先 GET 頁面取得 session cookie，再從頁面 JS 擷取 `RequestVerificationToken: '...'`，最後以 header `RequestVerificationToken`、`X-Requested-With: XMLHttpRequest` POST 到 XHR endpoint |
| 賽程 | `POST /schedule/getgamedatas`，form：`calendar=YYYY/01/01`、`location=`、`kindCode=A`。回應的 `GameDatas` 是 JSON 字串 |
| 賽程欄位 | `GameSno`、`GameDate`、`PreExeDate`（表定開賽時間）、`KindCode`、`HomeTeamName`、`VisitingTeamName`、`HomeScore`、`VisitingScore`、`IsGameStop`（"1" = 延賽／取消）、`PresentStatus`（1 = 已結束） |
| kind_code | A 一軍例行賽、B 明星賽、C 總冠軍賽、D 二軍例行賽、E 季後挑戰賽、G 熱身賽 |
| 打擊欄位命名 | `HitCnt` 是**打數**、`HittingCnt` 是**安打**（容易搞混）。另有 `PlateAppearances`、`HomeRunCnt`、`RunBattedINCnt`、`ScoreCnt`、`StealBaseOKCnt`、`BasesONBallsCnt` |
| 投球局數 | `InningPitchedCnt`（整數局）＋ `InningPitchedDiv3Cnt`（1/3 局數）→ outs = 前者 × 3 + 後者。**QS 可推導**（CPBLF-2） |
| HLD | 年度投球成績有 `ReliefPointCnt`（中繼成功）原生欄位，救援成功為 `SaveOK`。**HLD 為官網原生欄位，規則書 5.2 的 SV+HLD 可維持**（CPBLF-3） |
| 球員主檔 | `/player` 頁的 `div.PlayersList` 列出各隊球員與 `acnt`（原生 id）；`/team/person?acnt=` 的 `dd.pos`、`dd.nationality` 提供守備位置與國籍（CPBLF-4 的 id／國籍／球隊／位置） |
| 逐場成績 | `POST /team/getfollowscore`（`acnt`、`defendStation`、`year`、`kindCode`）回傳球員逐場數據，可作為 box score 之外的第二資料來源 |

## 未驗證（上線前必須完成）

| 項目 | 目前實作的假設 | 風險 | 位置 |
|---|---|---|---|
| Box score endpoint | `GET /box/index?year=&kindCode=&gameSno=` 取 token → `POST /box/getlive`（`GameSno`、`KindCode`、`Year`、`PrevOrNext`、`PresentStatus`），回應含 `BattingJson`、`PitchingJson` | 高 | `CpblWebDataSource.fetchBoxScore` |
| Box score 打擊列欄位 | `HitterAcnt`、`HitterName`、`VisitingHomeType`（1 客 2 主）、`DefendStation`，數據欄位沿用上表命名 | 高 | `CpblParsers.BATTING_FIELDS` |
| Box score 投球列欄位 | `PitcherAcnt`、`PitcherName`、`SaveOK`、`ReliefPointCnt`；先發投手以「各隊投球列第一位」判定 | 中 | `CpblParsers.PITCHING_FIELDS` |
| 一軍登錄名單 | `/player` 頁姓名前綴標記 `◎` 代表一軍登錄 | 高 | `CpblWebDataSource.FIRST_TEAM_MARKERS` |
| 註銷判定 | 由「60 人註冊名單差異」推導（不在名單中即註銷） | 中 | `RegistrationSync` |
| 延賽 / 補賽日期（CPBLF-5） | 補賽後同一 `GameSno` 的 `GameDate` 變為實際開打日；系統保留第一次看到的日期為原定日期 | 中 | `SchedulePoller.upsert` |
| 「進行中」狀態 | 賽程 API 沒有進行中狀態；過了 `PreExeDate` 且未結束就視為進行中 | 低 | `SchedulePoller.effectiveStatus` |

防呆設計：結構不符時一律丟出 `SourceStructureException`，中止該 job 並告警，不會靜默寫入錯誤資料。

- **缺欄位**：打擊列缺 `HitterAcnt`，或投球列缺 `InningPitchedCnt`
- **一軍名單解析不出任何標記**：中止同步，不會把所有人都誤判成下二軍
- **單次同步會註銷超過 20% 球員**：視為結構變動，中止同步

## 驗證步驟（在可連線的環境執行）

1. `curl` 取得 `/box/index?year=2026&kindCode=A&gameSno=1`，確認頁面 JS 中的 token 格式與 `/box/getlive` 的 form 參數。
2. 將回應存成 fixture，放到 `server/src/test/resources/fixtures/`，改寫 `CpblParsersTest` 改用真實 fixture。
3. 以近 10 場比賽驗算 QS：拿官網的先發局數與自責分跟 parser 輸出比對（CPBLF-2 AC）。
4. 確認一軍登錄名單的實際呈現方式。如果不是 `/player` 前綴標記，請修改 `fetchRegistration`。
5. 找一場已補賽的比賽，確認 `GameDate` 是原定日還是實際日（CPBLF-5）。
