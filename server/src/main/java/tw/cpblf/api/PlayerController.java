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
import tw.cpblf.league.FeedService;
import tw.cpblf.league.LeagueService;
import tw.cpblf.roster.EligibilityService;
import tw.cpblf.roster.RosterService;
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
    private final FeedService feeds;
    private final EligibilityService eligibility;
    private final RosterService roster;

    public PlayerController(JdbcClient jdbc, LeagueService leagues, PlayerViews views, ScoringService scoring,
                            PlayerRankingService ranking, AppClock clock, AppProperties props, FeedService feeds,
                            EligibilityService eligibility, RosterService roster) {
        this.feeds = feeds;
        this.eligibility = eligibility;
        this.roster = roster;
        this.jdbc = jdbc;
        this.leagues = leagues;
        this.views = views;
        this.scoring = scoring;
        this.ranking = ranking;
        this.clock = clock;
        this.props = props;
    }

    public record PlayerRow(long playerId, String name, String cpblTeam, String jerseyNumber, boolean foreign, List<String> eligible,
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

        record P(long id, String name, String team, boolean foreign, String reg, String first, String no) {
        }
        List<P> all = jdbc.sql("""
                select id, name, cpbl_team_code, is_foreign, registration_status, first_team_status, jersey_number from player
                where registration_status = 'REGISTERED' or ? = 'all'
                """).param(avail).query((rs, n) -> new P(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getBoolean(4),
                rs.getString(5), rs.getString(6), rs.getString(7))).list();

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
            out.add(new PlayerRow(p.id(), p.name(), p.team(), p.no(), p.foreign(), views.sortedSlots(elig.get(p.id())), st.get(p.id()),
                    ownerNames.get(p.id()), owner == null ? null : owner[0], waivers.containsKey(p.id()), waivers.get(p.id()),
                    r == null ? 0 : r.rank(), r == null ? 0 : r.score(),
                    PlayerViews.statLine(totals.getOrDefault(p.id(), StatTotals.ZERO))));
        }
        return out;
    }

    @GetMapping("/leagues/{leagueId}/feed")
    public List<FeedService.FeedItem> feed(@PathVariable long leagueId) {
        var user = Auth.require();
        leagues.requireMember(leagueId, user);
        return feeds.leagueFeed(leagueId, leagues.teamOf(leagueId, user.id()).orElse(null), 40);
    }

    @GetMapping("/players/{playerId}")
    public Map<String, Object> detail(@PathVariable long playerId, @RequestParam(required = false) Long leagueId) {
        Auth.require();
        var basic = views.basics(List.of(playerId)).get(playerId);
        if (basic == null) {
            throw ApiException.notFound("球員不存在");
        }
        LocalDate today = clock.today();
        LocalDate seasonStart = LocalDate.of(props.seasonYear(), 1, 1);
        boolean pitcher = "P".equals(basic.listedPosition());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("player", basic);
        out.put("today", today);

        // 數據區間
        Map<String, Map<String, String>> ranges = new LinkedHashMap<>();
        ranges.put("season", PlayerViews.statLine(scoring.playerTotals(playerId, seasonStart, today)));
        ranges.put("14d", PlayerViews.statLine(scoring.playerTotals(playerId, today.minusDays(13), today)));
        ranges.put("7d", PlayerViews.statLine(scoring.playerTotals(playerId, today.minusDays(6), today)));
        out.put("ranges", ranges);

        // 排名：總排名與兩項主要類別的聯盟排名
        var rank = ranking.rankings().get(playerId);
        out.put("rank", rank == null ? null : rank.rank());
        Map<Long, StatTotals> all = scoring.allPlayerTotals(seasonStart, today);
        Map<String, Integer> catRanks = new LinkedHashMap<>();
        if (pitcher) {
            catRanks.put("ERA", categoryRank(all, playerId, Category.ERA, t -> t.outs() >= 30));
            catRanks.put("K", categoryRank(all, playerId, Category.K, t -> t.outs() > 0));
        } else {
            catRanks.put("AVG", categoryRank(all, playerId, Category.AVG, t -> t.ab() >= 30));
            catRanks.put("HR", categoryRank(all, playerId, Category.HR, t -> t.ab() > 0));
        }
        out.put("categoryRanks", catRanks);

        // 未來 7 天賽程（含延賽、補賽）
        out.put("schedule", jdbc.sql("""
                select g.play_date, g.scheduled_date, g.actual_play_date, g.status, g.start_time,
                       case when g.home_team_code = :t then g.away_team_code else g.home_team_code end as opponent,
                       g.home_team_code = :t as home
                from game g where (g.home_team_code = :t or g.away_team_code = :t)
                  and g.play_date between :from and :to and g.status <> 'CANCELLED'
                order by g.play_date, g.start_time
                """).param("t", basic.team()).param("from", today).param("to", today.plusDays(6)).query().listOfRows());

        if (leagueId != null) {
            leagues.requireMember(leagueId, Auth.require());
            League league = leagues.get(leagueId);
            out.put("status", views.statuses(league, List.of(playerId)).get(playerId));
            out.put("eligible", views.sortedSlots(views.eligibility(league, List.of(playerId)).get(playerId)));
            out.put("eligibilityProgress", eligibility.progress(league, playerId, today));
            out.put("feed", feeds.playerFeed(leagueId, playerId));
            out.put("league", leagueRecord(league, playerId, today));
        }
        // 第三方新聞：待來源授權確認後啟用（docs/rulebook-amendments.md）
        out.put("newsEnabled", false);
        out.put("news", List.of());

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

    private static Integer categoryRank(Map<Long, StatTotals> all, long playerId, Category c,
                                        java.util.function.Predicate<StatTotals> qualifies) {
        StatTotals mine = all.get(playerId);
        if (mine == null || !qualifies.test(mine) || !mine.hasData(c)) {
            return null;
        }
        int better = 0;
        for (StatTotals t : all.values()) {
            if (t != mine && qualifies.test(t) && t.hasData(c) && t.compare(c, mine) > 0) {
                better++;
            }
        }
        return better + 1;
    }

    /** 聯盟內紀錄：目前持有、取得方式、近 7 天簽入 / 釋出次數。 */
    private Map<String, Object> leagueRecord(League league, long playerId, LocalDate today) {
        Map<String, Object> rec = new LinkedHashMap<>();
        Long owner = roster.ownerTeam(league.id(), playerId, today).orElse(null);
        boolean waiver = jdbc.sql("select count(*) from waiver_player where league_id = ? and player_id = ?")
                .params(league.id(), playerId).query(Integer.class).single() > 0;
        rec.put("ownerTeamId", owner);
        rec.put("ownerTeamName", owner == null ? null : jdbc.sql("select name from fantasy_team where id = ?").param(owner)
                .query(String.class).single());
        rec.put("availability", owner != null ? "ROSTERED" : waiver ? "WAIVERS" : "FREE_AGENT");
        String via = owner == null ? null : jdbc.sql("""
                select acquired_via from roster_entry where team_id = ? and player_id = ? and acquired_via <> 'MOVE'
                order by valid_from desc, id desc limit 1
                """).params(owner, playerId).query(String.class).optional().orElse(null);
        rec.put("acquiredVia", via);
        rec.put("draftRound", jdbc.sql("""
                select dp.round from draft_pick dp join draft d on d.id = dp.draft_id
                where d.league_id = ? and dp.player_id = ? order by d.id desc limit 1
                """).params(league.id(), playerId).query(Integer.class).optional().orElse(null));
        rec.put("teams", jdbc.sql("select count(*) from fantasy_team where league_id = ?").param(league.id()).query(Integer.class).single());
        rec.put("adds7d", jdbc.sql("""
                select count(*) from roster_entry re join fantasy_team t on t.id = re.team_id
                where t.league_id = ? and re.player_id = ? and re.acquired_via in ('FA', 'WAIVER', 'TRADE')
                  and re.valid_from between ? and ?
                """).params(league.id(), playerId, today.minusDays(6), today.plusDays(1)).query(Integer.class).single());
        rec.put("drops7d", jdbc.sql("""
                select count(*) from roster_entry re join fantasy_team t on t.id = re.team_id
                where t.league_id = ? and re.player_id = ? and re.valid_to between ? and ?
                  and not exists (select 1 from roster_entry r2 where r2.team_id = re.team_id and r2.player_id = re.player_id
                                  and r2.valid_from = re.valid_to)
                """).params(league.id(), playerId, today.minusDays(6), today.plusDays(1)).query(Integer.class).single());
        return rec;
    }
}
