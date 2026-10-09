-- 系統管理員手動設定的開賽時間：賽程更新不再覆寫（官網的時間會偏移，E26）
alter table game add column start_time_manual boolean not null default false;
