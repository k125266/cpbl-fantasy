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

    Instant changedAt(String cpblId) {
        return jdbc.sql("""
                select s.changed_at from live_game_stat s join player p on p.id = s.player_id where p.cpbl_player_id = ?
                """).param(cpblId).query(Timestamp.class).single().toInstant();
    }
}
