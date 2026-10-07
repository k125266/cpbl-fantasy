package tw.cpblf.pipeline;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.source.SourceArchive;
import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.PitcherLine;
import tw.cpblf.source.StatsSiteParsers;

/** 選秀參考季：封存的上一季 box score 彙總成 reference_stat，只收本季名單上有的球員。 */
class ReferenceSeasonTest extends IntegrationTest {

    @Autowired SourceArchive archive;
    @Autowired ReferenceSeason reference;

    @Test
    void sumsTheReferenceSeasonForCurrentPlayersOnly() {
        // 把一場真實比賽當成 2025 的第 1、2 場
        var page = StatsSiteParsers.parseGame(SeasonArchiverTest.fixture("game-2026-A-200.md"), 2025, "A", 1);
        archive.putGame(page);
        archive.putGame(StatsSiteParsers.parseGame(SeasonArchiverTest.fixture("game-2026-A-200.md"), 2025, "A", 2));
        BatterLine b = page.box().batters().get(0);
        PitcherLine sp = page.box().pitchers().stream().filter(PitcherLine::started).findFirst().orElseThrow();
        long batter = player(b.cpblPlayerId(), b.name());
        long pitcher = player(sp.cpblPlayerId(), sp.name());

        assertThat(reference.rebuild(2025)).isEqualTo(2);
        Map<String, Object> bat = jdbc.sql("""
                select games, pa, ab, h, hr, bb, g_bat, g_pit from reference_stat where season_year = 2025 and player_id = ?
                """).param(batter).query().singleRow();
        assertThat(bat).containsEntry("games", 2).containsEntry("pa", 2 * b.pa()).containsEntry("ab", 2 * b.ab())
                .containsEntry("h", 2 * b.h()).containsEntry("hr", 2 * b.hr()).containsEntry("bb", 2 * b.bb())
                .containsEntry("g_bat", 2).containsEntry("g_pit", 0);
        Map<String, Object> pit = jdbc.sql("select outs, p_k, qs, g_pit, gs from reference_stat where season_year = 2025 and player_id = ?")
                .param(pitcher).query().singleRow();
        assertThat(pit).containsEntry("outs", 2 * sp.outs()).containsEntry("p_k", 2 * sp.k())
                .containsEntry("qs", sp.outs() >= 18 && sp.er() <= 3 ? 2 : 0)
                .containsEntry("g_pit", 2).containsEntry("gs", 2);
        // 重新彙總結果一致
        assertThat(reference.rebuild(2025)).isEqualTo(2);
        assertThat(count("select count(*) from reference_stat")).isEqualTo(2);
    }

    long player(String cpblId, String name) {
        return jdbc.sql("""
                insert into player (cpbl_player_id, name, cpbl_team_code, listed_position, first_team_status)
                values (?, ?, 'BRO', 'IF', 'ACTIVE') returning id
                """).params(cpblId, name).query(Long.class).single();
    }
}
