-- CPBL Fantasy Baseball schema v1
-- 法遵（規則書 10.5 / CPBLF-73）：本 schema 不得出現任何幣別、金額、支付、訂單相關欄位或表。
-- FAAB 為聯盟內部虛擬預算，欄位一律命名為 faab_*。

-- ---------------------------------------------------------------------------
-- 使用者
-- ---------------------------------------------------------------------------
create table app_user (
    id            bigserial primary key,
    username      varchar(40)  not null unique,
    display_name  varchar(40)  not null,
    password_hash varchar(100) not null,
    is_admin      boolean      not null default false,
    created_at    timestamptz  not null default now()
);

create table user_session (
    token      varchar(64) primary key,
    user_id    bigint      not null references app_user (id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);
create index user_session_user_idx on user_session (user_id);

-- ---------------------------------------------------------------------------
-- 中職球隊（僅作事實指涉；視覺呈現由前端自訂色塊，見 CPBLF-72）
-- ---------------------------------------------------------------------------
create table cpbl_team (
    code                varchar(8)  primary key,
    name                varchar(40) not null,
    short_name          varchar(10) not null,
    source_name_pattern varchar(40) not null
);

insert into cpbl_team (code, name, short_name, source_name_pattern) values
    ('BRO', '中信兄弟',      '兄弟', '兄弟'),
    ('UNI', '統一7-ELEVEn獅', '統一', '統一'),
    ('RAK', '樂天桃猿',      '樂天', '樂天'),
    ('FUB', '富邦悍將',      '富邦', '富邦'),
    ('WEI', '味全龍',        '味全', '味全'),
    ('TSG', '台鋼雄鷹',      '台鋼', '台鋼');

-- ---------------------------------------------------------------------------
-- 球員主檔
-- registration_status 與 first_team_status 為兩個獨立維度（規則書 6.1.1）
-- ---------------------------------------------------------------------------
create table player (
    id                    bigserial   primary key,
    cpbl_player_id        varchar(20) not null unique,
    name                  varchar(40) not null,
    cpbl_team_code        varchar(8)  references cpbl_team (code),
    is_foreign            boolean     not null default false,
    listed_position       varchar(10) not null default 'UNKNOWN'
        check (listed_position in ('P', 'C', 'IF', 'OF', 'UNKNOWN')),
    registration_status   varchar(12) not null default 'REGISTERED'
        check (registration_status in ('REGISTERED', 'DELISTED')),
    first_team_status     varchar(12) not null default 'MINORS'
        check (first_team_status in ('ACTIVE', 'MINORS')),
    first_team_changed_on date,
    delisted_on           date,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);
create index player_team_idx on player (cpbl_team_code);

create table player_name_history (
    id         bigserial   primary key,
    player_id  bigint      not null references player (id),
    old_name   varchar(40) not null,
    new_name   varchar(40) not null,
    changed_at timestamptz not null default now()
);
create index player_name_history_player_idx on player_name_history (player_id);

-- 異動紀錄。DELISTED 事件由 roster maintenance job 消費（CPBLF-13 / CPBLF-34）
create table player_status_log (
    id             bigserial   primary key,
    player_id      bigint      not null references player (id),
    field          varchar(30) not null,
    old_value      varchar(40),
    new_value      varchar(40),
    effective_date date        not null,
    created_at     timestamptz not null default now()
);
create index player_status_log_player_idx on player_status_log (player_id);
create index player_status_log_date_idx on player_status_log (effective_date);

-- ---------------------------------------------------------------------------
-- 賽程
-- play_date = 實際開打日，所有計分以此歸屬（規則書 6.3）
-- ---------------------------------------------------------------------------
create table game (
    id               bigserial   primary key,
    season_year      int         not null,
    kind_code        varchar(2)  not null,
    game_sno         int         not null,
    scheduled_date   date        not null,
    actual_play_date date,
    play_date        date generated always as (coalesce(actual_play_date, scheduled_date)) stored,
    start_time       timestamptz,
    home_team_code   varchar(8)  not null references cpbl_team (code),
    away_team_code   varchar(8)  not null references cpbl_team (code),
    status           varchar(12) not null default 'SCHEDULED'
        check (status in ('SCHEDULED', 'IN_PROGRESS', 'FINAL', 'POSTPONED', 'SUSPENDED', 'CANCELLED')),
    result           varchar(10)
        check (result in ('HOME_WIN', 'AWAY_WIN', 'TIE')),
    home_score       int,
    away_score       int,
    final_seen_at    timestamptz,
    stats_final      boolean     not null default false,
    last_settled_at  timestamptz,
    last_revision_at timestamptz,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (season_year, kind_code, game_sno)
);
create index game_play_date_idx on game (play_date);
create index game_status_idx on game (status);

-- ---------------------------------------------------------------------------
-- 計分數據：唯一計分依據，僅由 settlement job 寫入（規則書 9.1）
-- 投球局數以整數 outs 儲存
-- ---------------------------------------------------------------------------
create table game_stat (
    game_id    bigint      not null references game (id),
    player_id  bigint      not null references player (id),
    team_code  varchar(8)  not null references cpbl_team (code),
    batted     boolean     not null default false,
    positions  varchar(40),
    pa         int         not null default 0,
    ab         int         not null default 0,
    r          int         not null default 0,
    h          int         not null default 0,
    hr         int         not null default 0,
    rbi        int         not null default 0,
    sb         int         not null default 0,
    bb         int         not null default 0,
    pitched    boolean     not null default false,
    started    boolean     not null default false,
    outs       int         not null default 0,
    p_h        int         not null default 0,
    p_bb       int         not null default 0,
    p_er       int         not null default 0,
    p_k        int         not null default 0,
    sv         int         not null default 0,
    hld        int         not null default 0,
    is_final   boolean     not null default false,
    revision   int         not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (game_id, player_id)
);
create index game_stat_player_idx on game_stat (player_id);

create table stat_revision_log (
    id           bigserial   primary key,
    game_id      bigint      not null references game (id),
    player_id    bigint      not null references player (id),
    old_revision int         not null,
    new_revision int         not null,
    old_values   text        not null,
    new_values   text        not null,
    created_at   timestamptz not null default now()
);
create index stat_revision_log_game_idx on stat_revision_log (game_id);
create index stat_revision_log_created_idx on stat_revision_log (created_at);

-- 即時數據：僅供介面顯示，不參與計分
create table live_game (
    game_id     bigint      primary key references game (id),
    inning_text varchar(20),
    home_score  int,
    away_score  int,
    fetched_at  timestamptz not null
);

create table live_game_stat (
    game_id    bigint      not null references game (id),
    player_id  bigint      not null references player (id),
    team_code  varchar(8)  not null,
    batted     boolean     not null default false,
    pa         int         not null default 0,
    ab         int         not null default 0,
    r          int         not null default 0,
    h          int         not null default 0,
    hr         int         not null default 0,
    rbi        int         not null default 0,
    sb         int         not null default 0,
    bb         int         not null default 0,
    pitched    boolean     not null default false,
    started    boolean     not null default false,
    outs       int         not null default 0,
    p_h        int         not null default 0,
    p_bb       int         not null default 0,
    p_er       int         not null default 0,
    p_k        int         not null default 0,
    sv         int         not null default 0,
    hld        int         not null default 0,
    fetched_at timestamptz not null,
    primary key (game_id, player_id)
);

-- ---------------------------------------------------------------------------
-- 維運
-- ---------------------------------------------------------------------------
create table job_run (
    id              bigserial   primary key,
    job_name        varchar(40) not null,
    started_at      timestamptz not null,
    finished_at     timestamptz,
    status          varchar(12) not null check (status in ('RUNNING', 'SUCCESS', 'FAILED', 'STOPPED')),
    items_processed int         not null default 0,
    revisions       int         not null default 0,
    anomalies       int         not null default 0,
    summary         text
);
create index job_run_name_idx on job_run (job_name, started_at desc);

create table alert (
    id           bigserial   primary key,
    level        varchar(8)  not null check (level in ('INFO', 'WARN', 'ERROR')),
    source       varchar(40) not null,
    message      text        not null,
    created_at   timestamptz not null default now(),
    acknowledged boolean     not null default false
);
create index alert_created_idx on alert (created_at desc);

-- ---------------------------------------------------------------------------
-- 聯盟
-- ---------------------------------------------------------------------------
create table league (
    id                        bigserial   primary key,
    name                      varchar(60) not null,
    season_year               int         not null,
    invite_code               varchar(16) not null unique,
    commissioner_user_id      bigint      not null references app_user (id),
    max_teams                 int         not null default 5,
    foreign_player_limit      int         not null default 4,
    position_min_games        int         not null default 5,
    sp_min_starts             int         not null default 3,
    eligibility_grace_days    int         not null default 21,
    faab_budget_per_half      int         not null default 100,
    slots_if                  int         not null default 4,
    slots_of                  int         not null default 3,
    slots_util                int         not null default 1,
    slots_sp                  int         not null default 4,
    slots_rp                  int         not null default 2,
    slots_bench               int         not null default 6,
    slots_na                  int         not null default 2,
    minors_return_days        int         not null default 10,
    foreign_minors_return_days int        not null default 15,
    hitter_idle_game_days     int         not null default 5,
    pitcher_idle_days         int         not null default 10,
    waiver_days               int         not null default 2,
    waiver_process_hour       int         not null default 3,
    trade_review_hours        int         not null default 24,
    matchup_lock_hours        int         not null default 48,
    keeper_limit              int         not null default 5,
    keeper_round_offset       int         not null default 2,
    draft_rounds              int         not null default 20,
    draft_pick_seconds        int         not null default 90,
    refund_faab_on_delist     boolean     not null default false,
    champion_team_id          bigint,
    champion_note             varchar(200),
    created_at                timestamptz not null default now()
);

create table fantasy_team (
    id                 bigserial   primary key,
    league_id          bigint      not null references league (id),
    user_id            bigint      not null references app_user (id),
    name               varchar(40) not null,
    abbr               varchar(6)  not null,
    faab_budget        int         not null default 100,
    lineup_lock_reason varchar(200),
    created_at         timestamptz not null default now(),
    unique (league_id, user_id)
);

alter table league add constraint league_champion_fk foreign key (champion_team_id) references fantasy_team (id);

create table notification (
    id         bigserial   primary key,
    team_id    bigint      not null references fantasy_team (id),
    message    text        not null,
    created_at timestamptz not null default now(),
    read_at    timestamptz
);
create index notification_team_idx on notification (team_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 賽季結構：scoring_period 掛在 season_half 之下（規則書 4.1 / 4.2）
-- ---------------------------------------------------------------------------
create table season_half (
    id               bigserial   primary key,
    league_id        bigint      not null references league (id),
    half_no          int         not null check (half_no in (1, 2)),
    start_date       date        not null,
    end_date         date        not null,
    status           varchar(12) not null default 'UPCOMING'
        check (status in ('UPCOMING', 'ACTIVE', 'COMPLETED')),
    champion_team_id bigint      references fantasy_team (id),
    unique (league_id, half_no)
);

create table scoring_period (
    id             bigserial   primary key,
    season_half_id bigint      not null references season_half (id),
    period_no      int         not null,
    kind           varchar(8)  not null default 'REGULAR' check (kind in ('REGULAR', 'FINAL')),
    start_date     date        not null,
    end_date       date        not null,
    status         varchar(12) not null default 'UPCOMING'
        check (status in ('UPCOMING', 'ACTIVE', 'PROVISIONAL', 'LOCKED')),
    locks_at       timestamptz,
    unique (season_half_id, period_no)
);

create table matchup (
    id                bigserial    primary key,
    scoring_period_id bigint       not null references scoring_period (id),
    team_a_id         bigint       references fantasy_team (id),
    team_b_id         bigint       references fantasy_team (id),
    score_a           numeric(4, 1),
    score_b           numeric(4, 1),
    result            varchar(8)   check (result in ('A_WIN', 'B_WIN', 'TIE')),
    status            varchar(12)  not null default 'PENDING'
        check (status in ('PENDING', 'LIVE', 'PROVISIONAL', 'LOCKED')),
    categories        text,
    note              varchar(300),
    updated_at        timestamptz  not null default now(),
    locked_at         timestamptz
);
create index matchup_period_idx on matchup (scoring_period_id);

-- ---------------------------------------------------------------------------
-- Roster：effective-dated。valid_from 含、valid_to 不含；valid_to 為 null 表示持續有效
-- ---------------------------------------------------------------------------
create table roster_entry (
    id            bigserial   primary key,
    team_id       bigint      not null references fantasy_team (id),
    player_id     bigint      not null references player (id),
    slot          varchar(4)  not null check (slot in ('IF', 'OF', 'UTIL', 'SP', 'RP', 'BN', 'NA')),
    valid_from    date        not null,
    valid_to      date,
    acquired_via  varchar(8)  not null check (acquired_via in ('DRAFT', 'KEEPER', 'WAIVER', 'FA', 'TRADE', 'MOVE')),
    faab_spent    int         not null default 0,
    created_at    timestamptz not null default now(),
    check (valid_to is null or valid_to > valid_from)
);
create index roster_entry_team_idx on roster_entry (team_id, valid_to);
create index roster_entry_player_idx on roster_entry (player_id, valid_to);

-- ---------------------------------------------------------------------------
-- Waiver / FAAB（規則書 8.1）
-- ---------------------------------------------------------------------------
create table waiver_player (
    league_id   bigint      not null references league (id),
    player_id   bigint      not null references player (id),
    released_on date        not null,
    clears_at   timestamptz not null,
    primary key (league_id, player_id)
);

create table waiver_claim (
    id             bigserial   primary key,
    league_id      bigint      not null references league (id),
    team_id        bigint      not null references fantasy_team (id),
    player_id      bigint      not null references player (id),
    drop_player_id bigint      references player (id),
    faab_bid       int         not null check (faab_bid >= 0),
    status         varchar(10) not null default 'PENDING'
        check (status in ('PENDING', 'WON', 'LOST', 'CANCELLED', 'INVALID')),
    result_note    varchar(200),
    created_at     timestamptz not null default now(),
    processed_at   timestamptz
);
create index waiver_claim_league_idx on waiver_claim (league_id, status);

-- ---------------------------------------------------------------------------
-- 交易（規則書 8.2）
-- ---------------------------------------------------------------------------
create table trade (
    id               bigserial   primary key,
    league_id        bigint      not null references league (id),
    proposer_team_id bigint      not null references fantasy_team (id),
    receiver_team_id bigint      not null references fantasy_team (id),
    status           varchar(12) not null default 'PROPOSED'
        check (status in ('PROPOSED', 'IN_REVIEW', 'REJECTED', 'CANCELLED', 'VETOED', 'COMPLETED', 'FAILED')),
    message          varchar(200),
    result_note      varchar(200),
    created_at       timestamptz not null default now(),
    accepted_at      timestamptz,
    review_ends_at   timestamptz,
    completed_at     timestamptz
);
create index trade_league_idx on trade (league_id, status);

create table trade_item (
    trade_id     bigint not null references trade (id),
    player_id    bigint not null references player (id),
    from_team_id bigint not null references fantasy_team (id),
    primary key (trade_id, player_id)
);

create table trade_vote (
    trade_id   bigint      not null references trade (id),
    team_id    bigint      not null references fantasy_team (id),
    objects    boolean     not null,
    created_at timestamptz not null default now(),
    primary key (trade_id, team_id)
);

-- ---------------------------------------------------------------------------
-- 選秀（規則書 7）
-- ---------------------------------------------------------------------------
create table draft (
    id                    bigserial   primary key,
    league_id             bigint      not null references league (id),
    season_half_id        bigint      not null references season_half (id),
    status                varchar(12) not null default 'SETUP'
        check (status in ('SETUP', 'KEEPERS', 'IN_PROGRESS', 'COMPLETED')),
    rounds                int         not null,
    pick_seconds          int         not null,
    current_pick_no       int         not null default 1,
    current_pick_deadline timestamptz,
    started_at            timestamptz,
    completed_at          timestamptz,
    unique (season_half_id)
);

create table draft_slot (
    draft_id      bigint not null references draft (id),
    team_id       bigint not null references fantasy_team (id),
    draft_position int   not null,
    primary key (draft_id, team_id),
    unique (draft_id, draft_position)
);

create table draft_pick (
    draft_id  bigint      not null references draft (id),
    pick_no   int         not null,
    round     int         not null,
    team_id   bigint      not null references fantasy_team (id),
    player_id bigint      references player (id),
    is_keeper boolean     not null default false,
    is_auto   boolean     not null default false,
    picked_at timestamptz,
    primary key (draft_id, pick_no),
    unique (draft_id, player_id)
);

create table keeper_selection (
    draft_id  bigint not null references draft (id),
    team_id   bigint not null references fantasy_team (id),
    player_id bigint not null references player (id),
    round     int    not null,
    primary key (draft_id, player_id)
);

-- ---------------------------------------------------------------------------
-- 系統設定（demo 時鐘偏移、job 停用旗標等）
-- ---------------------------------------------------------------------------
create table app_setting (
    key        varchar(60) primary key,
    value      text        not null,
    updated_at timestamptz not null default now()
);
