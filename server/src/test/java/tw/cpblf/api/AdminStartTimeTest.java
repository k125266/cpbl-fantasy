package tw.cpblf.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import tw.cpblf.IntegrationTest;
import tw.cpblf.auth.AuthInterceptor;
import tw.cpblf.auth.CurrentUser;
import tw.cpblf.common.ApiException;
import tw.cpblf.source.GameTimes;

/** 系統管理員手動覆寫開賽時間（E26）：權限、格式、日期範圍、已結束不能改、取消後回預設。 */
class AdminStartTimeTest extends IntegrationTest {

    @Autowired AdminController admin;

    LocalDate day;

    void loginAs(boolean isAdmin) {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setAttribute(AuthInterceptor.ATTR, new CurrentUser(1, "admin", "admin", isAdmin));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(req));
    }

    @BeforeEach
    void game() {
        day = clock.today().plusDays(1);
        jdbc.sql("""
                insert into game (season_year, kind_code, game_sno, scheduled_date, start_time, home_team_code, away_team_code, status)
                values (2026, 'E', 1, ?, ?, 'BRO', 'UNI', 'SCHEDULED')
                """).params(java.sql.Date.valueOf(day), Timestamp.from(GameTimes.defaultStart(day))).update();
        loginAs(true);
    }

    @AfterEach
    void logout() {
        RequestContextHolder.resetRequestAttributes();
    }

    Instant startTime() {
        return jdbc.sql("select start_time from game where kind_code = 'E' and game_sno = 1").query(Timestamp.class).single().toInstant();
    }

    boolean manual() {
        return jdbc.sql("select start_time_manual from game where kind_code = 'E' and game_sno = 1").query(Boolean.class).single();
    }

    @Test
    void adminCanSetAndClearTheStartTime() {
        assertThat(admin.upcomingGames()).anySatisfy(g -> assertThat(g).containsEntry("kind", "E").containsEntry("manual", false));

        admin.setStartTime("E", 1, new AdminController.SetStart(day + "T17:05"));
        assertThat(manual()).isTrue();
        assertThat(startTime()).isEqualTo(day.atTime(17, 5).atZone(clock.zone()).toInstant());
        assertThat(admin.upcomingGames()).anySatisfy(g -> assertThat(g).containsEntry("startLocal", day + "T17:05").containsEntry("manual", true));

        admin.setStartTime("E", 1, new AdminController.SetStart(""));
        assertThat(manual()).isFalse();
        assertThat(startTime()).isEqualTo(GameTimes.defaultStart(day));
    }

    @Test
    void rejectsNonAdminBadInputAndFinishedGames() {
        loginAs(false);
        assertThatThrownBy(() -> admin.setStartTime("E", 1, new AdminController.SetStart(day + "T17:05"))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> admin.upcomingGames()).isInstanceOf(ApiException.class);

        loginAs(true);
        assertThatThrownBy(() -> admin.setStartTime("E", 1, new AdminController.SetStart("17:05"))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> admin.setStartTime("E", 1, new AdminController.SetStart(day.plusDays(3) + "T17:05"))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> admin.setStartTime("E", 99, new AdminController.SetStart(day + "T17:05"))).isInstanceOf(ApiException.class);
        assertThat(manual()).isFalse();

        jdbc.sql("update game set status = 'FINAL' where kind_code = 'E' and game_sno = 1").update();
        assertThatThrownBy(() -> admin.setStartTime("E", 1, new AdminController.SetStart(day + "T17:05"))).isInstanceOf(ApiException.class);
    }
}
