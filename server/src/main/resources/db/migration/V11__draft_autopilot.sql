-- 選秀託管（工程待辦 E18）：開啟後輪到這隊就在幾秒內自動選（候選清單 → 補缺位 → 排名），不等時間到。
-- 隊伍擁有者可以設定自己的隊伍，聯盟管理員可以設定任何隊伍（例：電腦隊伍、臨時缺席）。
alter table fantasy_team add column draft_autopilot boolean not null default false;
