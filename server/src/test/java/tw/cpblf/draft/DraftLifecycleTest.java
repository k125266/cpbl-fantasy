package tw.cpblf.draft;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.common.ApiException;
import tw.cpblf.demo.DemoSeeder;

/**
 * 選秀流程（Yahoo Live Standard Draft，時間驅動）：設定時間 → T−30 選秀室開放 → T−10 自動揭曉 → T 自動開始；
 * 選秀中可以暫停／繼續、調整每手秒數。
 */
class DraftLifecycleTest extends IntegrationTest {

    @Autowired DemoSeeder seeder;
    @Autowired DraftService drafts;

    long league;
    long draftId;

    void seed() {
        league = seeder.seed();
        draftId = jdbc.sql("select id from draft where league_id = ?").param(league).query(Long.class).single();
    }

    String phase() {
        return drafts.view(draftId, null).phase();
    }

    @Test
    void schedulingNeedsATimeAndKeepsWhatPlayersAlreadySet() {
        seed();
        assertThat(phase()).isEqualTo("UNSCHEDULED");
        assertThatThrownBy(() -> drafts.schedule(league, 1, null, null)).isInstanceOf(ApiException.class).hasMessageContaining("請設定");
        assertThatThrownBy(() -> drafts.schedule(league, 1, clock.now().plusSeconds(60), null))
                .isInstanceOf(ApiException.class).hasMessageContaining("2 分鐘");

        long team = jdbc.sql("select id from fantasy_team where league_id = ? order by id limit 1").param(league).query(Long.class).single();
        List<Long> some = jdbc.sql("select id from player order by id limit 2").query(Long.class).list();
        drafts.setQueue(draftId, team, some);

        // 重新設定是修改同一場，不會刪掉重建：候選清單還在
        assertThat(drafts.schedule(league, 1, clock.now().plus(Duration.ofMinutes(40)), 45)).isEqualTo(draftId);
        assertThat(drafts.view(draftId, null).pickSeconds()).isEqualTo(45);
        assertThat(drafts.queue(draftId, team)).containsExactlyElementsOf(some);
        assertThat(phase()).isEqualTo("SCHEDULED");
    }

    @Test
    void lobbyAtTMinus30RevealAtTMinus10StartAtT() {
        seed();
        Instant t0 = clock.now();
        drafts.schedule(league, 1, t0.plus(Duration.ofMinutes(40)), null);
        assertThat(phase()).isEqualTo("SCHEDULED");

        clock.setNow(t0.plus(Duration.ofMinutes(11)));
        assertThat(phase()).isEqualTo("LOBBY");
        assertThat(drafts.dueReveals()).doesNotContain(draftId);

        clock.setNow(t0.plus(Duration.ofMinutes(30))); // T−10
        assertThat(drafts.dueReveals()).contains(draftId);
        drafts.reveal(draftId);
        assertThat(phase()).isEqualTo("REVEALED");
        assertThat(drafts.view(draftId, null).order()).isNotEmpty();
        assertThat(drafts.dueStarts()).doesNotContain(draftId);
        // 揭曉後不能改時間
        assertThatThrownBy(() -> drafts.schedule(league, 1, t0.plus(Duration.ofMinutes(60)), null))
                .isInstanceOf(ApiException.class).hasMessageContaining("揭曉");

        clock.setNow(t0.plus(Duration.ofMinutes(40))); // T
        assertThat(drafts.dueStarts()).contains(draftId);
        drafts.start(draftId);
        assertThat(phase()).isEqualTo("IN_PROGRESS");
        assertThat(drafts.view(draftId, null).currentTeamId()).isNotNull();
    }

    @Test
    void startWaitsForTheRevealAnimationEvenAtT() {
        seed();
        Instant t = clock.now().plus(Duration.ofMinutes(3));
        drafts.schedule(league, 1, t, null);
        // 離 T 不到 10 分鐘：馬上就該揭曉
        assertThat(drafts.dueReveals()).contains(draftId);
        // 假設排程晚了，T 前 5 秒才揭曉：到 T 時動畫還沒播完，不開始
        clock.setNow(t.minusSeconds(5));
        drafts.reveal(draftId);
        clock.setNow(t);
        assertThat(drafts.dueStarts()).doesNotContain(draftId);
        clock.setNow(t.plusSeconds(DraftService.REVEAL_SECONDS));
        assertThat(drafts.dueStarts()).contains(draftId);
    }

    @Test
    void pauseFreezesTheClockAndResumeContinuesIt() {
        seed();
        drafts.start(draftId);
        var v = drafts.view(draftId, null);
        long team = v.currentTeamId();
        Instant t0 = clock.now();

        clock.setNow(t0.plusSeconds(20));
        drafts.pause(draftId);
        var paused = drafts.view(draftId, null);
        assertThat(paused.phase()).isEqualTo("PAUSED");
        assertThat(paused.currentTeamId()).isEqualTo(team);
        assertThat(paused.secondsLeft()).isEqualTo(v.pickSeconds() - 20);

        // 暫停中：不能選人，時間過了也不逾時，託管也不動作
        long player = jdbc.sql("select id from player where registration_status = 'REGISTERED' and first_team_status = 'ACTIVE' limit 1")
                .query(Long.class).single();
        assertThatThrownBy(() -> drafts.pick(draftId, team, player)).isInstanceOf(ApiException.class);
        drafts.setAutopilot(draftId, team, true);
        clock.setNow(t0.plusSeconds(20 + v.pickSeconds() + 60));
        assertThat(drafts.overdueDrafts()).doesNotContain(draftId);
        drafts.setAutopilot(draftId, team, false);

        // 繼續：從剩下的秒數接著倒數
        Instant resumed = clock.now();
        drafts.resume(draftId);
        assertThat(phase()).isEqualTo("IN_PROGRESS");
        clock.setNow(resumed.plusSeconds(v.pickSeconds() - 21));
        assertThat(drafts.overdueDrafts()).doesNotContain(draftId);
        clock.setNow(resumed.plusSeconds(v.pickSeconds() - 19));
        assertThat(drafts.overdueDrafts()).contains(draftId);
    }

    @Test
    void newSecondsPerPickApplyFromTheNextPick() {
        seed();
        drafts.start(draftId);
        Instant t0 = clock.now();
        var before = drafts.view(draftId, null);
        drafts.setPickSeconds(draftId, 30);
        assertThat(drafts.view(draftId, null).deadline()).isEqualTo(before.deadline()); // 這一手不變
        assertThatThrownBy(() -> drafts.setPickSeconds(draftId, 10)).isInstanceOf(ApiException.class);

        drafts.autoPick(draftId);
        var next = drafts.view(draftId, null);
        assertThat(Duration.between(t0, next.deadline().toInstant()).toSeconds()).isEqualTo(30);
    }
}
