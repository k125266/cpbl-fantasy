package tw.cpblf.draft;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;

/** 選秀排名：上半季用參考季（上一季），下半季用當季；季中排名不受參考季影響。 */
class DraftRankingTest extends IntegrationTest {

    @Autowired PlayerRankingService ranking;

    long player(String id, String name) {
        return jdbc.sql("""
                insert into player (cpbl_player_id, name, cpbl_team_code, listed_position, first_team_status)
                values (?, ?, 'BRO', 'IF', 'ACTIVE') returning id
                """).params(id, name).query(Long.class).single();
    }

    void reference(long player, int ab, int h, int hr) {
        jdbc.sql("insert into reference_stat (season_year, player_id, games, ab, h, r, hr, bb) values (2025, ?, 100, ?, ?, ?, ?, 20)")
                .params(player, ab, h, h / 3, hr).update();
    }

    @Test
    void firstHalfDraftRanksByTheReferenceSeason() {
        long a = player("A", "甲"), b = player("B", "乙"), c = player("C", "丙");
        reference(c, 400, 130, 25); // 參考季最好
        reference(a, 400, 90, 3);

        var basis = ranking.draftBasis(1);
        assertThat(basis.label()).isEqualTo("2025");
        assertThat(basis.ranks().get(c).rank()).isEqualTo(1);
        assertThat(basis.lines().get(c).hr()).isEqualTo(25);
        assertThat(basis.ranks().get(b).rank()).isEqualTo(3); // 沒有參考數據排最後

        // 下半季與季中排名都只看當季（目前沒有數據：全部 0 分，依姓名）
        assertThat(ranking.draftBasis(2).label()).isEqualTo("本季");
        assertThat(ranking.rankings().get(c).score()).isZero();
    }

    @Test
    void withoutAReferenceSeasonTheFirstHalfFallsBackToTheCurrentSeason() {
        player("A", "甲");
        assertThat(ranking.draftBasis(1).label()).isEqualTo("本季");
    }
}
