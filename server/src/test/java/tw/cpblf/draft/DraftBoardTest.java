package tw.cpblf.draft;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Comparator;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.demo.DemoSeeder;
import tw.cpblf.draft.DraftBoardService.BoardPlayer;
import tw.cpblf.draft.DraftBoardService.Need;

/** 選秀室資料：依選秀排名的可選球員、推薦（補缺位前 3）、先發缺位。 */
class DraftBoardTest extends IntegrationTest {

    @Autowired DemoSeeder seeder;
    @Autowired DraftService drafts;
    @Autowired DraftBoardService board;

    @Test
    void availablePlayersComeRankedWithNeedsAndRecommendations() {
        long league = seeder.seed();
        long d = jdbc.sql("select id from draft where league_id = ?").param(league).query(Long.class).single();
        drafts.start(d);
        long team = drafts.view(d, null).currentTeamId();

        var b = board.board(d, team);
        assertThat(b.basis()).isEqualTo("本季");
        assertThat(b.players()).isSortedAccordingTo(Comparator.comparingInt((BoardPlayer p) -> p.rank() == null ? Integer.MAX_VALUE : p.rank()));
        assertThat(b.players().stream().filter(BoardPlayer::recommended)).hasSizeLessThanOrEqualTo(3).allMatch(BoardPlayer::fillsNeed);
        assertThat(b.needs()).extracting(Need::slot).containsExactly("IF", "OF", "UTIL", "SP", "RP");
        assertThat(b.needs()).allMatch(n -> n.filled() == 0 && n.max() > 0);

        long first = b.players().stream().filter(BoardPlayer::fillsNeed).findFirst().orElseThrow().playerId();
        drafts.pick(d, team, first);
        var after = board.board(d, team);
        assertThat(after.players()).noneMatch(p -> p.playerId() == first);
        assertThat(after.needs().stream().mapToInt(Need::filled).sum()).isEqualTo(1);

        // 選完後的成績單：每類別依名次給 n..1 分，總分合計固定；我的關鍵順位兩筆
        while (drafts.inProgress(d)) {
            drafts.autoPick(d);
        }
        var r = board.report(d, team);
        int n = r.teams().size();
        assertThat(r.teams().stream().mapToInt(DraftBoardService.TeamReport::points).sum()).isEqualTo(10 * n * (n + 1) / 2);
        assertThat(r.maxPoints()).isEqualTo(10 * n);
        assertThat(r.teams()).allSatisfy(t -> assertThat(t.grade()).isNotBlank());
        assertThat(r.highlights()).extracting(DraftBoardService.Highlight::kind).containsExactly("BEST_VALUE", "BOLDEST_REACH");
    }
}
