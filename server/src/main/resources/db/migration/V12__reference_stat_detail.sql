-- 選秀室與 Keeper 的完整數據欄（設計稿「選秀室 v3」更新版）：參考季補上打席、打者出賽、投手出賽、先發場次。
-- games 維持原意（打擊或投球都算的出賽數）。官網沒有打點、盜壘、中繼，所以沒有這些欄位。
alter table reference_stat
    add column pa    int not null default 0,
    add column g_bat int not null default 0,
    add column g_pit int not null default 0,
    add column gs    int not null default 0;
