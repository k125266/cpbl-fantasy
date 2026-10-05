package tw.cpblf.pipeline;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.SourceGame;

/** 開賽時間的決定順序：資料源 → 已知的同一天時間 → 預設時間（未結束的比賽）。 */
class SchedulePollerStartTimeTest extends IntegrationTest {

    @Autowired
    SchedulePoller poller;

    static Instant at(String s) {
        return OffsetDateTime.parse(s).toInstant();
    }

    static SourceGame game(LocalDate date, Instant start, GameStatus status) {
        return new SourceGame(2026, "A", 274, date, start, "樂天桃猿", "富邦悍將", status, null, null);
    }

    static SchedulePoller.Existing known(Instant start) {
        return new SchedulePoller.Existing(1, LocalDate.of(2026, 10, 5), null, "SCHEDULED", false, start);
    }

    @Test
    void sourceTimeWins() {
        Instant site = at("2026-10-06T18:35:00+08:00");
        assertThat(poller.startTime(game(LocalDate.of(2026, 10, 6), site, GameStatus.SCHEDULED), null)).isEqualTo(site);
    }

    @Test
    void knownTimeOfTheSameDayIsKeptOnceTheListStopsShowingIt() {
        Instant earlier = at("2026-10-05T18:35:00+08:00");
        assertThat(poller.startTime(game(LocalDate.of(2026, 10, 5), null, GameStatus.IN_PROGRESS), known(earlier)))
                .isEqualTo(earlier);
    }

    @Test
    void postponedGameDropsTheOldTimeAndGetsTheDefaultForItsNewDate() {
        Instant original = at("2026-10-05T18:35:00+08:00");
        assertThat(poller.startTime(game(LocalDate.of(2026, 10, 10), null, GameStatus.SCHEDULED), known(original)))
                .isEqualTo(at("2026-10-10T17:05:00+08:00")); // 週六
    }

    @Test
    void unknownTimeDefaultsOnlyForGamesNotYetOver() {
        assertThat(poller.startTime(game(LocalDate.of(2026, 10, 6), null, GameStatus.SCHEDULED), null))
                .isEqualTo(at("2026-10-06T18:35:00+08:00"));
        assertThat(poller.startTime(game(LocalDate.of(2026, 10, 6), null, GameStatus.FINAL), null)).isNull();
    }
}
