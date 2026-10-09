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

        // 上半季、開季前、沒有參考季封存：期間只能看本季（還沒有數據），預設本季
        assertThat(b.periods()).extracting(DraftBoardService.PeriodView::key).containsExactly("REF", "SEASON", "LAST14");
        assertThat(b.periods()).noneMatch(DraftBoardService.PeriodView::available);
        assertThat(b.defaultPeriod()).isEqualTo("SEASON");
        assertThat(b.players()).allSatisfy(p -> assertThat(p.stats()).containsKey("SEASON"));
        assertThat(b.players()).allMatch(p -> p.taken() == null);

        long first = b.players().stream().filter(BoardPlayer::fillsNeed).findFirst().orElseThrow().playerId();
        drafts.pick(d, team, first);
        var after = board.board(d, team);
        // 已選的人仍在清單（「顯示已選」用），標出哪隊第幾順位；不再算補缺位或推薦
        BoardPlayer picked = after.players().stream().filter(p -> p.playerId() == first).findFirst().orElseThrow();
        assertThat(picked.taken()).isEqualTo(new DraftBoardService.Taken(team, 1, false));
        assertThat(picked.fillsNeed()).isFalse();
        assertThat(picked.recommended()).isFalse();
        assertThat(after.needs().stream().mapToInt(Need::filled).sum()).isEqualTo(1);
    }

    @Test
    void foreignPlayersAreNotNeedsOnceTheForeignLimitIsReached() {
        long league = seeder.seed();
        long d = jdbc.sql("select id from draft where league_id = ?").param(league).query(Long.class).single();
        drafts.start(d);
        long team = drafts.view(d, null).currentTeamId();
        // 洋將上限設成 0：選了第一位球員後，洋將再選會被拒絕，選秀板就不該把他們標成補缺位或推薦
        jdbc.sql("update league set foreign_player_limit = 0 where id = ?").param(league).update();
        var b = board.board(d, team);
        assertThat(b.players()).anyMatch(p -> p.foreign() && p.fillsNeed());
        long first = b.players().stream().filter(p -> !p.foreign() && p.fillsNeed()).findFirst().orElseThrow().playerId();
        drafts.pick(d, team, first);
        var after = board.board(d, team);
        assertThat(after.players().stream().filter(BoardPlayer::foreign)).isNotEmpty()
                .noneMatch(BoardPlayer::fillsNeed).noneMatch(BoardPlayer::recommended);
        assertThat(after.players().stream().filter(p -> !p.foreign() && p.taken() == null)).anyMatch(BoardPlayer::fillsNeed);
    }
}
