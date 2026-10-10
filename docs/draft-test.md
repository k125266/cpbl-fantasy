# 選秀演練用的測試站

用真實聯盟的**複本**演練選秀，不碰真實站。選秀不能撤銷或重置（`docs/decisions.md`「選秀與 keeper」），所以演練一定要在複本上做，做完還原。

| | 真實站 | 測試站 |
|---|---|---|
| 埠 | 8080 | 8084 |
| 資料庫 | `cpblf_stats` | `cpblf_drafttest`（快照 `cpblf_dt_snap`） |
| 對外網址 | `https://<本機>.ts.net` | `https://<本機>.ts.net:8443`（`scripts/draft-test.ps1 funnel`） |
| 賽季年份 | 2026 | **2027**（見下） |
| 球員池／帳號 | 真實 | 同真實的複本；另有 3 個電腦隊 |

腳本：`scripts/draft-test.ps1`（`status`、`snapshot`、`reset`、`start`、`stop`、`funnel`、`funnel-off`），只會動 `cpblf_drafttest`、`cpblf_dt_snap` 與 8084／8443。

## 平常用法（資料庫已經準備好時）

1. `.\scripts\draft-test.ps1 start`，再 `funnel` 對外開放。
2. 使用者用**無痕視窗**開 `https://<本機>.ts.net:8443` 登入（原因見「注意」）。
3. 聯盟管理員到選秀頁，三個電腦隊的託管已開；真人演練時按「開始選秀」。
4. 演練完用 `reset` 還原成選秀前的狀態（快照不能是選秀開始後才做的）。

## 從頭準備（只有需要重做複本時）

1. **複製真實資料庫**：`pg_dump cpblf_stats | psql cpblf_drafttest`（要在資料庫容器裡 pipe，避免中文被轉碼）。複本裡已有真實球員、你們的帳號與聯盟，但還沒有賽程與選秀。
2. **啟動測試站**，環境：`CPBLF_SOURCE=stats`、`CPBLF_DB_URL=…/cpblf_drafttest`、`CPBLF_POSTSEASON_KINDS=A`（不重複追蹤季後賽）、`CPBLF_SEASON_YEAR=2027`、**排程要開**、`CPBLF_REGISTRATION_SYNC_ENABLED=false`（每天 05:30 的名單同步會把步驟 7 改成一軍的球員又改回二軍，選秀池就缺人、排名出現缺號；`scripts/draft-test.ps1` 已設定）。
3. **為什麼年份設 2027**：中職進階數據網站只保留當季，抓不到 2025（甚至 2024）。選秀的排名、數據、推薦都靠「上一季」的參考數據，所以把測試站設成 2027 季，上一季就是 2026，可以抓。
4. **封存 2026 參考季**：用系統管理員在管理頁按「封存參考季」（約 10 分鐘，一場 1.5 秒），完成後 `reference_stat` 有資料（2026：360 場、355 位球員）。
5. **系統管理員**：測試複本用 `bot1`（`UPDATE app_user SET is_admin = true`，只改複本）；密碼是 `bot-pass-1-2027`。
6. **3 個電腦隊**：用聯盟邀請碼註冊三個一般帳號（`POST /api/auth/register`，要在建賽程**之前**；請求內文要 UTF-8，Windows 上別用 curl 傳中文，改用 node 或 PowerShell）。`bot1`、`bot2`、`bot3` 的密碼是 `bot-pass-N-2027`（N 為 1～3）。
7. **球員池補齊**：十月球季結束，很多有成績的球員被調下二軍（`first_team_status = MINORS`），選秀池只收一軍名單，會缺人。複本裡把「有 2026 參考數據的球員」改成 `ACTIVE`：
   `UPDATE player SET first_team_status = 'ACTIVE' WHERE first_team_status = 'MINORS' AND id IN (SELECT player_id FROM reference_stat)`。
   2027 開季前一軍名單重新公布後，真實站不需要這步。
8. **建立賽程**（用 `bot1`，`POST /api/leagues/1/season`）：日期要是未來，例如上半季 2026-10-12～2026-11-22、下半季 2026-11-30～2027-01-10（對戰期與總冠軍賽各 14 天）。只要沒有任何對戰期開始，之後還能重建。
9. 打開選秀頁讓「準備中」的選秀出現，打開三個電腦隊的託管（`PUT …/drafts/{id}/autopilot`）。
10. **選秀開始前**執行 `snapshot` 存快照。

## 注意

- **登入 cookie 在同一台機器的不同埠共用**，在同一個瀏覽器開測試站會把真實站登出，反之亦然。測試站請用無痕視窗或另一個瀏覽器。
- 測試站做的事（賽程、選秀、機器人）都不會出現在真實站。
- 電腦要保持開機、不休眠，測試站與對外網址才連得到；重新開機後要 `start` 與 `funnel`。
- 整場電腦隊託管的選秀約 5 分鐘（每手 3 秒）；有真人時每手 60 秒。
- 腳本只允許覆寫 `cpblf_drafttest` 與 `cpblf_dt_snap`。不要把 `is_admin` 或測試密碼這些調整用在真實資料庫。
