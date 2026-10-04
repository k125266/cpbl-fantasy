-- 登入與加入聯盟（設計稿）：隊伍的動物頭像與代表色，同一聯盟內不可重複；舊隊伍可為 null（前端依順序配色）。
alter table fantasy_team add column icon varchar(20);
alter table fantasy_team add column color varchar(7);
create unique index fantasy_team_icon_uq on fantasy_team (league_id, icon) where icon is not null;
create unique index fantasy_team_color_uq on fantasy_team (league_id, color) where color is not null;

-- 封閉註冊（docs/decisions.md「身分與隱私」）：一般使用者建立聯盟需要系統管理員發的一次性建盟碼。
create table league_create_code (
    code       varchar(16) primary key,
    created_by bigint      not null references app_user (id),
    created_at timestamptz not null default now(),
    used_by    bigint      references app_user (id),
    used_at    timestamptz,
    league_id  bigint      references league (id),
    revoked_at timestamptz
);
