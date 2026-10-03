-- 計分類別改版（docs/rulebook-amendment-categories.md）：W+SV 取代 SV+HLD，需要記錄勝投。
-- rbi、sb、hld 保留不刪：資料源（進階數據網站）沒有這些欄位，不再計分；官網日後開放時可恢復。
alter table game_stat add column w int not null default 0;
alter table live_game_stat add column w int not null default 0;
