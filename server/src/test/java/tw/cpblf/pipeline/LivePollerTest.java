package tw.cpblf.pipeline;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import tw.cpblf.IntegrationTest;
import tw.cpblf.source.CpblDataSource;
import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.GameDetail;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.LineScore;
import tw.cpblf.source.SourceModels.PitcherLine;
import tw.cpblf.source.SourceModels.PlateAppearance;

/** 即時輪詢：賽況細節落地、「剛更新」時間、頁面顯示結束時立即轉 FINAL。 */
class LivePollerTest extends IntegrationTest {

    @MockitoBean
    CpblDataSource source;
    @Autowired
    LivePoller poller;

    long gameId;
    Instant start;

    @BeforeEach
    void setUpGame() {
        jdbc.sql("""
                insert into player (cpbl_player_id, name, cpbl_team_code, listed_position, first_team_status)
                values ('P1', '先發打者', 'BRO', 'IF', 'ACTIVE'), ('P3', '代打', 'BRO', 'IF', 'ACTIVE'),
                       ('P2', '投手乙', 'FUB', 'P', 'ACTIVE')
                """).update();
        start = clock.now().minus(Duration.ofHours(1));
        gameId = jdbc.sql("""
                insert into game (season_year, kind_code, game_sno, scheduled_date, start_time, home_team_code, away_team_code, status)
                values (2026, 'A', 1, '2026-03-20', ?, 'BRO', 'FUB', 'IN_PROGRESS') returning id
                """).param(Timestamp.from(start)).query(Long.class).single();
        when(source.fetchSchedule(anyInt(), anyString())).thenReturn(List.of());
    }

    BoxScore box(GameStatus status, int hits) {
        GameDetail detail = new GameDetail(
                new LineScore(Arrays.asList(0, 0, null), Arrays.asList(1, 0, null), List.of(0, 3, 0), List.of(1, hits, 0)),
                status == GameStatus.IN_PROGRESS ? "P1" : null, status == GameStatus.IN_PROGRESS ? "P2" : null,
                status == GameStatus.IN_PROGRESS ? 42 : null, List.of("三振"),
                List.of(new PlateAppearance("7", "先發打者", null)));
        return new BoxScore(status, status == GameStatus.IN_PROGRESS ? "三上" : null, 1, 0,
                List.of(new BatterLine("P1", "先發打者", true, "", 2, 2, 1, hits, 0, 0, 0, 0, 1, false),
                        new BatterLine("P3", "代打", true, "", 1, 1, 0, 0, 0, 0, 0, 0, 1, true)),
                List.of(new PitcherLine("P2", "投手乙", false, true, 7, 3, 0, 1, 2, 0, 0, 0)),
                detail);
    }

    void poll() {
        poller.poll(new JobRunner.JobContext());
    }

    @Test
    void storesLiveStateAndLineupSlots() {
        when(source.fetchBoxScore(2026, "A", 1)).thenReturn(box(GameStatus.IN_PROGRESS, 1));
        poll();

        assertThat(jdbc.sql("select inning_text from live_game where game_id = ?").param(gameId).query(String.class).single())
                .isEqualTo("三上");
        assertThat(count("""
                select count(*) from live_game l join player b on b.id = l.batter_player_id join player p on p.id = l.pitcher_player_id
                where l.game_id = ? and b.cpbl_player_id = 'P1' and p.cpbl_player_id = 'P2' and l.pitch_count = 42
                """, gameId)).isEqualTo(1);
        assertThat(jdbc.sql("select line_score ->> 'homeRhe' from live_game where game_id = ?").param(gameId)
                .query(String.class).single()).isEqualTo("[1, 1, 0]");
        assertThat(count("""
                select count(*) from live_game_stat s join player p on p.id = s.player_id
                where p.cpbl_player_id = 'P3' and s.lineup_slot = 1 and s.is_sub
                """)).isEqualTo(1);
    }

    @Test
    void changedAtMovesOnlyWhenNumbersChange() {
        when(source.fetchBoxScore(2026, "A", 1)).thenReturn(box(GameStatus.IN_PROGRESS, 1));
        poll();
        Instant batter = changedAt("P1"), pitcher = changedAt("P2");

        // 下一輪數字沒變：維持原本的時間
        clock.setNow(clock.now().plusSeconds(60));
        poll();
        assertThat(changedAt("P1")).isEqualTo(batter);

        // 打者多一支安打：只有打者更新
        clock.setNow(clock.now().plusSeconds(60));
        when(source.fetchBoxScore(2026, "A", 1)).thenReturn(box(GameStatus.IN_PROGRESS, 2));
        poll();
        assertThat(changedAt("P1")).isAfter(batter.plusSeconds(100));
        assertThat(changedAt("P2")).isEqualTo(pitcher);
    }

    @Test
    void finishedPageMarksTheGameFinalRightAway() {
        when(source.fetchBoxScore(2026, "A", 1)).thenReturn(box(GameStatus.FINAL, 1));
        poll();

        assertThat(jdbc.sql("select status || ' ' || result || ' ' || home_score || ':' || away_score from game where id = ?")
                .param(gameId).query(String.class).single()).isEqualTo("FINAL HOME_WIN 1:0");
        assertThat(count("select count(*) from game where id = ? and final_seen_at is not null", gameId)).isEqualTo(1);
        // 已結束就不在比賽時段內，不再輪詢
        assertThat(poller.gamesInWindow()).isEmpty();
    }

    /** 季後賽被賽程更新先標成 FINAL：沒有結算會重抓，所以要補抓一次最終 box score，抓完就不再抓。 */
    @Test
    void postseasonGameMarkedFinalByScheduleGetsOneFinalFetch() {
        long e = jdbc.sql("""
                insert into game (season_year, kind_code, game_sno, scheduled_date, start_time, home_team_code, away_team_code,
                                  status, home_score, away_score, final_seen_at)
                values (2026, 'E', 1, '2026-03-20', ?, 'BRO', 'FUB', 'FINAL', 1, 0, ?) returning id
                """).params(Timestamp.from(start), Timestamp.from(clock.now())).query(Long.class).single();
        jdbc.sql("update game set status = 'FINAL', result = 'HOME_WIN', final_seen_at = ? where id = ?")
                .params(Timestamp.from(clock.now()), gameId).update();
        // 例行賽那場也是 FINAL：不補抓
        assertThat(poller.gamesInWindow()).extracting(g -> g.id()).containsExactly(e);

        when(source.fetchBoxScore(2026, "E", 1)).thenReturn(box(GameStatus.FINAL, 1));
        poll();
        assertThat(count("select count(*) from live_game_stat where game_id = ?", e)).isEqualTo(3);
        assertThat(poller.gamesInWindow()).isEmpty();
    }

    @Test
    void postseasonGameFinishedByThePollerIsNotFetchedAgain() {
        jdbc.sql("update game set kind_code = 'E' where id = ?").param(gameId).update();
        when(source.fetchBoxScore(2026, "E", 1)).thenReturn(box(GameStatus.FINAL, 1));
        poll();

        assertThat(poller.gamesInWindow()).isEmpty();
    }

    // ---- 比賽日（E26）：表定開賽時間不準時也不能漏抓 ----

    long todayGame(int sno, Instant scheduledStart) {
        return jdbc.sql("""
                insert into game (season_year, kind_code, game_sno, scheduled_date, start_time, home_team_code, away_team_code, status)
                values (2026, 'E', ?, ?, ?, 'BRO', 'FUB', 'SCHEDULED') returning id
                """).params(sno, java.sql.Date.valueOf(clock.today()), Timestamp.from(scheduledStart)).query(Long.class).single();
    }

    BoxScore notStarted() {
        return new BoxScore(GameStatus.SCHEDULED, null, null, null, List.of(), List.of(), null);
    }

    @Test
    void gameThatStartedEarlierThanScheduledIsCaughtAndItsStartTimeLearned() {
        clock.setNow(clock.at(clock.today(), 15));
        jdbc.sql("delete from game where id = ?").param(gameId).update();
        // 表定時間（預設猜晚了）還有 3 小時，但比賽頁已經開打
        Instant before = clock.now();
        long g = todayGame(7, clock.now().plus(Duration.ofHours(3)));
        assertThat(poller.gamesInWindow()).extracting(x -> x.id()).containsExactly(g);
        when(source.fetchBoxScore(2026, "E", 7)).thenReturn(box(GameStatus.IN_PROGRESS, 2));
        poll();

        assertThat(count("select count(*) from live_game where game_id = ?", g)).isEqualTo(1);
        assertThat(jdbc.sql("select status from game where id = ?").param(g).query(String.class).single()).isEqualTo("IN_PROGRESS");
        Instant learned = jdbc.sql("select start_time from game where id = ?").param(g).query(Timestamp.class).single().toInstant();
        assertThat(learned).isBetween(before, clock.now());
    }

    @Test
    void earlyGameDayChecksAreSpacedTenMinutesApart() {
        clock.setNow(clock.at(clock.today(), 13));
        jdbc.sql("delete from game where id = ?").param(gameId).update();
        todayGame(8, clock.now().plus(Duration.ofHours(4)));
        when(source.fetchBoxScore(2026, "E", 8)).thenReturn(notStarted());

        poll();
        clock.setNow(clock.now().plus(Duration.ofMinutes(5)));
        poll();
        org.mockito.Mockito.verify(source, org.mockito.Mockito.times(1)).fetchBoxScore(2026, "E", 8);
        clock.setNow(clock.now().plus(Duration.ofMinutes(6)));
        poll();
        org.mockito.Mockito.verify(source, org.mockito.Mockito.times(2)).fetchBoxScore(2026, "E", 8);
        // 還沒開打：沒有寫任何即時資料
        assertThat(count("select count(*) from live_game")).isZero();
    }

    @Test
    void noGameDayPollingBeforeNoonOrOnOtherDays() {
        jdbc.sql("delete from game where id = ?").param(gameId).update();
        clock.setNow(clock.at(clock.today(), 9));
        long g = todayGame(9, clock.now().plus(Duration.ofHours(8)));
        assertThat(poller.gamesInWindow()).isEmpty();

        clock.setNow(clock.at(clock.today(), 12));
        assertThat(poller.gamesInWindow()).extracting(x -> x.id()).containsExactly(g);

        jdbc.sql("update game set scheduled_date = ? where id = ?").params(java.sql.Date.valueOf(clock.today().plusDays(1)), g).update();
        assertThat(poller.gamesInWindow()).isEmpty();
    }

    Instant changedAt(String cpblId) {
        return jdbc.sql("""
                select s.changed_at from live_game_stat s join player p on p.id = s.player_id where p.cpbl_player_id = ?
                """).param(cpblId).query(Timestamp.class).single().toInstant();
    }
}
