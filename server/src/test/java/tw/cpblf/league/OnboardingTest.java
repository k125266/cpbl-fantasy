package tw.cpblf.league;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.auth.CurrentUser;
import tw.cpblf.common.ApiException;
import tw.cpblf.league.LeagueService.Registration;
import tw.cpblf.league.LeagueService.TeamIdentity;

/** 封閉註冊（邀請碼或建盟碼）與隊伍頭像／代表色（設計稿「登入與加入聯盟」）。 */
class OnboardingTest extends IntegrationTest {

    @Autowired
    LeagueService leagues;

    CurrentUser admin;
    League league;

    static Registration join(String user, String invite, String icon, String color) {
        return new Registration(user, user, "password123", invite, null, null, 2026, new TeamIdentity(user + " 隊", "T", icon, color));
    }

    static Registration create(String user, String code, String leagueName) {
        return new Registration(user, user, "password123", null, code, leagueName, 2026, new TeamIdentity("新隊", "N", "bird", "#7b8cff"));
    }

    int users() {
        return count("select count(*) from app_user");
    }

    @BeforeEach
    void adminAndLeague() {
        // 第一位使用者不帶碼即可註冊，成為系統管理員
        admin = leagues.register(new Registration("admin", "管理員", "password123", null, null, null, 2026, null));
        assertThat(admin.admin()).isTrue();
        league = leagues.create(admin, "台北夜場聯盟", 2026, new TeamIdentity("北投夜鷹", "NB", "cat", "#7b8cff"), null);
    }

    @Test
    void registrationNeedsAnInviteOrCreateCode() {
        assertThatThrownBy(() -> leagues.register(new Registration("stranger", "路人", "password123", null, null, null, 2026, null)))
                .isInstanceOf(ApiException.class).hasMessageContaining("邀請碼或建盟碼");
        assertThat(users()).isEqualTo(1);
    }

    @Test
    void joinWithInviteCreatesAccountAndTeamTogether() {
        // 邀請碼不分大小寫、可帶連字號
        String messy = league.inviteCode().toLowerCase().substring(0, 4) + "-" + league.inviteCode().substring(4);
        CurrentUser u = leagues.register(join("rocket", messy, "rabbit", "#e8603c"));

        var team = leagues.teams(league.id()).stream().filter(t -> t.userId() == u.id()).findFirst().orElseThrow();
        assertThat(team.icon()).isEqualTo("rabbit");
        assertThat(team.color()).isEqualTo("#e8603c");
        assertThat(u.admin()).isFalse();
    }

    @Test
    void failedJoinLeavesNoAccount() {
        // 錯誤邀請碼
        assertThatThrownBy(() -> leagues.register(join("ghost", "WRONGCODE", "dog", "#3cb4c8")))
                .isInstanceOf(ApiException.class).hasMessageContaining("找不到這個邀請碼");
        // 頭像已被北投夜鷹使用
        assertThatThrownBy(() -> leagues.register(join("copycat", league.inviteCode(), "cat", "#3cb4c8")))
                .isInstanceOf(ApiException.class).hasMessageContaining("北投夜鷹 已經用了這個頭像");
        // 代表色已被使用
        assertThatThrownBy(() -> leagues.register(join("copycolor", league.inviteCode(), "dog", "#7b8cff")))
                .isInstanceOf(ApiException.class).hasMessageContaining("已經用了這個顏色");
        // 不在白名單的頭像
        assertThatThrownBy(() -> leagues.register(join("logo", league.inviteCode(), "brothers-logo", "#3cb4c8")))
                .isInstanceOf(ApiException.class).hasMessageContaining("不支援的頭像");
        assertThat(users()).isEqualTo(1);
    }

    @Test
    void createCodeWorksOnceAndCanBeRevoked() {
        String code = leagues.issueCreateCode(admin);
        CurrentUser c = leagues.register(create("captain", code, "板橋聯盟"));
        League created = jdbcLeague("板橋聯盟");
        assertThat(created.commissionerUserId()).isEqualTo(c.id());
        assertThat(leagues.createCodes()).anyMatch(x -> x.code().equals(code) && "板橋聯盟".equals(x.leagueName()));

        // 用過就失效
        assertThatThrownBy(() -> leagues.register(create("second", code, "第二聯盟")))
                .isInstanceOf(ApiException.class).hasMessageContaining("已經用過");
        // 撤銷後失效
        String revoked = leagues.issueCreateCode(admin);
        leagues.revokeCreateCode(revoked);
        assertThatThrownBy(() -> leagues.register(create("third", revoked, "第三聯盟")))
                .isInstanceOf(ApiException.class).hasMessageContaining("無效");
        assertThat(users()).isEqualTo(2);
    }

    @Test
    void loggedInNonAdminNeedsACodeToCreateALeague() {
        CurrentUser member = leagues.register(join("member", league.inviteCode(), "dog", "#3cb4c8"));
        assertThatThrownBy(() -> leagues.create(member, "自己開", 2026, new TeamIdentity("隊", "T", null, null), null))
                .isInstanceOf(ApiException.class).hasMessageContaining("建盟碼");
    }

    @Test
    void invitePreviewShowsOnlyPublicFields() {
        leagues.register(join("rocket", league.inviteCode(), "rabbit", "#e8603c"));
        var p = leagues.invitePreview(league.inviteCode());
        assertThat(p.leagueName()).isEqualTo("台北夜場聯盟");
        assertThat(p.commissioner()).isEqualTo("管理員");
        assertThat(p.teamCount()).isEqualTo(2);
        assertThat(p.maxTeams()).isEqualTo(5);
        assertThat(p.teams()).extracting(LeagueService.PreviewTeam::icon).containsExactly("cat", "rabbit");
    }

    @Test
    void teamCanChangeIconButNotToOneInUse() {
        CurrentUser u = leagues.register(join("rocket", league.inviteCode(), "rabbit", "#e8603c"));
        long teamId = leagues.teamOf(league.id(), u.id()).orElseThrow();
        leagues.updateTeam(league.id(), teamId, new TeamIdentity("三重火箭", "RK", "horse", null));
        assertThat(leagues.teams(league.id())).anyMatch(t -> t.id() == teamId && "horse".equals(t.icon()) && "#e8603c".equals(t.color()));
        assertThatThrownBy(() -> leagues.updateTeam(league.id(), teamId, new TeamIdentity("三重火箭", "RK", "cat", null)))
                .isInstanceOf(ApiException.class).hasMessageContaining("已經用了這個頭像");
    }

    League jdbcLeague(String name) {
        return jdbc.sql("select * from league where name = ?").param(name).query((rs, n) -> League.from(rs)).single();
    }
}
