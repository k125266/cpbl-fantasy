-- 即時比分的比賽狀態細節。只存比賽狀態與逐打席結果代碼，不存文字轉播的敘述內容（見 docs/rulebook-amendments.md）。
alter table live_game add column line_score jsonb;                            -- {away:[…], home:[…], awayRhe:[R,H,E], homeRhe:[R,H,E]}
alter table live_game add column batter_player_id bigint references player (id);
alter table live_game add column pitcher_player_id bigint references player (id);
alter table live_game add column pitch_count int;
alter table live_game add column batter_results jsonb;                        -- 目前打者本場結果代碼，例：["三振","右飛"]
alter table live_game add column half_inning jsonb;                           -- 本半局打席：[{jersey, name, result}]，正在打擊 result 為 null

-- 棒次（替補沿用被替換者的棒次）；changed_at 為數據最後一次變動的輪詢時間（「剛更新」）
alter table live_game_stat add column lineup_slot int;
alter table live_game_stat add column is_sub boolean not null default false;
alter table live_game_stat add column changed_at timestamptz;
