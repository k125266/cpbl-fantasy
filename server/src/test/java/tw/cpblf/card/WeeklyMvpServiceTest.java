package tw.cpblf.card;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.OffsetDateTime;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;

class WeeklyMvpServiceTest extends IntegrationTest {

    static final LocalDate MON = LocalDate.of(2026, 3, 30);

    @Autowired
    WeeklyMvpService mvp;

    long league, teamA, teamB, game;

    long player(String id, String name) {
        return jdbc.sql("insert into player (cpbl_player_id, name, cpbl_team_code, first_team_status) values (?, ?, 'BRO', 'ACTIVE') returning id")
                .params(id, name).query(Long.class).single();
    }

    void roster(long team, long player, LocalDate from, LocalDate to) {
        jdbc.sql("insert into roster_entry (team_id, player_id, slot, valid_from, valid_to, acquired_via) values (?, ?, 'BN', ?, ?, 'DRAFT')")
                .params(team, player, from, to).update();
    }

    void bat(long player, int h, int hr, int r, int bb) {
        jdbc.sql("insert into game_stat (game_id, player_id, team_code, batted, pa, ab, h, hr, r, bb) values (?, ?, 'BRO', true, 4, 4, ?, ?, ?, ?)")
                .params(game, player, h, hr, r, bb).update();
    }

    void pitch(long player, int outs, int er, int k, int w, int sv) {
        jdbc.sql("insert into game_stat (game_id, player_id, team_code, pitched, outs, p_er, p_k, w, sv) values (?, ?, 'BRO', true, ?, ?, ?, ?, ?)")
                .params(game, player, outs, er, k, w, sv).update();
    }

    @BeforeEach
    void league() {
        long user = jdbc.sql("insert into app_user (username, display_name, password_hash) values ('u', 'U', 'x') returning id")
                .query(Long.class).single();
        league = jdbc.sql("insert into league (name, season_year, invite_code, commissioner_user_id) values ('L', 2026, 'INV', ?) returning id")
                .param(user).query(Long.class).single();
        teamA = jdbc.sql("insert into fantasy_team (league_id, user_id, name, abbr) values (?, ?, '甲隊', 'A') returning id")
                .params(league, user).query(Long.class).single();
        long user2 = jdbc.sql("insert into app_user (username, display_name, password_hash) values ('v', 'V', 'x') returning id")
                .query(Long.class).single();
        teamB = jdbc.sql("insert into fantasy_team (league_id, user_id, name, abbr) values (?, ?, '乙隊', 'B') returning id")
                .params(league, user2).query(Long.class).single();
        jdbc.sql("insert into season_half (league_id, half_no, start_date, end_date) values (?, 1, ?, ?)")
                .params(league, MON.plusDays(1), MON.plusDays(90)).update();
        game = jdbc.sql("""
                insert into game (season_year, kind_code, game_sno, scheduled_date, home_team_code, away_team_code, status)
                values (2026, 'A', 1, ?, 'BRO', 'UNI', 'FINAL') returning id
                """).param(MON.plusDays(2)).query(Long.class).single();
        // 第 1 週（3/30–4/5）結束後的週二
        clock.setNow(OffsetDateTime.parse("2026-04-07T06:00:00+08:00").toInstant());
    }

    @Test
    void picksTheBestRosteredHitterAndPitcherOfTheWeek() {
        long a = player("A", "甲打者"), b = player("B", "乙打者"), fa = player("F", "自由球員"), p = player("P", "甲投手");
        roster(teamA, a, MON.minusDays(5), null);
        roster(teamB, b, MON.minusDays(5), null);
        roster(teamA, p, MON.minusDays(5), null);
        bat(a, 2, 1, 1, 0);   // 1 + 2 + 2 = 5
        bat(b, 3, 0, 2, 1);   // 2 + 3 + 1 = 6
        bat(fa, 4, 2, 3, 2);  // 不在任何名單上，不列入
        pitch(p, 21, 1, 9, 1, 0);

        assertThat(mvp.refresh(league)).isEqualTo(1);

        var hit = mvp.forPlayer(league, b);
        assertThat(hit).singleElement().satisfies(m -> {
            assertThat(m.kind()).isEqualTo("H");
            assertThat(m.weekStart()).isEqualTo(MON);
            assertThat(m.weekNo()).isEqualTo(1);
        });
        assertThat(mvp.forPlayer(league, p)).extracting(WeeklyMvpService.Mvp::kind).containsExactly("P");
        assertThat(mvp.forPlayer(league, fa)).isEmpty();
        assertThat(mvp.forPlayer(league, a)).isEmpty();
    }

    @Test
    void playerReleasedBeforeTheWeekDoesNotCount() {
        long gone = player("G", "已釋出"), stay = player("S", "留隊");
        roster(teamA, gone, MON.minusDays(10), MON.minusDays(1));
        roster(teamA, stay, MON.minusDays(10), null);
        bat(gone, 4, 2, 3, 2);
        bat(stay, 1, 0, 0, 0);

        mvp.refresh(league);

        assertThat(mvp.forPlayer(league, gone)).isEmpty();
        assertThat(mvp.forPlayer(league, stay)).hasSize(1);
    }

    @Test
    void refreshIsIdempotent() {
        long a = player("A", "甲打者");
        roster(teamA, a, MON.minusDays(5), null);
        bat(a, 2, 1, 1, 0);
        for (int i = 0; i < 5; i++) {
            mvp.refresh(league);
        }
        assertThat(count("select count(*) from weekly_mvp where league_id = ?", league)).isEqualTo(1);
        // 沒有投手出賽的週不產生投手 MVP
        assertThat(count("select count(*) from weekly_mvp where league_id = ? and kind = 'P'", league)).isZero();
    }

    @Test
    void incompleteWeekIsNotComputed() {
        clock.setNow(OffsetDateTime.parse("2026-04-05T22:00:00+08:00").toInstant());
        long a = player("A", "甲打者");
        roster(teamA, a, MON.minusDays(5), null);
        bat(a, 2, 1, 1, 0);
        assertThat(mvp.refresh(league)).isZero();
    }
}
