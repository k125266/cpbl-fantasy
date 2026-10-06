package tw.cpblf.draft;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.demo.DemoSeeder;

/** 候選清單：逾時先從清單選、被選走的從每一隊的清單移除、同步讀取依順序。 */
class DraftQueueTest extends IntegrationTest {

    @Autowired DemoSeeder seeder;
    @Autowired DraftService drafts;

    @Test
    void autoPickTakesTheQueueFirstAndPickedPlayersLeaveEveryQueue() {
        long league = seeder.seed();
        long d = jdbc.sql("select id from draft where league_id = ?").param(league).query(Long.class).single();
        drafts.start(d);
        var v = drafts.view(d, null);
        long onClock = v.currentTeamId();
        long other = v.order().stream().filter(t -> t != onClock).findFirst().orElseThrow();
        // 排名後段的兩位，自動選照排名的話不會選到
        List<Long> deep = jdbc.sql("""
                select id from player where registration_status = 'REGISTERED' and first_team_status = 'ACTIVE'
                order by name desc limit 2
                """).query(Long.class).list();

        assertThat(drafts.setQueue(d, onClock, List.of(deep.get(0), deep.get(1), deep.get(0)))).containsExactly(deep.get(0), deep.get(1));
        drafts.setQueue(d, other, List.of(deep.get(0)));

        drafts.autoPick(d);
        assertThat(drafts.view(d, null).picks().get(0).playerId()).isEqualTo(deep.get(0));
        assertThat(drafts.queue(d, onClock)).containsExactly(deep.get(1));
        assertThat(drafts.queue(d, other)).isEmpty();
    }
}
