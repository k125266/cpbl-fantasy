package tw.cpblf.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;

import tw.cpblf.source.SourceModels.SourcePlayer;

/** 以 stats.cpbl.com.tw 實際回應（Accept: text/markdown，2026-10-04 擷取）驗證 parser。 */
class StatsSiteParsersTest {

    static String fixture(String name) throws IOException {
        try (InputStream in = StatsSiteParsersTest.class.getResourceAsStream("/fixtures/stats/" + name)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    void parsesPlayerListPage() throws IOException {
        var page = StatsSiteParsers.parsePlayerList(fixture("players-page-1.md"));
        assertThat(page.totalCount()).isEqualTo(517);
        assertThat(page.players()).hasSize(8);

        SourcePlayer first = page.players().get(0);
        assertThat(first.cpblPlayerId()).isEqualTo("0000006815");
        assertThat(first.name()).isEqualTo("大瀧幸治");
        assertThat(first.jerseyNumber()).isEqualTo("43");
        assertThat(first.teamName()).isEqualTo("中信兄弟");
        assertThat(first.listedPosition()).isEqualTo("P");
        // 國籍不在列表頁，由球員頁補
        assertThat(first.foreign()).isNull();
    }

    @Test
    void minorsSuffixMarksSecondTeamAndIsStrippedFromTeamName() throws IOException {
        var page = StatsSiteParsers.parsePlayerList(fixture("players-page-1.md"));
        SourcePlayer kong = page.players().stream().filter(p -> p.name().equals("孔念恩")).findFirst().orElseThrow();
        assertThat(kong.teamName()).isEqualTo("富邦悍將");
        assertThat(kong.listedPosition()).isEqualTo("OF");
        assertThat(page.minorsIds()).doesNotContain(kong.cpblPlayerId());
        assertThat(page.minorsIds()).contains("0000006815");
        assertThat(page.players()).noneMatch(p -> p.teamName().endsWith("二軍"));
    }

    @Test
    void nameMarkersAndMarkdownEscapesAreRemoved() throws IOException {
        var page = StatsSiteParsers.parsePlayerList(fixture("players-page-1.md"));
        assertThat(page.players()).extracting(SourcePlayer::name).contains("尹柏淮", "尤丞翊", "方郁淮");
        assertThat(page.players()).noneMatch(p -> p.name().contains("*") || p.name().contains("\\"));
        // 背號 011 保留前導零（官網原樣）
        assertThat(page.players()).anyMatch(p -> "011".equals(p.jerseyNumber()));
    }

    @Test
    void foreignPlayerDetectedFromRomanizedOriginalName() throws IOException {
        SourcePlayer moya = StatsSiteParsers.parsePlayerProfile(fixture("player-0000007239-foreign.md"), "0000007239");
        assertThat(moya.name()).isEqualTo("魔鷹");
        assertThat(moya.jerseyNumber()).isEqualTo("94");
        assertThat(moya.teamName()).isEqualTo("台鋼雄鷹");
        assertThat(moya.listedPosition()).isEqualTo("IF");
        assertThat(moya.foreign()).isTrue();
    }

    @Test
    void localPlayerWithMarkerIsNotForeign() throws IOException {
        SourcePlayer yin = StatsSiteParsers.parsePlayerProfile(fixture("player-0000006849-marker.md"), "0000006849");
        assertThat(yin.name()).isEqualTo("尹柏淮");
        assertThat(yin.teamName()).isEqualTo("統一7-ELEVEn獅");
        assertThat(yin.listedPosition()).isEqualTo("P");
        assertThat(yin.foreign()).isFalse();
    }

    /** 2026-10-04 實際同步 517 人時，原本「有英文字母就是洋將」的規則把原住民族球員誤判為洋將。 */
    @Test
    void indigenousRomanizedNamesAreNotForeign() {
        assertThat(StatsSiteParsers.isForeignOriginalName("Ma Yaw Ciru")).isFalse();
        assertThat(StatsSiteParsers.isForeignOriginalName("Haro Ngayaw")).isFalse();
        assertThat(StatsSiteParsers.isForeignOriginalName("Namoh．Iyang（朱祥麟）")).isFalse();
        assertThat(StatsSiteParsers.isForeignOriginalName("Masegesege ‧Abalrini/瑪仕革斯．俄霸律尼")).isFalse();
        assertThat(StatsSiteParsers.isForeignOriginalName("Yu Cheng-Yi")).isFalse();
        assertThat(StatsSiteParsers.isForeignOriginalName("尹柏淮")).isFalse();
        assertThat(StatsSiteParsers.isForeignOriginalName("Mario SANCHEZ")).isTrue();
        assertThat(StatsSiteParsers.isForeignOriginalName("SUZUKI Shunsuke")).isTrue();
        assertThat(StatsSiteParsers.isForeignOriginalName("OTAKI Kouji")).isTrue();
    }

    @Test
    void positionsMapToListedPositions() {
        assertThat(StatsSiteParsers.normalizePosition("游擊手")).isEqualTo("IF");
        assertThat(StatsSiteParsers.normalizePosition("三壘手")).isEqualTo("IF");
        assertThat(StatsSiteParsers.normalizePosition("中外野手")).isEqualTo("OF");
        assertThat(StatsSiteParsers.normalizePosition("捕手")).isEqualTo("C");
        assertThat(StatsSiteParsers.normalizePosition("投手")).isEqualTo("P");
    }

    static StatsSiteParsers.GamePage game(int sno) throws IOException {
        return StatsSiteParsers.parseGame(fixture("game-2026-A-" + sno + ".md"), 2026, "A", sno);
    }

    @Test
    void finishedGameHeaderAndScore() throws IOException {
        var g = game(200).game();
        // 標題為「客隊 vs 主隊」：中信兄弟 3 : 0 富邦悍將（新莊）
        assertThat(g.awayTeamName()).isEqualTo("中信兄弟");
        assertThat(g.homeTeamName()).isEqualTo("富邦悍將");
        assertThat(g.awayScore()).isEqualTo(3);
        assertThat(g.homeScore()).isEqualTo(0);
        assertThat(g.status()).isEqualTo(SourceModels.GameStatus.FINAL);
        assertThat(g.date()).isEqualTo(java.time.LocalDate.of(2026, 10, 3));
        assertThat(g.gameSno()).isEqualTo(200);
    }

    @Test
    void battingLinesKeepOnlyCountingFields() throws IOException {
        var box = game(200).box();
        var wang = box.batters().stream().filter(b -> b.name().equals("王威晨")).findFirst().orElseThrow();
        // 打席 4、打數 3、安打 2、三振 0、保送 1、全壘打 0、得分 1
        assertThat(wang.home()).isFalse();
        assertThat(wang.pa()).isEqualTo(4);
        assertThat(wang.ab()).isEqualTo(3);
        assertThat(wang.h()).isEqualTo(2);
        assertThat(wang.bb()).isEqualTo(1);
        assertThat(wang.hr()).isZero();
        assertThat(wang.r()).isEqualTo(1);
        // 網站沒有守位、打點、盜壘
        assertThat(wang.positions()).isEmpty();
        assertThat(wang.rbi()).isZero();
        assertThat(wang.sb()).isZero();
        // 代打（沒有棒次）也算進來：中信 11 人、富邦 10 人
        assertThat(box.batters().stream().filter(b -> !b.home())).hasSize(11);
        assertThat(box.batters().stream().filter(b -> b.home())).hasSize(10);
    }

    @Test
    void pitchingLinesConvertInningsAndMarkStarter() throws IOException {
        var box = game(200).box();
        var fub = box.pitchers().stream().filter(p -> p.home()).toList();
        assertThat(fub).hasSize(5);
        assertThat(fub.get(0).name()).isEqualTo("瑪帝斯");
        assertThat(fub.get(0).started()).isTrue();
        assertThat(fub.get(0).outs()).isEqualTo(18);
        // 廖任磊 0.2 局、被安打 0、三振 1、保送 2、責失分 3
        var liao = fub.stream().filter(p -> p.name().equals("廖任磊")).findFirst().orElseThrow();
        assertThat(liao.started()).isFalse();
        assertThat(liao.outs()).isEqualTo(2);
        assertThat(liao.h()).isZero();
        assertThat(liao.k()).isEqualTo(1);
        assertThat(liao.bb()).isEqualTo(2);
        assertThat(liao.er()).isEqualTo(3);
        // 雙方各 9 局 = 27 個出局數
        assertThat(fub.stream().mapToInt(SourceModels.PitcherLine::outs).sum()).isEqualTo(27);
    }

    @Test
    void winAndSaveComeFromTheDecisionCards() throws IOException {
        var box = game(200).box();
        var win = box.pitchers().stream().filter(p -> p.w() == 1).toList();
        var save = box.pitchers().stream().filter(p -> p.sv() == 1).toList();
        assertThat(win).extracting(SourceModels.PitcherLine::name).containsExactly("勝騎士");
        assertThat(save).extracting(SourceModels.PitcherLine::name).containsExactly("呂彥青");
        assertThat(box.pitchers()).allMatch(p -> p.hld() == 0);
    }

    /** CPBLF-2：先發 7.0 局 1 責失分即為 QS。 */
    @Test
    void qualityStartCanBeDerived() throws IOException {
        var box = game(277).box();
        var starter = box.pitchers().stream().filter(p -> p.name().equals("艾菩樂")).findFirst().orElseThrow();
        assertThat(starter.started()).isTrue();
        assertThat(starter.outs()).isEqualTo(21);
        assertThat(starter.er()).isEqualTo(1);
        assertThat(starter.w()).isEqualTo(1);
        // 廖乙忠 4.2 局 = 14 個出局數
        assertThat(box.pitchers().stream().filter(p -> p.name().equals("廖乙忠")).findFirst().orElseThrow().outs()).isEqualTo(14);
    }

    @Test
    void runsAddUpToTheFinalScore() throws IOException {
        for (int sno : new int[]{199, 200, 201, 277}) {
            var page = game(sno);
            int home = page.box().batters().stream().filter(b -> b.home()).mapToInt(SourceModels.BatterLine::r).sum();
            int away = page.box().batters().stream().filter(b -> !b.home()).mapToInt(SourceModels.BatterLine::r).sum();
            assertThat(home).as("sno %d home", sno).isEqualTo(page.game().homeScore());
            assertThat(away).as("sno %d away", sno).isEqualTo(page.game().awayScore());
        }
    }

    @Test
    void scheduledGameHasNoScoreOrLines() throws IOException {
        var page = game(274);
        assertThat(page.game().status()).isEqualTo(SourceModels.GameStatus.SCHEDULED);
        assertThat(page.game().date()).isEqualTo(java.time.LocalDate.of(2026, 10, 5));
        assertThat(page.game().homeScore()).isNull();
        assertThat(page.box().batters()).isEmpty();
        assertThat(page.box().pitchers()).isEmpty();
    }

    @Test
    void unexpectedPageStructureFailsLoudly() {
        assertThatThrownBy(() -> StatsSiteParsers.parsePlayerList("# 球員名鑑\n沒有結果"))
                .isInstanceOf(SourceStructureException.class);
        assertThatThrownBy(() -> StatsSiteParsers.parsePlayerProfile("# 找不到頁面", "0000000001"))
                .isInstanceOf(SourceStructureException.class);
    }
}
