package tw.cpblf.api;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import tw.cpblf.auth.Auth;
import tw.cpblf.config.AppClock;
import tw.cpblf.draft.PlayerRankingService;
import tw.cpblf.league.League;
import tw.cpblf.league.LeagueService;
import tw.cpblf.roster.PlayerStatusService;
import tw.cpblf.roster.RosterService;
import tw.cpblf.roster.Slot;
import tw.cpblf.scoring.ScoringService;
import tw.cpblf.season.SeasonService;

@RestController
@RequestMapping("/api/leagues/{leagueId}")
public class RosterController {

    private final LeagueService leagues;
    private final RosterService roster;
    private final PlayerViews views;
    private final ScoringService scoring;
    private final SeasonService season;
    private final AppClock clock;
    private final PlayerRankingService ranking;

    public RosterController(LeagueService leagues, RosterService roster, PlayerViews views, ScoringService scoring,
                            SeasonService season, AppClock clock, PlayerRankingService ranking) {
        this.leagues = leagues;
        this.roster = roster;
        this.views = views;
        this.scoring = scoring;
        this.season = season;
        this.clock = clock;
        this.ranking = ranking;
    }

    /** rank：本季排名（金銀銅框用），沒有數據時為 null。 */
    public record RosterPlayer(long playerId, String name, String cpblTeam, String jerseyNumber, boolean foreign,
                               String listedPosition, String slot,
                               List<String> eligible, PlayerStatusService.PlayerStatus status, boolean locked,
                               LocalDate pendingFrom, LocalDate leavingOn, PlayerViews.TodayGame game,
                               Map<String, String> period, PlayerViews.TodayLine today, Map<String, String> season,
                               Integer rank) {
    }

    @GetMapping("/teams/{teamId}/roster")
    public Map<String, Object> roster(@PathVariable long leagueId, @PathVariable long teamId) {
        leagues.requireMember(leagueId, Auth.require());
        League league = leagues.get(leagueId);
        RosterService.Team team = roster.team(teamId);
        if (team.leagueId() != leagueId) {
            throw tw.cpblf.common.ApiException.notFound("隊伍不存在");
        }
        LocalDate today = clock.today();
        List<RosterService.Entry> open = roster.openEntries(teamId, today);
        Set<Long> ids = new LinkedHashSet<>();
        open.forEach(e -> ids.add(e.playerId()));
        var basics = views.basics(ids);
        var elig = views.eligibility(league, ids);
        var stats = views.statuses(league, ids);
        var games = views.todayGames(today);
        SeasonService.Period period = season.periodOn(leagueId, today).orElse(null);
        var lines = views.todayLines(ids, today);
        var ranks = ranking.rankings();
        LocalDate seasonStart = LocalDate.of(league.seasonYear(), 1, 1);

        List<RosterPlayer> players = new ArrayList<>();
        for (Long pid : ids) {
            RosterService.Entry current = open.stream().filter(e -> e.playerId() == pid && !e.validFrom().isAfter(today))
                    .findFirst().orElse(null);
            RosterService.Entry pending = open.stream().filter(e -> e.playerId() == pid && e.validFrom().isAfter(today))
                    .findFirst().orElse(null);
            RosterService.Entry shown = current != null ? current : pending;
            var b = basics.get(pid);
            var totals = period == null ? null : scoring.playerTotals(pid, period.startDate(), today);
            players.add(new RosterPlayer(pid, b.name(), b.team(), b.jerseyNumber(), b.foreign(), b.listedPosition(), shown.slot().name(),
                    views.sortedSlots(elig.get(pid)), stats.get(pid), roster.isLocked(pid),
                    current == null ? pending.validFrom() : null,
                    current != null && current.validTo() != null ? current.validTo() : null,
                    games.get(b.team()), totals == null ? null : PlayerViews.statLine(totals), lines.get(pid),
                    PlayerViews.statLine(scoring.playerTotals(pid, seasonStart, today)),
                    ranks.containsKey(pid) ? ranks.get(pid).rank() : null));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("teamId", teamId);
        out.put("teamName", team.name());
        out.put("faabBudget", team.faabBudget());
        out.put("lineupLockReason", team.lineupLockReason());
        out.put("today", today);
        out.put("slotCounts", league.slotCounts());
        out.put("rosterSize", league.rosterSize());
        out.put("foreignLimit", league.foreignPlayerLimit());
        out.put("period", period);
        out.put("players", players);
        return out;
    }

    public record Move(long playerId, Slot slot) {
    }

    public record Moves(List<Move> moves) {
    }

    @PutMapping("/roster/slots")
    public Map<String, Boolean> setSlots(@PathVariable long leagueId, @RequestBody Moves req) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        Map<Long, Slot> moves = new LinkedHashMap<>();
        req.moves().forEach(m -> moves.put(m.playerId(), m.slot()));
        roster.setSlots(team, moves);
        return Map.of("ok", true);
    }

    public record Add(long playerId, Long dropPlayerId) {
    }

    @PostMapping("/roster/add")
    public Map<String, Object> add(@PathVariable long leagueId, @RequestBody Add req) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        LocalDate eff = roster.addFreeAgent(team, req.playerId(), req.dropPlayerId());
        return Map.of("effectiveDate", eff);
    }

    public record Drop(long playerId) {
    }

    @PostMapping("/roster/drop")
    public Map<String, Object> drop(@PathVariable long leagueId, @RequestBody Drop req) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        LocalDate eff = roster.drop(team, req.playerId());
        return Map.of("effectiveDate", eff);
    }
}
