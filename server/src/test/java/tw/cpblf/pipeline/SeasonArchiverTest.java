package tw.cpblf.pipeline;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.source.SourceArchive;
import tw.cpblf.source.SourceModels.RegistrationSnapshot;
import tw.cpblf.source.SourceModels.SourcePlayer;
import tw.cpblf.source.SourceNotFoundException;
import tw.cpblf.source.StatsSiteParsers;

/** 用 2026-10-04 擷取的真實頁面模擬網站，不實際連線。 */
class SeasonArchiverTest extends IntegrationTest {

    @Autowired
    SeasonArchiver archiver;
    @Autowired
    SourceArchive archive;

    /** 編號 1～3 是已結束的比賽、4 是還沒開打的比賽，5 以後不存在。 */
    static final Map<Integer, String> PAGES = Map.of(1, "game-2026-A-200.md", 2, "game-2026-A-201.md", 3, "game-2026-A-277.md",
            4, "game-2026-A-274.md");

    static String fixture(String name) {
        try (InputStream in = SeasonArchiverTest.class.getResourceAsStream("/fixtures/stats/" + name)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    static class FakeSite implements SeasonArchiver.Source {
        final List<Integer> gameCalls = new ArrayList<>();
        final List<String> profileCalls = new ArrayList<>();

        public StatsSiteParsers.GamePage game(int year, String kindCode, int sno) {
            gameCalls.add(sno);
            String page = PAGES.get(sno);
            if (page == null) {
                throw new SourceNotFoundException("比賽不存在：" + sno);
            }
            return StatsSiteParsers.parseGame(fixture(page), year, kindCode, sno);
        }

        public RegistrationSnapshot registration() {
            return new RegistrationSnapshot(StatsSiteParsers.parsePlayerList(fixture("players-page-1.md")).players(), Set.of());
        }

        public SourcePlayer profile(String id) {
            profileCalls.add(id);
            return new SourcePlayer(id, "個人頁姓名", "樂天桃猿", "IF", false, "99");
        }
    }

    @Test
    void archivesGamesInOrderAndStopsAfterFiveMisses() {
        FakeSite site = new FakeSite();
        var r = archiver.archive(site, 2026, "A", null);

        assertThat(r.gamesFetched()).isEqualTo(4);
        assertThat(r.lastSno()).isEqualTo(4);
        // 1～4 存在，5～9 連續 5 個不存在後停止
        assertThat(site.gameCalls).containsExactly(1, 2, 3, 4, 5, 6, 7, 8, 9);
        assertThat(archive.count("game")).isEqualTo(4);
    }

    @Test
    void rerunSkipsFinishedGamesAndRefetchesUnfinishedOnes() {
        archiver.archive(new FakeSite(), 2026, "A", null);
        FakeSite again = new FakeSite();
        var r = archiver.archive(again, 2026, "A", null);

        assertThat(r.gamesSkipped()).isEqualTo(3);
        assertThat(r.gamesFetched()).isEqualTo(1);
        assertThat(again.gameCalls).startsWith(4).doesNotContain(1, 2, 3);
        // 球員已封存過，不再抓個人頁
        assertThat(again.profileCalls).isEmpty();
        assertThat(r.playersAdded()).isZero();
    }

    @Test
    void playersInBoxScoresButNotOnTheListAreArchived() {
        archiver.archive(new FakeSite(), 2026, "A", null);

        // 列表上的人
        assertThat(archive.hasPlayer("0000006815")).isTrue();
        // 只出現在 box score 的人（A-200 的王威晨、勝騎士不在列表第 1 頁）
        assertThat(archive.hasPlayer("0000000929")).isTrue();
        assertThat(archive.hasPlayer("0000005604")).isTrue();
        var wang = archive.players().stream().filter(p -> p.cpblPlayerId().equals("0000000929")).findFirst().orElseThrow();
        // 姓名用 box score／列表的，洋將與守位用個人頁的
        assertThat(wang.name()).isEqualTo("王威晨");
        assertThat(wang.teamName()).isEqualTo("中信兄弟");
        assertThat(wang.foreign()).isFalse();
    }

    @Test
    void archivedPagesRoundTripThroughJson() {
        archiver.archive(new FakeSite(), 2026, "A", null);
        var page = archive.games().stream().filter(p -> p.game().gameSno() == 1).findFirst().orElseThrow();
        assertThat(page.game().awayScore()).isEqualTo(3);
        assertThat(page.box().pitchers()).anyMatch(p -> p.name().equals("勝騎士") && p.w() == 1);
    }
}
