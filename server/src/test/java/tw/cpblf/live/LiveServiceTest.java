package tw.cpblf.live;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.live.LiveService.LiveLine;
import tw.cpblf.live.LiveService.LiveView;

/** 即時頁資料：進行中用即時快照、結算後用正式數據；順序、棒次與幻想隊伍。 */
class LiveServiceTest extends IntegrationTest {

    @Autowired
    LiveService live;

    long league, myTeam, otherTeam, liveGame, finalGame, user;
    LocalDate today;

    long player(String id, String name, String team) {
        return jdbc.sql("""
                insert into player (cpbl_player_id, name, cpbl_team_code, listed_position, first_team_status)
                values (?, ?, ?, 'IF', 'ACTIVE') returning id
                """).params(id, name, team).query(Long.class).single();
    }

    long game(int sno, String home, String away, String status) {
        return jdbc.sql("""
                insert into game (season_year, kind_code, game_sno, scheduled_date, start_time, home_team_code, away_team_code,
                                  status, home_score, away_score)
                values (2026, 'A', ?, ?, ?, ?, ?, ?, ?, ?) returning id
                """).params(sno, today, Timestamp.from(clock.now()), home, away, status,
                "FINAL".equals(status) ? 5 : null, "FINAL".equals(status) ? 2 : null).query(Long.class).single();
    }

    void liveStat(long game, long player, String team, int seq, Integer slot, boolean sub, int h) {
        jdbc.sql("""
                insert into live_game_stat (game_id, player_id, team_code, batted, pa, ab, h, fetched_at, box_seq, lineup_slot,
                                            is_sub, changed_at)
                values (?, ?, ?, true, 3, 3, ?, now(), ?, ?, ?, now())
                """).params(game, player, team, h, seq, slot, sub).update();
    }

    void roster(long team, long player, String slot) {
        jdbc.sql("insert into roster_entry (team_id, player_id, slot, valid_from, acquired_via) values (?, ?, ?, ?, 'DRAFT')")
                .params(team, player, slot, today.minusDays(3)).update();
    }

    @BeforeEach
    void setUp() {
        today = clock.today();
        user = jdbc.sql("insert into app_user (username, display_name, password_hash) values ('me', '我', 'x') returning id")
                .query(Long.class).single();
        long other = jdbc.sql("insert into app_user (username, display_name, password_hash) values ('you', '你', 'x') returning id")
                .query(Long.class).single();
        league = jdbc.sql("insert into league (name, season_year, invite_code, commissioner_user_id) values ('L', 2026, 'INV', ?) returning id")
                .param(user).query(Long.class).single();
        myTeam = jdbc.sql("insert into fantasy_team (league_id, user_id, name, abbr) values (?, ?, '我的隊', 'ME') returning id")
                .params(league, user).query(Long.class).single();
        otherTeam = jdbc.sql("insert into fantasy_team (league_id, user_id, name, abbr) values (?, ?, '別隊', 'YOU') returning id")
                .params(league, other).query(Long.class).single();

        liveGame = game(1, "BRO", "UNI", "IN_PROGRESS");
        long lead = player("P1", "先發一棒", "UNI"), pinch = player("P2", "代打", "UNI"), second = player("P3", "二棒", "UNI");
        liveStat(liveGame, second, "UNI", 2, 2, false, 0);
        liveStat(liveGame, lead, "UNI", 0, 1, false, 1);
        liveStat(liveGame, pinch, "UNI", 1, 1, true, 0);
        jdbc.sql("insert into live_game (game_id, inning_text, home_score, away_score, fetched_at, batter_player_id) values (?, '五下', 1, 3, now(), ?)")
                .params(liveGame, lead).update();

        finalGame = game(2, "FUB", "RAK", "FINAL");
        long done = player("P4", "已結算", "FUB");
        liveStat(finalGame, done, "FUB", 0, 1, false, 1);
        jdbc.sql("insert into game_stat (game_id, player_id, team_code, batted, pa, ab, h) values (?, ?, 'FUB', true, 4, 4, 3)")
                .params(finalGame, done).update();

        roster(myTeam, lead, "OF");
        roster(otherTeam, done, "IF");
        roster(myTeam, player("P5", "休兵先發", "WEI"), "IF");
        roster(myTeam, player("P6", "板凳", "WEI"), "BN");
    }

    @Test
    void liveGameShowsScoreInningAndCurrentBatter() {
        LiveView v = live.view(league, user);
        var g = v.games().stream().filter(x -> x.id() == liveGame).findFirst().orElseThrow();
        assertThat(g.inning()).isEqualTo("五下");
        assertThat(g.awayScore()).isEqualTo(3);
        assertThat(g.batterId()).isNotNull();
        var f = v.games().stream().filter(x -> x.id() == finalGame).findFirst().orElseThrow();
        assertThat(f.homeScore()).isEqualTo(5);
        assertThat(f.inning()).isNull();
    }

    @Test
    void linesFollowTheBoxScoreAndUseSettledNumbersOnceFinal() {
        List<LiveLine> lines = live.view(league, user).lines();
        List<LiveLine> inProgress = lines.stream().filter(l -> l.gameId() == liveGame).toList();
        assertThat(inProgress).extracting(LiveLine::name).containsExactly("先發一棒", "代打", "二棒");
        assertThat(inProgress.get(1).sub()).isTrue();
        assertThat(inProgress.get(1).lineupSlot()).isEqualTo(1);
        assertThat(inProgress).allMatch(l -> !l.settled());

        LiveLine settled = lines.stream().filter(l -> l.gameId() == finalGame).findFirst().orElseThrow();
        assertThat(settled.settled()).isTrue();
        assertThat(settled.h()).isEqualTo(3); // 正式數據，不是即時快照的 1
        assertThat(settled.fantasyTeamId()).isEqualTo(otherTeam);
    }

    @Test
    void startersExcludeBenchAndKnowMyOpponentlessWeek() {
        LiveView v = live.view(league, user);
        assertThat(v.myTeamId()).isEqualTo(myTeam);
        assertThat(v.opponentTeamId()).isNull();
        assertThat(v.starters()).extracting(LiveService.Starter::name).contains("先發一棒", "休兵先發").doesNotContain("板凳");
    }
}
