-- 即時數據依 box score 順序顯示：打者依打序、投手依登板順序（解析時的出現順序）
alter table live_game_stat add column box_order int not null default 0;
