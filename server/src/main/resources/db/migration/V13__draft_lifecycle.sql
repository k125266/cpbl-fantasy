-- 選秀流程照 Yahoo「Live Standard Draft」改為時間驅動（docs/decisions.md「選秀與 keeper」）：
-- 選秀時間 T 前 30 分鐘開放選秀室、前 10 分鐘自動揭曉、T 自動開始。選秀中聯盟管理員可以暫停／繼續。
alter table draft drop constraint draft_status_check;
alter table draft add constraint draft_status_check
    check (status in ('SETUP', 'KEEPERS', 'IN_PROGRESS', 'PAUSED', 'COMPLETED'));
-- 暫停時這一手剩下的毫秒；繼續時截止時間 = 現在 + 剩餘
alter table draft add column paused_remaining_ms int;
