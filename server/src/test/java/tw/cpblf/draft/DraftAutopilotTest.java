package tw.cpblf.draft;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.demo.DemoSeeder;

/** 託管（E18）：輪到託管隊伍後 3 秒內自動選；沒託管的照常等到時間到。 */
class DraftAutopilotTest extends IntegrationTest {

    @Autowired DemoSeeder seeder;
    @Autowired DraftService drafts;

    @Test
    void autopilotTeamPicksWithinSecondsOthersWaitForTheClock() {
        long league = seeder.seed();
        long d = jdbc.sql("select id from draft where league_id = ?").param(league).query(Long.class).single();
        drafts.start(d);
        var v = drafts.view(d, null);
        long onClock = v.currentTeamId();
        var start = clock.now();

        // 沒託管：4 秒後還不該自動選
        clock.setNow(start.plusSeconds(4));
        assertThat(drafts.overdueDrafts()).doesNotContain(d);

        // 開託管：輪到後 2 秒還沒，超過 3 秒就挑出來
        drafts.setAutopilot(d, onClock, true);
        assertThat(drafts.view(d, null).autopilotTeams()).containsExactly(onClock);
        clock.setNow(start.plusSeconds(2));
        assertThat(drafts.overdueDrafts()).doesNotContain(d);
        clock.setNow(start.plusSeconds(4));
        assertThat(drafts.overdueDrafts()).contains(d);

        drafts.autoPick(d);
        var after = drafts.view(d, null);
        var first = after.picks().stream().filter(p -> p.pickNo() == 1).findFirst().orElseThrow();
        assertThat(first.teamId()).isEqualTo(onClock);
        assertThat(first.auto()).isTrue();
        assertThat(after.currentPickNo()).isEqualTo(2);

        // 下一隊沒託管：時間到才自動選
        clock.setNow(start.plusSeconds(4 + 4));
        assertThat(drafts.overdueDrafts()).doesNotContain(d);
        clock.setNow(start.plusSeconds(4 + after.pickSeconds() + 1));
        assertThat(drafts.overdueDrafts()).contains(d);
    }
}
