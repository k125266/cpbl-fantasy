-- 聯盟內週 MVP（收藏卡成就印章與卡片履歷用，docs/decisions.md「收藏卡」）。
-- 每週（一～日）各選一位打者（H）與投手（P）；由每日維護重算，可重複執行。
create table weekly_mvp (
    league_id  bigint       not null references league (id),
    week_start date         not null,
    kind       char(1)      not null check (kind in ('H', 'P')),
    player_id  bigint       not null references player (id),
    score      numeric(8,2) not null,
    primary key (league_id, week_start, kind)
);
create index weekly_mvp_player_idx on weekly_mvp (league_id, player_id);
