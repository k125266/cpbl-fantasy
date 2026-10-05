package tw.cpblf.api;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tw.cpblf.auth.Auth;
import tw.cpblf.auth.CurrentUser;
import tw.cpblf.common.ApiException;
import tw.cpblf.config.AppClock;
import tw.cpblf.config.AppProperties;
import tw.cpblf.draft.PlayerRankingService;
import tw.cpblf.league.League;
import tw.cpblf.league.LeagueService;
import tw.cpblf.league.NotificationService;
import tw.cpblf.scoring.MatchupService;
import tw.cpblf.scoring.ScoringService;
import tw.cpblf.season.SeasonService;

@RestController
@RequestMapping("/api")
public class LeagueController {

    private final LeagueService leagues;
    private final SeasonService season;
    private final MatchupService matchups;
    private final ScoringService scoring;
    private final NotificationService notifications;
    private final AppClock clock;
    private final AppProperties props;
    private final PlayerRankingService ranking;

    public LeagueController(LeagueService leagues, SeasonService season, MatchupService matchups, ScoringService scoring,
                            NotificationService notifications, AppClock clock, AppProperties props,
                            PlayerRankingService ranking) {
        this.leagues = leagues;
        this.season = season;
        this.matchups = matchups;
        this.scoring = scoring;
        this.notifications = notifications;
        this.clock = clock;
        this.props = props;
        this.ranking = ranking;
    }

    /** 公開：系統時鐘與模式（前端顯示 demo 標示用）。 */
    @GetMapping("/system")
    public Map<String, Object> system() {
        return Map.of("now", clock.localNow().toString(), "today", clock.today().toString(), "demo", props.isDemo(),
                "source", props.source(), "seasonYear", props.seasonYear());
    }

    @GetMapping("/me/leagues")
    public List<LeagueService.Membership> myLeagues() {
        return leagues.memberships(Auth.require().id());
    }

    /** 已登入、還沒有聯盟時建立聯盟；系統管理員以外需要建盟碼。 */
    public record CreateLeague(String name, Integer seasonYear, String createCode, String teamName, String teamAbbr, String teamIcon,
                               String teamColor) {
    }

    @PostMapping("/leagues")
    public League create(@RequestBody CreateLeague req) {
        CurrentUser u = Auth.require();
        return leagues.create(u, req.name(), req.seasonYear() == null ? props.seasonYear() : req.seasonYear(),
                new LeagueService.TeamIdentity(req.teamName(), req.teamAbbr(), req.teamIcon(), req.teamColor()), req.createCode());
    }

    public record Join(String inviteCode, String teamName, String teamAbbr, String teamIcon, String teamColor) {
    }

    @PostMapping("/leagues/join")
    public Map<String, Boolean> join(@RequestBody Join req) {
        leagues.joinWithInvite(Auth.require(), req.inviteCode(),
                new LeagueService.TeamIdentity(req.teamName(), req.teamAbbr(), req.teamIcon(), req.teamColor()));
        return Map.of("ok", true);
    }

    /** 公開（註冊前）：邀請碼預覽，只回聯盟名稱、管理員、隊數與已加入隊伍的隊名／頭像／色。 */
    @GetMapping("/invites/{code}")
    public LeagueService.InvitePreview invite(@PathVariable String code) {
        return leagues.invitePreview(code);
    }

    @GetMapping("/leagues/{id}")
    public Map<String, Object> league(@PathVariable long id) {
        CurrentUser u = Auth.require();
        leagues.requireMember(id, u);
        League l = leagues.get(id);
        boolean commissioner = l.commissionerUserId() == u.id();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("league", l);
        out.put("inviteCode", commissioner || u.admin() ? l.inviteCode() : null);
        out.put("commissioner", commissioner);
        out.put("myTeamId", leagues.teamOf(id, u.id()).orElse(null));
        out.put("teams", leagues.teams(id));
        out.put("halves", season.halves(id));
        out.put("periods", season.periods(id));
        out.put("currentPeriod", season.periodOn(id, clock.today()).orElse(null));
        out.put("today", clock.today());
        return out;
    }

    @PatchMapping("/leagues/{id}/settings")
    public League settings(@PathVariable long id, @RequestBody Map<String, Object> values) {
        leagues.requireCommissioner(id, Auth.require());
        return leagues.updateSettings(id, values);
    }

    @PostMapping("/leagues/{id}/season")
    public Map<String, Object> setupSeason(@PathVariable long id, @RequestBody SeasonService.SetupRequest req) {
        leagues.requireCommissioner(id, Auth.require());
        season.setup(id, req);
        matchups.progress();
        return Map.of("periods", season.periods(id));
    }

    /** 頭像與色可省略（不變）。 */
    public record Rename(String name, String abbr, String icon, String color) {
    }

    @PatchMapping("/leagues/{id}/teams/me")
    public Map<String, Boolean> rename(@PathVariable long id, @RequestBody Rename req) {
        long team = leagues.requireTeam(id, Auth.require());
        leagues.updateTeam(id, team, new LeagueService.TeamIdentity(req.name(), req.abbr(), req.icon(), req.color()));
        return Map.of("ok", true);
    }

    @GetMapping("/leagues/{id}/standings")
    public Map<String, Object> standings(@PathVariable long id) {
        leagues.requireMember(id, Auth.require());
        League l = leagues.get(id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("half1", season.standings(id, 1));
        out.put("half2", season.standings(id, 2));
        out.put("halves", season.halves(id));
        out.put("championTeamId", l.championTeamId());
        out.put("championNote", l.championNote());
        return out;
    }

    @GetMapping("/leagues/{id}/matchups")
    public List<MatchupService.MatchupView> matchupList(@PathVariable long id) {
        leagues.requireMember(id, Auth.require());
        return matchups.list(id);
    }

    @GetMapping("/leagues/{id}/matchups/{matchupId}")
    public Map<String, Object> matchup(@PathVariable long id, @PathVariable long matchupId) {
        leagues.requireMember(id, Auth.require());
        MatchupService.MatchupView m = matchups.list(id).stream().filter(x -> x.id() == matchupId).findFirst()
                .orElseThrow(() -> ApiException.notFound("對戰不存在"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("matchup", m);
        LocalDate to = m.end().isAfter(clock.today()) ? clock.today() : m.end();
        if (m.teamA() != null && m.teamB() != null) {
            var playersA = scoring.contributions(m.teamA(), m.start(), to);
            var playersB = scoring.contributions(m.teamB(), m.start(), to);
            out.put("playersA", playersA);
            out.put("playersB", playersB);
            // 本季排名：球員卡金銀銅框用
            var all = ranking.rankings();
            Map<Long, Integer> ranks = new LinkedHashMap<>();
            for (var p : java.util.stream.Stream.concat(playersA.stream(), playersB.stream()).toList()) {
                var r = all.get(p.playerId());
                if (r != null) {
                    ranks.put(p.playerId(), r.rank());
                }
            }
            out.put("ranks", ranks);
        }
        return out;
    }

    @GetMapping("/leagues/{id}/notifications")
    public List<NotificationService.Notification> notifications(@PathVariable long id) {
        long team = leagues.requireTeam(id, Auth.require());
        return notifications.list(team);
    }

    @PostMapping("/leagues/{id}/notifications/read")
    public Map<String, Boolean> markRead(@PathVariable long id) {
        long team = leagues.requireTeam(id, Auth.require());
        notifications.markRead(team);
        return Map.of("ok", true);
    }

    @GetMapping("/leagues/{id}/periods/current")
    public Object currentPeriod(@PathVariable long id, @RequestParam(required = false) String date) {
        leagues.requireMember(id, Auth.require());
        return season.periodOn(id, date == null ? clock.today() : LocalDate.parse(date)).orElse(null);
    }
}
