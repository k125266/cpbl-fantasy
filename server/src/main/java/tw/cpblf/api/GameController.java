package tw.cpblf.api;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tw.cpblf.auth.Auth;
import tw.cpblf.auth.CurrentUser;
import tw.cpblf.config.AppClock;
import tw.cpblf.league.LeagueService;
import tw.cpblf.live.LiveService;
import tw.cpblf.live.PostseasonService;

/** 賽程與即時比分。即時數據一律標示為非最終數據（CPBLF-53）。 */
@RestController
@RequestMapping("/api")
public class GameController {

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final LeagueService leagues;
    private final LiveService live;
    private final PostseasonService postseason;

    public GameController(JdbcClient jdbc, AppClock clock, LeagueService leagues, LiveService live,
                          PostseasonService postseason) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.leagues = leagues;
        this.live = live;
        this.postseason = postseason;
    }

    @GetMapping("/games")
    public List<Map<String, Object>> games(@RequestParam(required = false) String date) {
        Auth.require();
        LocalDate d = date == null ? clock.today() : LocalDate.parse(date);
        return jdbc.sql("""
                select g.id, g.game_sno, g.scheduled_date, g.actual_play_date, g.play_date, g.start_time, g.home_team_code,
                       g.away_team_code, g.status, g.result, g.home_score, g.away_score, g.stats_final,
                       lg.home_score as live_home_score, lg.away_score as live_away_score, lg.inning_text, lg.fetched_at
                from game g left join live_game lg on lg.game_id = g.id
                where g.play_date = ? or (g.scheduled_date = ? and g.status = 'POSTPONED')
                   or (g.scheduled_date = ? and g.actual_play_date is not null and g.actual_play_date <> g.scheduled_date)
                order by g.start_time, g.game_sno
                """).params(d, d, d).query().listOfRows();
    }

    /** 即時頁：今日比賽、上場球員數據（進行中為即時快照，結算後為正式數據）、聯盟各隊先發。 */
    @GetMapping("/live")
    public LiveService.LiveView live(@RequestParam long leagueId) {
        CurrentUser user = Auth.require();
        leagues.requireMember(leagueId, user);
        return live.view(leagueId, user.id());
    }

    /** 季後賽專區：季後挑戰賽、台灣大賽的系列戰比分與各場數據（不計入 fantasy）。 */
    @GetMapping("/postseason")
    public PostseasonService.PostseasonView postseason(@RequestParam long leagueId) {
        CurrentUser user = Auth.require();
        leagues.requireMember(leagueId, user);
        return postseason.view(leagueId, user.id());
    }
}
