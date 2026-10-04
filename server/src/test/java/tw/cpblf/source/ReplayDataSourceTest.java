package tw.cpblf.source;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.SourceGame;

/** 封存 10/1（A-277，週四）、10/3（A-200，週六）兩場已結束的比賽，以及 10/5（A-274）封存時還沒打的比賽。 */
class ReplayDataSourceTest extends IntegrationTest {

    @Autowired
    SourceArchive archive;

    ReplayDataSource replay;

    @BeforeEach
    void archiveGames() throws IOException {
        for (int sno : new int[]{277, 200, 274}) {
            archive.putGame(StatsSiteParsers.parseGame(StatsSiteParsersTest.fixture("game-2026-A-" + sno + ".md"), 2026, "A", sno));
        }
        StatsSiteParsers.parsePlayerList(StatsSiteParsersTest.fixture("players-page-1.md")).players().forEach(archive::putPlayer);
        replay = new ReplayDataSource(archive, clock);
    }

    void at(String time) {
        clock.setNow(OffsetDateTime.parse(time).toInstant());
    }

    SourceGame game(int sno) {
        return replay.fetchSchedule(2026, "A").stream().filter(g -> g.gameSno() == sno).findFirst().orElseThrow();
    }

    @Test
    void startTimesAreFixedByWeekday() {
        ZoneId tpe = ZoneId.of("Asia/Taipei");
        assertThat(replay.startTime(LocalDate.of(2026, 10, 1)).atZone(tpe).toLocalTime()).hasToString("18:35");
        assertThat(replay.startTime(LocalDate.of(2026, 10, 3)).atZone(tpe).toLocalTime()).hasToString("17:05");
    }

    @Test
    void resultsAreHiddenUntilTheGameIsOver() {
        at("2026-10-03T10:00:00+08:00");
        assertThat(game(200).status()).isEqualTo(GameStatus.SCHEDULED);
        assertThat(game(200).homeScore()).isNull();
        assertThat(replay.fetchBoxScore(2026, "A", 200).batters()).isEmpty();
        // 前天的比賽已經看得到
        assertThat(game(277).status()).isEqualTo(GameStatus.FINAL);
        assertThat(game(277).awayScore()).isEqualTo(2);

        at("2026-10-03T18:00:00+08:00");
        assertThat(game(200).status()).isEqualTo(GameStatus.IN_PROGRESS);
        assertThat(replay.fetchBoxScore(2026, "A", 200).batters()).isEmpty();

        at("2026-10-03T21:00:00+08:00");
        assertThat(game(200).status()).isEqualTo(GameStatus.FINAL);
        assertThat(game(200).awayScore()).isEqualTo(3);
        assertThat(replay.fetchBoxScore(2026, "A", 200).pitchers()).anyMatch(p -> p.name().equals("勝騎士") && p.w() == 1);
    }

    @Test
    void unplayedArchivedGameBecomesPostponedOnceItsTimePasses() {
        at("2026-10-05T10:00:00+08:00");
        assertThat(game(274).status()).isEqualTo(GameStatus.SCHEDULED);
        at("2026-10-06T10:00:00+08:00");
        assertThat(game(274).status()).isEqualTo(GameStatus.POSTPONED);
    }

    @Test
    void firstTeamFollowsRecentAppearances() {
        // 王威晨 10/3 有出賽（A-200）
        String wang = "0000000929";
        // 開季頭兩週（開幕 10/1）：視為開季名單已知，比賽還沒打也算一軍
        at("2026-10-02T10:00:00+08:00");
        assertThat(replay.fetchRegistration().firstTeamIds()).contains(wang);
        // 之後只看過去 14 天
        at("2026-10-16T10:00:00+08:00");
        assertThat(replay.fetchRegistration().firstTeamIds()).contains(wang);
        at("2026-10-17T10:00:00+08:00");
        assertThat(replay.fetchRegistration().firstTeamIds()).doesNotContain(wang);
        // 封存的球員都算已註冊
        assertThat(replay.fetchRegistration().registered()).hasSize(8);
    }
}
