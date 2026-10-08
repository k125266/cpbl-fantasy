package tw.cpblf.live;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.LocalDate;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.config.AppProperties;
import tw.cpblf.live.LiveService.LiveGame;

/** 季後賽只做即時比分：賽程追蹤例行賽加季後賽，即時頁標示為季後賽（docs/decisions.md「賽季結構」）。 */
class PostseasonLiveTest extends IntegrationTest {

    @Autowired
    LiveService live;
    @Autowired
    AppProperties props;

    long game(String kind, int sno, LocalDate day) {
        return jdbc.sql("""
                insert into game (season_year, kind_code, game_sno, scheduled_date, start_time, home_team_code, away_team_code,
                                  status, home_score, away_score)
                values (2026, ?, ?, ?, ?, 'UNI', 'BRO', 'FINAL', 3, 2) returning id
                """).params(kind, sno, day, Timestamp.from(clock.now())).query(Long.class).single();
    }

    @Test
    void trackedKindsAreTheRegularSeasonThenThePostseason() {
        assertThat(props.trackedKindCodes()).containsExactly("A", "E", "C");
    }

    @Test
    void seriesFormatComesFromConfig() {
        var challenge = props.series("E");
        assertThat(challenge.name()).isEqualTo("季後挑戰賽");
        assertThat(challenge.winsNeeded()).isEqualTo(3);
        assertThat(challenge.advantageTeam()).isEqualTo("BRO");
        var finals = props.series("C");
        assertThat(finals.name()).isEqualTo("台灣大賽");
        assertThat(finals.winsNeeded()).isEqualTo(4);
        assertThat(finals.advantageTeam()).isNull();
        // 沒設定的代碼退回預設
        assertThat(props.series("Z").winsNeeded()).isEqualTo(4);
    }

    @Test
    void postseasonGamesAreMarkedOnTheLivePage() {
        LocalDate day = clock.today();
        long regular = game("A", 901, day);
        long wildCard = game("E", 1, day);

        var games = live.games(day);
        LiveGame e = games.stream().filter(g -> g.id() == wildCard).findFirst().orElseThrow();
        LiveGame a = games.stream().filter(g -> g.id() == regular).findFirst().orElseThrow();
        assertThat(e.postseason()).isTrue();
        assertThat(e.kindCode()).isEqualTo("E");
        assertThat(a.postseason()).isFalse();
    }
}
