package tw.cpblf.live;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.LocalDate;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.live.PostseasonService.PostseasonView;
import tw.cpblf.live.PostseasonService.SeriesView;

/** 季後賽專區：系列戰勝場（含保送）、晉級判定、只收季後賽、各場球員數據與名單標記。 */
class PostseasonServiceTest extends IntegrationTest {

    @Autowired
    PostseasonService postseason;

    long league, myTeam, user;
    LocalDate today;

    long game(String kind, int sno, int dayOffset, String home, String away, String status, Integer hs, Integer as) {
        return jdbc.sql("""
                insert into game (season_year, kind_code, game_sno, scheduled_date, start_time, home_team_code, away_team_code,
                                  status, home_score, away_score)
                values (2026, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id
                """).params(kind, sno, today.plusDays(dayOffset), Timestamp.from(clock.now().plusSeconds(dayOffset * 86400L)),
                home, away, status, hs, as).query(Long.class).single();
    }

    long player(String id, String name, String team) {
        return jdbc.sql("""
                insert into player (cpbl_player_id, name, cpbl_team_code, listed_position, first_team_status)
                values (?, ?, ?, 'IF', 'ACTIVE') returning id
                """).params(id, name, team).query(Long.class).single();
    }

    void liveStat(long game, long player, String team, int seq, int h) {
        jdbc.sql("""
                insert into live_game_stat (game_id, player_id, team_code, batted, pa, ab, h, fetched_at, box_seq, lineup_slot,
                                            is_sub)
                values (?, ?, ?, true, 4, 4, ?, now(), ?, ?, false)
                """).params(game, player, team, h, seq, seq + 1).update();
    }

    @BeforeEach
    void setUp() {
        today = clock.today();
        user = jdbc.sql("insert into app_user (username, display_name, password_hash) values ('me', '我', 'x') returning id")
                .query(Long.class).single();
        league = jdbc.sql("insert into league (name, season_year, invite_code, commissioner_user_id) values ('L', 2026, 'INV', ?) returning id")
                .param(user).query(Long.class).single();
        myTeam = jdbc.sql("insert into fantasy_team (league_id, user_id, name, abbr) values (?, ?, '我的隊', 'ME') returning id")
                .params(league, user).query(Long.class).single();
    }

    SeriesView challenge() {
        PostseasonView v = postseason.view(league, user);
        return v.series().stream().filter(s -> s.kind().equals("E")).findFirst().orElseThrow();
    }

    @Test
    void advantageTeamStartsWithOneWinAndFinishedGamesAreCounted() {
        game("E", 1, -2, "BRO", "UNI", "FINAL", 5, 3); // 兄弟勝
        game("E", 2, -1, "UNI", "BRO", "FINAL", 4, 2); // 統一勝
        game("E", 3, 0, "BRO", "UNI", "IN_PROGRESS", 1, 0); // 進行中不算

        SeriesView s = challenge();
        assertThat(s.name()).isEqualTo("季後挑戰賽");
        assertThat(s.winsNeeded()).isEqualTo(3);
        assertThat(s.teams()).containsExactly("UNI", "BRO"); // 第一場的客隊、主隊
        assertThat(s.wins()).containsEntry("BRO", 2).containsEntry("UNI", 1); // 兄弟：保送 1 勝＋第 1 戰
        assertThat(s.winner()).isNull();
        assertThat(s.games()).hasSize(3);
    }

    @Test
    void seriesIsDecidedWhenATeamReachesTheWinsNeeded() {
        game("E", 1, -2, "BRO", "UNI", "FINAL", 5, 3); // 兄弟：保送 1＋1
        game("E", 2, -1, "UNI", "BRO", "FINAL", 2, 6); // 兄弟再勝，3 勝
        game("E", 3, 0, "BRO", "UNI", "SCHEDULED", null, null);

        SeriesView s = challenge();
        assertThat(s.wins()).containsEntry("BRO", 3).containsEntry("UNI", 0);
        assertThat(s.winner()).isEqualTo("BRO");
    }

    @Test
    void tiesAndPostponedGamesAreNotWins() {
        game("E", 1, -2, "BRO", "UNI", "FINAL", 3, 3);
        game("E", 2, -1, "UNI", "BRO", "POSTPONED", null, null);

        assertThat(challenge().wins()).containsEntry("BRO", 1).containsEntry("UNI", 0);
    }

    @Test
    void taiwanSeriesHasNoAdvantageAndNeedsFourWins() {
        game("C", 1, -1, "UNI", "BRO", "FINAL", 3, 1);

        SeriesView s = postseason.view(league, user).series().stream().filter(x -> x.kind().equals("C")).findFirst().orElseThrow();
        assertThat(s.name()).isEqualTo("台灣大賽");
        assertThat(s.winsNeeded()).isEqualTo(4);
        assertThat(s.advantageTeam()).isNull();
        assertThat(s.wins()).containsEntry("UNI", 1).containsEntry("BRO", 0);
    }

    @Test
    void regularSeasonGamesAreNotInThePostseasonView() {
        game("A", 901, 0, "BRO", "UNI", "FINAL", 3, 1);
        assertThat(postseason.view(league, user).series()).isEmpty();

        game("E", 1, 0, "BRO", "UNI", "SCHEDULED", null, null);
        assertThat(postseason.view(league, user).series()).extracting(SeriesView::kind).containsExactly("E");
    }

    @Test
    void linesCoverEveryGameAndMarkMyPlayersByTodaysRoster() {
        long g1 = game("E", 1, -1, "BRO", "UNI", "FINAL", 5, 3);
        long g2 = game("E", 2, 0, "UNI", "BRO", "IN_PROGRESS", 1, 0);
        long mine = player("P1", "我的打者", "UNI"), other = player("P2", "別人的打者", "BRO");
        liveStat(g1, mine, "UNI", 0, 2);
        liveStat(g1, other, "BRO", 0, 1);
        liveStat(g2, mine, "UNI", 0, 1);
        jdbc.sql("insert into roster_entry (team_id, player_id, slot, valid_from, acquired_via) values (?, ?, 'OF', ?, 'DRAFT')")
                .params(myTeam, mine, today.minusDays(10)).update();

        PostseasonView v = postseason.view(league, user);
        assertThat(v.myTeamId()).isEqualTo(myTeam);
        SeriesView s = v.series().get(0);
        assertThat(s.lines()).hasSize(3);
        assertThat(s.lines()).filteredOn(l -> l.playerId() == mine).hasSize(2).allMatch(l -> l.fantasyTeamId() == myTeam);
        assertThat(s.lines()).filteredOn(l -> l.playerId() == other).allMatch(l -> l.fantasyTeamId() == null);
        assertThat(s.lines()).allMatch(l -> !l.settled());
        assertThat(s.lines()).extracting(l -> l.gameId()).contains(g1, g2);
    }

    @Test
    void gameDayRosterIsSeparateFromTodaysRoster() {
        long g1 = game("E", 1, -1, "BRO", "UNI", "FINAL", 5, 3); // 昨天
        long g2 = game("E", 2, 0, "UNI", "BRO", "FINAL", 4, 2); // 今天
        long late = player("P9", "後來才加入", "UNI");
        liveStat(g1, late, "UNI", 0, 2);
        liveStat(g2, late, "UNI", 0, 2);
        // 今天才進名單：昨天那場當天不在名單上，今天這場在
        jdbc.sql("insert into roster_entry (team_id, player_id, slot, valid_from, acquired_via) values (?, ?, 'OF', ?, 'WAIVER')")
                .params(myTeam, late, today).update();

        var lines = postseason.view(league, user).series().get(0).lines();
        var yesterday = lines.stream().filter(l -> l.gameId() == g1).findFirst().orElseThrow();
        var todayLine = lines.stream().filter(l -> l.gameId() == g2).findFirst().orElseThrow();
        assertThat(yesterday.fantasyTeamId()).isEqualTo(myTeam);
        assertThat(yesterday.gameDayTeamId()).isNull();
        assertThat(todayLine.gameDayTeamId()).isEqualTo(myTeam);
    }
}
