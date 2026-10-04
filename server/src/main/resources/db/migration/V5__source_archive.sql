-- 整季封存（E12 重播）：只存 parser 輸出的白名單 record，不存原始頁面、照片或文章。
-- kind = 'game'：key 為 {year}-{kind}-{sno}，payload 為 GamePage（SourceGame + BoxScore）
-- kind = 'player'：key 為 cpbl_player_id，payload 為 SourcePlayer（含洋將判斷）
create table source_archive (
    kind       varchar(10) not null check (kind in ('game', 'player')),
    key        varchar(40) not null,
    payload    jsonb       not null,
    fetched_at timestamptz not null default now(),
    primary key (kind, key)
);
