package tw.cpblf.api;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tw.cpblf.auth.Auth;
import tw.cpblf.config.AppClock;
import tw.cpblf.league.LeagueService;

/** 賽程與即時比分。即時數據一律標示為非最終數據（CPBLF-53）。 */
@RestController
@RequestMapping("/api")
public class GameController {

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final LeagueService leagues;

    public GameController(JdbcClient jdbc, AppClock clock, LeagueService leagues) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.leagues = leagues;
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

    /** 即時頁：今日比賽 + 該聯盟各隊先發球員的即時數據。 */
    @GetMapping("/live")
    public Map<String, Object> live(@RequestParam long leagueId) {
        leagues.requireMember(leagueId, Auth.require());
        LocalDate today = clock.today();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("notice", "即時數據僅供參考，非最終數據，不參與計分。正式比分以賽後結算為準。");
        out.put("games", games(today.toString()));
        List<Map<String, Object>> lines = new ArrayList<>(jdbc.sql("""
                select t.id as team_id, t.abbr, re.slot, p.id as player_id, p.name, p.cpbl_team_code,
                       ls.pa, ls.ab, ls.h, ls.hr, ls.r, ls.rbi, ls.sb, ls.bb,
                       ls.pitched, ls.outs, ls.p_h, ls.p_bb, ls.p_er, ls.p_k, ls.fetched_at
                from live_game_stat ls
                join game g on g.id = ls.game_id and g.play_date = ?
                join player p on p.id = ls.player_id
                join roster_entry re on re.player_id = ls.player_id and re.valid_from <= ? and (re.valid_to is null or re.valid_to > ?)
                join fantasy_team t on t.id = re.team_id and t.league_id = ?
                where g.status <> 'FINAL'
                order by t.id, p.name
                """).params(today, today, today, leagueId).query().listOfRows());
        out.put("lines", lines);
        return out;
    }
}
