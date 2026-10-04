package tw.cpblf.pipeline;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.source.CpblDataSource;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.RegistrationSnapshot;
import tw.cpblf.source.SourceModels.SourceGame;
import tw.cpblf.source.SourceModels.SourcePlayer;

class PlayerOverridesTest extends IntegrationTest {

    @Autowired
    TeamResolver teams;
    @Autowired
    AlertService alerts;

    /** 三位球員：洋將判斷分別為「無法判斷」、「判為洋將」、「無法判斷」。 */
    static class FakeSource implements CpblDataSource {
        public String name() {
            return "fake";
        }

        public List<SourceGame> fetchSchedule(int year, String kindCode) {
            return List.of();
        }

        public BoxScore fetchBoxScore(int year, String kindCode, int gameSno) {
            return null;
        }

        public RegistrationSnapshot fetchRegistration() {
            return new RegistrationSnapshot(List.of(
                    new SourcePlayer("X1", "瑪帝斯", "富邦悍將", "P", null, "55", "Quinton Martinez"),
                    new SourcePlayer("X2", "陳思仲", "味全龍", "IF", true, "44", "John Peter CLARK"),
                    new SourcePlayer("X3", "某某", "樂天桃猿", "OF", null, "1", "Ma Yaw Ciru")), Set.of("X1", "X2", "X3"));
        }

        public SourcePlayer fetchPlayerProfile(String id) {
            return fetchRegistration().registered().stream().filter(p -> p.cpblPlayerId().equals(id)).findFirst().orElse(null);
        }
    }

    RegistrationSync sync(Map<String, Boolean> overrides) {
        return new RegistrationSync(new FakeSource(), jdbc, clock, teams, alerts, new PlayerOverrides(overrides));
    }

    boolean foreign(String id) {
        return jdbc.sql("select is_foreign from player where cpbl_player_id = ?").param(id).query(Boolean.class).single();
    }

    @Test
    void manualOverrideWinsAndUndecidedPlayersRaiseAnAlert() {
        sync(Map.of("X1", true, "X2", false)).sync(new JobRunner.JobContext());

        assertThat(foreign("X1")).isTrue();
        assertThat(foreign("X2")).isFalse();
        // 無法判斷又沒有修正：先當本土，並告警列出
        assertThat(foreign("X3")).isFalse();
        assertThat(alerts.recent(10)).anyMatch(a -> a.message().contains("某某") && a.message().contains("Ma Yaw Ciru"));
    }

    @Test
    void laterOverrideFixesAnExistingPlayer() {
        sync(Map.of()).sync(new JobRunner.JobContext());
        assertThat(foreign("X2")).isTrue();

        sync(Map.of("X2", false)).sync(new JobRunner.JobContext());
        assertThat(foreign("X2")).isFalse();
        assertThat(count("select count(*) from player_status_log l join player p on p.id = l.player_id where p.cpbl_player_id = 'X2' and l.field = 'is_foreign'"))
                .isEqualTo(1);
    }

    @Test
    void bundledOverrideFileLoads() {
        PlayerOverrides bundled = new PlayerOverrides();
        assertThat(bundled.foreign("0000007804")).isTrue();   // 瑪帝斯
        assertThat(bundled.foreign("0000002661")).isFalse();  // 陳鏞基
        assertThat(bundled.foreign("0000000929")).isNull();   // 不在檔案中
    }
}
