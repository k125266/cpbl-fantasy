package tw.cpblf.pipeline;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import tw.cpblf.IntegrationTest;
import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.PitcherLine;

/** CPBLF-14 的 AC。 */
class SettlementJobTest extends IntegrationTest {

    @Autowired
    SettlementJob settlement;
    @Autowired
    TransactionTemplate tx;

    long gameId;
    SettlementJob.GameRef ref;

    @BeforeEach
    void setUpGame() {
        jdbc.sql("""
                insert into player (cpbl_player_id, name, cpbl_team_code, listed_position, first_team_status)
                values ('P1', '打者甲', 'BRO', 'IF', 'ACTIVE'), ('P2', '投手乙', 'FUB', 'P', 'ACTIVE')
                """).update();
        Instant finalSeen = clock.now();
        gameId = jdbc.sql("""
                insert into game (season_year, kind_code, game_sno, scheduled_date, home_team_code, away_team_code, status, final_seen_at)
                values (2026, 'A', 1, '2026-03-28', 'BRO', 'FUB', 'FINAL', ?) returning id
                """).param(Timestamp.from(finalSeen)).query(Long.class).single();
        ref = new SettlementJob.GameRef(gameId, 2026, "A", 1, "BRO", "FUB", LocalDate.of(2026, 3, 28), finalSeen, null, null);
    }

    BoxScore box(int hits) {
        return new BoxScore(GameStatus.FINAL, null, 1, 0,
                List.of(new BatterLine("P1", "打者甲", true, "SS", 4, 4, 1, hits, 1, 1, 0, 0)),
                List.of(new PitcherLine("P2", "投手乙", false, true, 19, 7, 2, 3, 6, 0, 0, 0)));
    }

    SettlementJob.GameResult apply(BoxScore b) {
        return tx.execute(s -> settlement.apply(currentRef(), b));
    }

    SettlementJob.GameRef currentRef() {
        return jdbc.sql("select last_settled_at, last_revision_at from game where id = ?").param(gameId)
                .query((rs, n) -> new SettlementJob.GameRef(gameId, 2026, "A", 1, "BRO", "FUB", LocalDate.of(2026, 3, 28),
                        ref.finalSeenAt(), ts(rs.getTimestamp(1)), ts(rs.getTimestamp(2)))).single();
    }

    static Instant ts(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    List<Map<String, Object>> snapshot() {
        return jdbc.sql("select * from game_stat where game_id = ? order by player_id").param(gameId).query().listOfRows();
    }

    @Test
    void rerunningOneHundredTimesIsIdempotent() {
        SettlementJob.GameResult first = apply(box(2));
        assertThat(first.inserted()).isEqualTo(2);
        List<Map<String, Object>> before = snapshot();
        assertThat(before).allSatisfy(r -> assertThat(r.get("revision")).isEqualTo(1));

        List<SettlementJob.GameResult> results = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            clock.setNow(clock.now().plusSeconds(60));
            results.add(apply(box(2)));
        }
        assertThat(results).allSatisfy(r -> {
            assertThat(r.inserted()).isZero();
            assertThat(r.revised()).isZero();
            assertThat(r.unchanged()).isEqualTo(2);
        });
        // 數值相同時跳過，且不更新 updated_at
        assertThat(snapshot()).isEqualTo(before);
        assertThat(count("select count(*) from stat_revision_log")).isZero();
    }

    @Test
    void changedValuesOverwriteSameRowAndLogRevision() {
        apply(box(2));
        clock.setNow(clock.now().plusSeconds(3600));
        SettlementJob.GameResult r = apply(box(1)); // 安打改判失誤
        assertThat(r.revised()).isEqualTo(1);
        assertThat(count("select count(*) from game_stat where game_id = ?", gameId)).isEqualTo(2);
        assertThat(jdbc.sql("select h || ':' || revision from game_stat gs join player p on p.id = gs.player_id where p.cpbl_player_id = 'P1'")
                .query(String.class).single()).isEqualTo("1:2");
        String log = jdbc.sql("select old_values || ' => ' || new_values from stat_revision_log").query(String.class).single();
        assertThat(log).contains("\"h\":2").contains("\"h\":1");
        // 修正後重跑仍穩定
        assertThat(apply(box(1)).revised()).isZero();
    }

    @Test
    void unknownPlayerAbortsTheGameAndWritesNothing() {
        BoxScore bad = new BoxScore(GameStatus.FINAL, null, 0, 0,
                List.of(new BatterLine("P1", "打者甲", true, "SS", 4, 4, 0, 1, 0, 0, 0, 0),
                        new BatterLine("NOPE", "未知", true, "C", 3, 3, 0, 0, 0, 0, 0, 0)),
                List.of());
        assertThatThrownBy(() -> apply(bad)).isInstanceOf(BoxScoreMapper.UnknownPlayerException.class);
        assertThat(count("select count(*) from game_stat")).isZero();
    }

    @Test
    void finalOnlyAfter24QuietHours() {
        apply(box(2));
        clock.setNow(clock.now().plus(Duration.ofHours(23)));
        assertThat(apply(box(2)).becameFinal()).isFalse();
        clock.setNow(clock.now().plus(Duration.ofHours(2)));
        assertThat(apply(box(2)).becameFinal()).isTrue();
        assertThat(count("select count(*) from game_stat where is_final")).isEqualTo(2);
        assertThat(count("select count(*) from game where stats_final")).isEqualTo(1);
    }

    @Test
    void ignoresGamesThatAreNotFinal() {
        jdbc.sql("update game set status = 'IN_PROGRESS' where id = ?").param(gameId).update();
        assertThat(settlement.dueGames()).isEmpty();
    }
}
