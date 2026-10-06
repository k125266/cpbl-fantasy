-- E14 選秀規則（docs/rulebook-amendments.md「選秀與 keeper」）：
--   上半季：隨機抽籤、蛇形 draft_rounds 輪；下半季：補強選秀，依上半季戰績由差到好、每輪同順序、second_half_rounds 輪。
--   Keeper 只在下半季，至多 keeper_limit 人且不佔輪次（取代「上次輪次 − 2」）。

-- keeper 佔用輪次的設定不再需要，改為下半季補強選秀的輪數
alter table league rename column keeper_round_offset to second_half_rounds;
alter table league alter column second_half_rounds set default 5;
update league set second_half_rounds = 5;
alter table league alter column keeper_limit set default 15;
update league set keeper_limit = 15;

-- 選秀時間（keeper 在前 10 分鐘截止）、順位揭曉時間（各裝置依此同步播放）、是否蛇形
alter table draft add column snake boolean not null default true;
alter table draft add column scheduled_at timestamptz;
alter table draft add column revealed_at timestamptz;

-- keeper 不佔輪次
alter table keeper_selection drop column round;
