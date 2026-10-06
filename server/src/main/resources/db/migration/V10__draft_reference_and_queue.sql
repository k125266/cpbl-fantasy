-- 選秀參考數據（docs/rulebook-amendments.md「6.5 選秀參考數據」）：上一季的累計數據，只用於選秀室
-- （排名、數據欄、推薦、自動選、成績單預估），不影響計分與季中排名。只收本季 player 表裡有的球員。
create table reference_stat (
    season_year int    not null,
    player_id   bigint not null references player (id),
    games       int    not null default 0,
    ab          int    not null default 0,
    h           int    not null default 0,
    r           int    not null default 0,
    hr          int    not null default 0,
    bb          int    not null default 0,
    outs        int    not null default 0,
    p_h         int    not null default 0,
    p_bb        int    not null default 0,
    p_er        int    not null default 0,
    p_k         int    not null default 0,
    w           int    not null default 0,
    sv          int    not null default 0,
    qs          int    not null default 0,
    primary key (season_year, player_id)
);

-- 選秀候選清單（預排清單）：依 position 排序；網頁與手機同步；逾時自動選先從這裡選
create table draft_queue (
    draft_id  bigint not null references draft (id),
    team_id   bigint not null references fantasy_team (id),
    player_id bigint not null references player (id),
    position  int    not null,
    primary key (draft_id, team_id, player_id)
);
