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
 * 選秀流程（Yahoo Live Standard Draft）：選秀自動進入「準備中」→ 管理員按開始：keeper 鎖定、馬上揭曉 →
 * 動畫播完自動開始；選秀中可以暫停／繼續、調整每手秒數。沒有預設選秀時間（玩家自己討論時間）。
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
    void draftsAppearOnTheirOwnAndTheSecondHalfWaitsForTheFirst() {
        seed();
        assertThat(phase()).isEqualTo("PREPARING");
        // 重複呼叫不會重建（候選清單還在）
        long team = jdbc.sql("select id from fantasy_team where league_id = ? order by id limit 1").param(league).query(Long.class).single();
        List<Long> some = jdbc.sql("select id from player order by id limit 2").query(Long.class).list();
        drafts.setQueue(draftId, team, some);
        drafts.ensureDrafts(league);
        drafts.ensureDrafts(league);
        assertThat(count("select count(*) from draft where league_id = ?", league)).isEqualTo(1);
        assertThat(drafts.queue(draftId, team)).containsExactlyElementsOf(some);

        // 下半季要等上半季選完
        drafts.begin(draftId, null);
        clock.setNow(clock.now().plusSeconds(DraftService.REVEAL_SECONDS));
        drafts.start(draftId);
        drafts.ensureDrafts(league);
        assertThat(count("select count(*) from draft where league_id = ?", league)).isEqualTo(1);
        while (drafts.inProgress(draftId)) {
            drafts.autoPick(draftId);
        }
        drafts.ensureDrafts(league);
        assertThat(count("select count(*) from draft where league_id = ?", league)).isEqualTo(2);
    }

    @Test
    void beginRevealsAtOnceAndTheDraftStartsOnceTheAnimationIsOver() {
        seed();
        // 還沒按開始：順位保密，不會自動開始
        assertThat(drafts.view(draftId, null).order()).isEmpty();
        assertThat(drafts.dueStarts()).doesNotContain(draftId);

        drafts.begin(draftId, 45);
        var v = drafts.view(draftId, null);
        assertThat(v.phase()).isEqualTo("REVEALED");
        assertThat(v.order()).isNotEmpty();
        assertThat(v.pickSeconds()).isEqualTo(45);
        assertThatThrownBy(() -> drafts.begin(draftId, null)).isInstanceOf(ApiException.class).hasMessageContaining("按過");

        // 動畫還在播：不開始
        clock.setNow(clock.now().plusSeconds(DraftService.REVEAL_SECONDS - 3));
        assertThat(drafts.dueStarts()).doesNotContain(draftId);
        assertThatThrownBy(() -> drafts.requireRevealShown(draftId)).isInstanceOf(ApiException.class);
        // 播完：排程接手自動開始
        clock.setNow(clock.now().plusSeconds(5));
        assertThat(drafts.dueStarts()).contains(draftId);
        drafts.start(draftId);
        assertThat(phase()).isEqualTo("IN_PROGRESS");
        assertThat(drafts.view(draftId, null).currentTeamId()).isNotNull();
        assertThatThrownBy(() -> drafts.begin(draftId, null)).isInstanceOf(ApiException.class);
    }

    @Test
    void beginRejectsTooShortAPick() {
        seed();
        assertThatThrownBy(() -> drafts.begin(draftId, 10)).isInstanceOf(ApiException.class).hasMessageContaining("15");
        assertThat(phase()).isEqualTo("PREPARING");
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
