package tw.cpblf.api;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tw.cpblf.auth.Auth;
import tw.cpblf.common.ApiException;
import tw.cpblf.config.AppClock;
import tw.cpblf.config.AppProperties;
import tw.cpblf.draft.PlayerRankingService;
import tw.cpblf.league.League;
import tw.cpblf.league.LeagueService;
import tw.cpblf.roster.PlayerStatusService;
import tw.cpblf.roster.Slot;
import tw.cpblf.scoring.Category;
import tw.cpblf.scoring.ScoringService;
import tw.cpblf.scoring.StatTotals;

@RestController
@RequestMapping("/api")
public class PlayerController {

    private final JdbcClient jdbc;
    private final LeagueService leagues;
    private final PlayerViews views;
    private final ScoringService scoring;
    private final PlayerRankingService ranking;
    private final AppClock clock;
    private final AppProperties props;

    public PlayerController(JdbcClient jdbc, LeagueService leagues, PlayerViews views, ScoringService scoring,
                            PlayerRankingService ranking, AppClock clock, AppProperties props) {
        this.jdbc = jdbc;
        this.leagues = leagues;
        this.views = views;
        this.scoring = scoring;
        this.ranking = ranking;
        this.clock = clock;
        this.props = props;
    }

    public record PlayerRow(long playerId, String name, String cpblTeam, boolean foreign, List<String> eligible,
                            PlayerStatusService.PlayerStatus status, String ownerTeam, Long ownerTeamId, boolean onWaivers,
                            String waiverClears, int rank, double score, Map<String, String> stats) {
    }

    /**
     * 球員清單（FA 頁、選秀頁）。avail：all / fa（自由球員 + waiver）/ draft（指定選秀尚未被選者）。
     * range：season / 14d / 7d。sort：rank 或類別代碼。
     */
    @GetMapping("/leagues/{leagueId}/players")
    public List<PlayerRow> list(@PathVariable long leagueId,
                                @RequestParam(defaultValue = "") String q,
                                @RequestParam(defaultValue = "") String pos,
                                @RequestParam(defaultValue = "fa") String avail,
                                @RequestParam(required = false) Long draftId,
                                @RequestParam(defaultValue = "season") String range,
                                @RequestParam(defaultValue = "rank") String sort,
                                @RequestParam(defaultValue = "150") int limit) {
        leagues.requireMember(leagueId, Auth.require());
        League league = leagues.get(leagueId);
        LocalDate today = clock.today();

        record P(long id, String name, String team, boolean foreign, String reg, String first) {
        }
        List<P> all = jdbc.sql("""
                select id, name, cpbl_team_code, is_foreign, registration_status, first_team_status from player
                where registration_status = 'REGISTERED' or ? = 'all'
                """).param(avail).query((rs, n) -> new P(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getBoolean(4),
                rs.getString(5), rs.getString(6))).list();

        Map<Long, long[]> owners = new HashMap<>();
        Map<Long, String> ownerNames = new HashMap<>();
        jdbc.sql("""
                select distinct on (re.player_id) re.player_id, t.id, t.abbr from roster_entry re
                join fantasy_team t on t.id = re.team_id
                where t.league_id = ? and (re.valid_to is null or re.valid_to > ?)
                order by re.player_id, re.valid_from desc
                """).params(leagueId, today).query((rs, n) -> {
            owners.put(rs.getLong(1), new long[]{rs.getLong(2)});
            ownerNames.put(rs.getLong(1), rs.getString(3));
            return null;
        }).list();
        Map<Long, String> waivers = new HashMap<>();
        jdbc.sql("select player_id, clears_at from waiver_player where league_id = ?").param(leagueId)
                .query((rs, n) -> waivers.put(rs.getLong(1), rs.getObject(2, java.time.OffsetDateTime.class)
                        .atZoneSameInstant(clock.zone()).toLocalDateTime().toString())).list();
        Set<Long> drafted = new HashSet<>();
        if (draftId != null) {
            drafted.addAll(jdbc.sql("select player_id from draft_pick where draft_id = ? and player_id is not null").param(draftId)
                    .query(Long.class).list());
        }

        List<P> filtered = all.stream().filter(p -> switch (avail) {
            case "fa" -> !owners.containsKey(p.id()) && "ACTIVE".equals(p.first());
            case "draft" -> !drafted.contains(p.id()) && "ACTIVE".equals(p.first());
            case "rostered" -> owners.containsKey(p.id());
            default -> true;
        }).filter(p -> q.isBlank() || p.name().contains(q.trim())).toList();

        List<Long> ids = filtered.stream().map(P::id).toList();
        Map<Long, Set<Slot>> elig = views.eligibility(league, ids);
        if (!pos.isBlank()) {
            Slot want = Slot.valueOf(pos);
            filtered = filtered.stream().filter(p -> elig.get(p.id()).contains(want)).toList();
        }
        LocalDate from = switch (range) {
            case "14d" -> today.minusDays(13);
            case "7d" -> today.minusDays(6);
            default -> LocalDate.of(props.seasonYear(), 1, 1);
        };
        Map<Long, StatTotals> totals = scoring.allPlayerTotals(from, today);
        Map<Long, PlayerRankingService.Ranked> ranks = ranking.rankings();

        Comparator<P> cmp;
        if ("rank".equals(sort)) {
            cmp = Comparator.comparingInt(p -> ranks.containsKey(p.id()) ? ranks.get(p.id()).rank() : Integer.MAX_VALUE);
        } else {
            Category c = java.util.Arrays.stream(Category.values()).filter(x -> x.label.equals(sort) || x.name().equals(sort))
                    .findFirst().orElseThrow(() -> ApiException.badRequest("未知排序：" + sort));
            cmp = Comparator.comparing(p -> {
                Double v = totals.getOrDefault(p.id(), StatTotals.ZERO).value(c);
                if (v == null) {
                    return Double.MAX_VALUE;
                }
                return c.lowerIsBetter ? v : -v;
            });
        }
        List<P> sorted = new ArrayList<>(filtered);
        sorted.sort(cmp.thenComparing(P::name));
        List<P> page = sorted.subList(0, Math.min(limit, sorted.size()));
        Map<Long, PlayerStatusService.PlayerStatus> st = views.statuses(league, page.stream().map(P::id).toList());

        List<PlayerRow> out = new ArrayList<>();
        for (P p : page) {
            var r = ranks.get(p.id());
            long[] owner = owners.get(p.id());
            out.add(new PlayerRow(p.id(), p.name(), p.team(), p.foreign(), views.sortedSlots(elig.get(p.id())), st.get(p.id()),
                    ownerNames.get(p.id()), owner == null ? null : owner[0], waivers.containsKey(p.id()), waivers.get(p.id()),
                    r == null ? 0 : r.rank(), r == null ? 0 : r.score(),
                    PlayerViews.statLine(totals.getOrDefault(p.id(), StatTotals.ZERO))));
        }
        return out;
    }

    @GetMapping("/players/{playerId}")
    public Map<String, Object> detail(@PathVariable long playerId, @RequestParam(required = false) Long leagueId) {
        Auth.require();
        var basic = views.basics(List.of(playerId)).get(playerId);
        if (basic == null) {
            throw ApiException.notFound("球員不存在");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("player", basic);
        if (leagueId != null) {
            leagues.requireMember(leagueId, Auth.require());
            League league = leagues.get(leagueId);
            out.put("status", views.statuses(league, List.of(playerId)).get(playerId));
            out.put("eligible", views.sortedSlots(views.eligibility(league, List.of(playerId)).get(playerId)));
        }
        out.put("season", PlayerViews.statLine(scoring.playerTotals(playerId, LocalDate.of(props.seasonYear(), 1, 1), clock.today())));
        out.put("nameHistory", jdbc.sql("""
                select old_name, new_name, changed_at from player_name_history where player_id = ? order by changed_at
                """).param(playerId).query().listOfRows());
        out.put("statusLog", jdbc.sql("""
                select field, old_value, new_value, effective_date from player_status_log where player_id = ?
                order by effective_date desc, id desc limit 30
                """).param(playerId).query().listOfRows());
        out.put("gameLog", jdbc.sql("""
                select g.play_date, g.game_sno, case when gs.team_code = g.home_team_code then g.away_team_code else g.home_team_code end as opponent,
                       gs.positions, gs.pa, gs.ab, gs.r, gs.h, gs.hr, gs.rbi, gs.sb, gs.bb,
                       gs.pitched, gs.started, gs.outs, gs.p_h, gs.p_bb, gs.p_er, gs.p_k, gs.sv, gs.hld, gs.revision, gs.is_final
                from game_stat gs join game g on g.id = gs.game_id where gs.player_id = ?
                order by g.play_date desc, g.game_sno desc limit 40
                """).param(playerId).query().listOfRows());
        return out;
    }
}
