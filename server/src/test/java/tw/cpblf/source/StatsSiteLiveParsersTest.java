package tw.cpblf.source;

import static org.assertj.core.api.Assertions.assertThat;
import static tw.cpblf.source.StatsSiteParsersTest.fixture;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;

import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.GameDetail;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.PlateAppearance;

/** 進行中與剛結束的比賽頁（2026-A-14，10/5 統一 @ 中信，每 60 秒擷取）。 */
class StatsSiteLiveParsersTest {

    private static StatsSiteParsers.GamePage page(String name) throws IOException {
        return StatsSiteParsers.parseGame(fixture("game-2026-A-14-" + name + ".md"), 2026, "A", 14);
    }

    @Test
    void inningComesFromTheLineUnderTheScore() throws IOException {
        assertThat(page("live-8b").box().inningText()).isEqualTo("八下");
        assertThat(page("live-9b").box().inningText()).isEqualTo("九下");
        assertThat(page("live-9b").box().status()).isEqualTo(GameStatus.IN_PROGRESS);
    }

    @Test
    void lineScoreHasEveryInningAndRunsHitsErrors() throws IOException {
        var ls = page("live-9b").box().detail().lineScore();
        assertThat(ls.away()).containsExactly(1, 1, 4, 0, 0, 0, 0, 1, 0);
        assertThat(ls.home()).containsExactly(0, 0, 0, 0, 2, 1, 0, 0, 0);
        assertThat(ls.awayRhe()).containsExactly(7, 14, 1);
        assertThat(ls.homeRhe()).containsExactly(3, 7, 1);
        // 八下時第九局尚未進行
        assertThat(page("live-8b").box().detail().lineScore().away()).containsExactly(1, 1, 4, 0, 0, 0, 0, 1, null);
    }

    @Test
    void currentBatterAndPitcher() throws IOException {
        GameDetail d = page("live-9b").box().detail();
        assertThat(d.batterId()).isEqualTo("0000007278"); // 許庭綸
        assertThat(d.batterResults()).containsExactly("三振", "右飛", "投滾", "中飛");
        assertThat(d.pitcherId()).isEqualTo("0000007292"); // 李軍
        assertThat(d.pitchCount()).isEqualTo(15);

        GameDetail e = page("live-8b").box().detail();
        assertThat(e.batterId()).isEqualTo("0000007621"); // 蔡琞傑
        assertThat(e.batterResults()).containsExactly("三振", "三滾", "左飛");
        assertThat(e.pitcherId()).isEqualTo("0000006850"); // 鄭副豪
        assertThat(e.pitchCount()).isEqualTo(9);
    }

    @Test
    void halfInningListsPlateAppearancesInOrder() throws IOException {
        assertThat(page("live-9b").box().detail().halfInning()).containsExactly(
                new PlateAppearance("17", "黃霆杉", "死球"),
                new PlateAppearance("72", "陳九登", "四壞"),
                new PlateAppearance("47", "林志綱", "犧短"),
                new PlateAppearance("13", "許庭綸", null));
        assertThat(page("live-8b").box().detail().halfInning()).extracting(PlateAppearance::result)
                .containsExactly("左飛", "三振", null);
    }

    @Test
    void battersKeepLineupSlotAndSubstitutes() throws IOException {
        List<BatterLine> away = page("live-9b").box().batters().stream().filter(b -> !b.home()).toList();
        assertThat(away.get(0).name()).isEqualTo("林佳緯");
        assertThat(away.get(0).lineupSlot()).isEqualTo(1);
        assertThat(away.get(0).sub()).isFalse();
        assertThat(away.get(1).name()).isEqualTo("邱智呈");
        assertThat(away.get(1).lineupSlot()).isEqualTo(1);
        assertThat(away.get(1).sub()).isTrue();
        assertThat(away.get(2).lineupSlot()).isEqualTo(2);
        assertThat(away).extracting(BatterLine::lineupSlot).doesNotContainNull();
        assertThat(away.stream().filter(b -> !b.sub())).hasSize(9);
    }

    @Test
    void finishedGameKeepsLineScoreButNoLiveState() throws IOException {
        var p = page("final");
        assertThat(p.game().status()).isEqualTo(GameStatus.FINAL);
        assertThat(p.game().awayScore()).isEqualTo(7);
        assertThat(p.game().homeScore()).isEqualTo(4);
        GameDetail d = p.box().detail();
        assertThat(d.lineScore().homeRhe()).containsExactly(4, 8, 1);
        assertThat(d.batterId()).isNull();
        assertThat(d.pitcherId()).isNull();
        assertThat(d.halfInning()).isEmpty();
    }

    @Test
    void liveDetailCanBeSwitchedOff() throws IOException {
        var p = StatsSiteParsers.parseGame(fixture("game-2026-A-14-live-9b.md"), 2026, "A", 14, false);
        GameDetail d = p.box().detail();
        assertThat(d.lineScore()).isNotNull();
        assertThat(d.batterId()).isNull();
        assertThat(d.batterResults()).isEmpty();
        assertThat(d.halfInning()).isEmpty();
    }

    @Test
    void resultCodesAreWhitelisted() {
        assertThat(PlayResultCodes.split("一安一安一滾雙殺")).contains(Arrays.asList("一安", "一安", "一滾", "雙殺"));
        assertThat(PlayResultCodes.split("四壞二安一安一滾")).contains(Arrays.asList("四壞", "二安", "一安", "一滾"));
        // 敘述文字或未知代碼：整段丟棄
        assertThat(PlayResultCodes.split("好球進壘")).isEmpty();
        assertThat(PlayResultCodes.split("三振後暴投上一壘")).isEmpty();
        assertThat(PlayResultCodes.isCode("對決中")).isFalse();
    }
}
