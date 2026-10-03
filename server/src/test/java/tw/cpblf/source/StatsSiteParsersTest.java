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

    @Test
    void unexpectedPageStructureFailsLoudly() {
        assertThatThrownBy(() -> StatsSiteParsers.parsePlayerList("# 球員名鑑\n沒有結果"))
                .isInstanceOf(SourceStructureException.class);
        assertThatThrownBy(() -> StatsSiteParsers.parsePlayerProfile("# 找不到頁面", "0000000001"))
                .isInstanceOf(SourceStructureException.class);
    }
}
