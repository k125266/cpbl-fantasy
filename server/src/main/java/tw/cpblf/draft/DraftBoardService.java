package tw.cpblf.draft;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import tw.cpblf.league.League;
import tw.cpblf.league.LeagueService;
import tw.cpblf.roster.EligibilityService;
import tw.cpblf.roster.Slot;
import tw.cpblf.roster.SlotAssigner;

/**
 * 選秀室 v3 的資料：可選球員（選秀排名、5 類別數據、守位、補缺位、推薦）與我的先發缺位。
 * 數據與排名來自 {@link PlayerRankingService#draftBasis}：上半季為參考季，下半季為當季。
 */
@Service
public class DraftBoardService {

    /** 推薦：補缺位、排名最高的前幾位。 */
    static final int RECOMMEND = 3;
    static final List<Slot> STARTING = List.of(Slot.IF, Slot.OF, Slot.UTIL, Slot.SP, Slot.RP);

    private final DraftService drafts;
    private final PlayerRankingService ranking;
    private final EligibilityService eligibility;
    private final LeagueService leagues;
    private final JdbcClient jdbc;

    public DraftBoardService(DraftService drafts, PlayerRankingService ranking, EligibilityService eligibility,
                             LeagueService leagues, JdbcClient jdbc) {
        this.drafts = drafts;
        this.ranking = ranking;
        this.eligibility = eligibility;
        this.leagues = leagues;
        this.jdbc = jdbc;
    }

    /**
     * 一位球員的數據（打者看前五項、投手看後五項）。ab、outs 為 0 時比率類別為 null。
     */
    public record Stats(long r, long hr, long h, long bb, Double avg, long ab,
                        long qs, long k, long wsv, Double era, Double whip, long outs) {

        static Stats of(PlayerRankingService.Line l) {
            if (l == null) {
                return new Stats(0, 0, 0, 0, null, 0, 0, 0, 0, null, null, 0);
            }
            return new Stats(l.r(), l.hr(), l.h(), l.bb(), l.ab() == 0 ? null : (double) l.h() / l.ab(), l.ab(),
                    l.qs(), l.k(), l.wsv(), l.outs() == 0 ? null : l.er() * 27.0 / l.outs(),
                    l.outs() == 0 ? null : (l.ph() + l.pbb()) * 3.0 / l.outs(), l.outs());
        }
    }

    public record BoardPlayer(long playerId, String name, String jerseyNumber, String cpblTeam, String position,
                              boolean pitcher, boolean foreign, List<String> eligible, Integer rank, boolean fillsNeed,
                              boolean recommended, Stats stats) {
    }

    /** 先發缺位：這個位置目前排得進幾人／名額。 */
    public record Need(String slot, int filled, int max) {
    }

    /** @param basis 數據來源：「2025」（參考季）或「本季」 */
    public record Board(String basis, List<BoardPlayer> players, List<Need> needs) {
    }

    // ------------------------------------------------------------------
    // 選秀成績單（選秀完成後）：依選秀數據來源預估各隊 10 類別
    // ------------------------------------------------------------------

    /** 十個類別；ERA、WHIP 越低越好。 */
    static final List<String> CATS = List.of("R", "HR", "H", "BB", "AVG", "QS", "K", "W+SV", "ERA", "WHIP");

    /**
     * @param projection 各類別預估（比率類別先加總再相除）；沒有數據為 null
     * @param ranks      各類別在聯盟的名次
     * @param best       名次第 1 的類別
     */
    public record TeamReport(long teamId, int points, String grade, int place, List<String> best,
                             Map<String, Double> projection, Map<String, Integer> ranks) {
    }

    /** @param delta 順位 − 選秀排名：正值是撿到寶，負值是比排名早選 */
    public record Highlight(String kind, long playerId, String name, String cpblTeam, int pickNo, int round, Integer rank,
                            int delta) {
    }

    public record RosterGroup(String key, List<String> names) {
    }

    public record Report(String basis, int maxPoints, List<TeamReport> teams, List<Highlight> highlights,
                         List<RosterGroup> roster) {
    }

    public Report report(long draftId, Long teamId) {
        DraftService.DraftRow d = drafts.draft(draftId);
        PlayerRankingService.DraftBasis basis = ranking.draftBasis(d.halfNo());
        List<Long> teams = jdbc.sql("select team_id from draft_slot where draft_id = ? order by draft_position").param(draftId)
                .query(Long.class).list();
        int n = teams.size();
        Map<Long, Map<String, Double>> proj = new HashMap<>();
        for (Long t : teams) {
            proj.put(t, projection(drafts.teamPlayers(d, t), basis.lines()));
        }
        Map<Long, Map<String, Integer>> ranks = new HashMap<>();
        Map<Long, Integer> points = new HashMap<>();
        teams.forEach(t -> {
            ranks.put(t, new HashMap<>());
            points.put(t, 0);
        });
        for (String c : CATS) {
            boolean low = c.equals("ERA") || c.equals("WHIP");
            List<Long> order = new ArrayList<>(teams);
            // 沒有數據的排最後
            order.sort(Comparator.comparing((Long t) -> proj.get(t).get(c) == null ? 1 : 0)
                    .thenComparingDouble(t -> proj.get(t).get(c) == null ? 0 : (low ? 1 : -1) * proj.get(t).get(c)));
            for (int i = 0; i < order.size(); i++) {
                ranks.get(order.get(i)).put(c, i + 1);
                points.merge(order.get(i), n - i, Integer::sum);
            }
        }
        int max = CATS.size() * n;
        List<TeamReport> out = new ArrayList<>();
        for (Long t : teams) {
            int pts = points.get(t);
            int place = 1 + (int) teams.stream().filter(o -> points.get(o) > pts).count();
            List<String> best = CATS.stream().filter(c -> ranks.get(t).get(c) == 1).toList();
            out.add(new TeamReport(t, pts, grade(pts, max), place, best, proj.get(t), ranks.get(t)));
        }
        out.sort(Comparator.comparingInt(TeamReport::place).thenComparingLong(TeamReport::teamId));

        List<Highlight> hl = new ArrayList<>();
        List<RosterGroup> roster = new ArrayList<>();
        if (teamId != null) {
            record Mine(long id, String name, String team, String pos, int pickNo, int round) {
            }
            List<Mine> mine = jdbc.sql("""
                    select p.id, p.name, p.cpbl_team_code, p.listed_position, dp.pick_no, dp.round
                    from draft_pick dp join player p on p.id = dp.player_id
                    where dp.draft_id = ? and dp.team_id = ? order by dp.pick_no
                    """).params(draftId, teamId).query((rs, x) -> new Mine(rs.getLong(1), rs.getString(2), rs.getString(3),
                    rs.getString(4), rs.getInt(5), rs.getInt(6))).list();
            Map<Long, PlayerRankingService.Ranked> rk = basis.ranks();
            List<Mine> ranked = mine.stream().filter(m -> rk.containsKey(m.id())).toList();
            if (!ranked.isEmpty()) {
                Comparator<Mine> byDelta = Comparator.comparingInt(m -> m.pickNo() - rk.get(m.id()).rank());
                Mine value = ranked.stream().max(byDelta).orElseThrow();
                Mine reach = ranked.stream().min(byDelta).orElseThrow();
                for (Object[] h : new Object[][]{{"BEST_VALUE", value}, {"BOLDEST_REACH", reach}}) {
                    Mine m = (Mine) h[1];
                    int r = rk.get(m.id()).rank();
                    hl.add(new Highlight((String) h[0], m.id(), m.name(), m.team(), m.pickNo(), m.round(), r, m.pickNo() - r));
                }
            }
            // 我的陣容（keeper ＋ 選秀）依登錄守位分組
            Map<String, List<String>> groups = new java.util.LinkedHashMap<>();
            for (String k : List.of("C", "IF", "OF", "P")) {
                groups.put(k, new ArrayList<>());
            }
            jdbc.sql("select name, listed_position from player where id in (:ids) order by name")
                    .param("ids", drafts.teamPlayers(d, teamId).isEmpty() ? List.of(-1L) : drafts.teamPlayers(d, teamId))
                    .query(rs -> {
                        groups.computeIfAbsent(rs.getString(2), x -> new ArrayList<>()).add(rs.getString(1));
                    });
            groups.forEach((k, v) -> roster.add(new RosterGroup(k, v)));
        }
        return new Report(basis.label(), max, out, hl, roster);
    }

    /** 一隊的 10 類別預估：計數類別加總；AVG、ERA、WHIP 先加總再相除。 */
    static Map<String, Double> projection(List<Long> players, Map<Long, PlayerRankingService.Line> lines) {
        long r = 0, hr = 0, h = 0, bb = 0, ab = 0, qs = 0, k = 0, wsv = 0, er = 0, outs = 0, ph = 0, pbb = 0;
        for (Long id : players) {
            PlayerRankingService.Line l = lines.get(id);
            if (l == null) continue;
            r += l.r();
            hr += l.hr();
            h += l.h();
            bb += l.bb();
            ab += l.ab();
            qs += l.qs();
            k += l.k();
            wsv += l.wsv();
            er += l.er();
            outs += l.outs();
            ph += l.ph();
            pbb += l.pbb();
        }
        Map<String, Double> m = new java.util.LinkedHashMap<>();
        m.put("R", (double) r);
        m.put("HR", (double) hr);
        m.put("H", (double) h);
        m.put("BB", (double) bb);
        m.put("AVG", ab == 0 ? null : (double) h / ab);
        m.put("QS", (double) qs);
        m.put("K", (double) k);
        m.put("W+SV", (double) wsv);
        m.put("ERA", outs == 0 ? null : er * 27.0 / outs);
        m.put("WHIP", outs == 0 ? null : (ph + pbb) * 3.0 / outs);
        return m;
    }

    /** 等第（設計稿 5 隊、滿分 50 的門檻 40／35／31／27／23，依隊數等比換算）。 */
    static String grade(int points, int max) {
        double p = (double) points / max;
        return p >= 0.8 ? "A" : p >= 0.7 ? "A-" : p >= 0.62 ? "B+" : p >= 0.54 ? "B" : p >= 0.46 ? "B-" : "C+";
    }

    public Board board(long draftId, Long teamId) {
        DraftService.DraftRow d = drafts.draft(draftId);
        League league = leagues.get(d.leagueId());
        PlayerRankingService.DraftBasis basis = ranking.draftBasis(d.halfNo());
        Map<Long, PlayerRankingService.Ranked> ranks = basis.ranks();
        List<Long> pool = drafts.available(d);
        pool.sort(Comparator.comparingInt(id -> ranks.containsKey(id) ? ranks.get(id).rank() : Integer.MAX_VALUE));

        List<Long> mine = teamId == null ? List.of() : drafts.teamPlayers(d, teamId);
        List<Long> all = new ArrayList<>(pool);
        all.addAll(mine);
        Map<Long, Set<Slot>> el = eligibility.eligibility(league, all, drafts.eligibilityDate(d));

        // 我的先發缺位
        List<Need> needs = new ArrayList<>();
        Set<Long> fills = Set.of();
        if (teamId != null) {
            List<SlotAssigner.Candidate> cands = mine.stream().map(id -> new SlotAssigner.Candidate(id, el.get(id))).toList();
            Map<Long, Slot> assigned = SlotAssigner.assign(cands, league.slotCounts());
            Map<Slot, Integer> filled = new EnumMap<>(Slot.class);
            assigned.values().forEach(s -> filled.merge(s, 1, Integer::sum));
            for (Slot s : STARTING) {
                needs.add(new Need(s.name(), filled.getOrDefault(s, 0), league.slotCounts().getOrDefault(s, 0)));
            }
            fills = drafts.fillsNeed(d, teamId, pool.subList(0, Math.min(pool.size(), DraftService.NEED_LOOKAHEAD)));
        }

        Map<Long, String[]> info = new HashMap<>();
        if (!pool.isEmpty()) {
            jdbc.sql("select id, name, jersey_number, cpbl_team_code, listed_position, is_foreign from player where id in (:ids)")
                    .param("ids", pool).query(rs -> {
                        info.put(rs.getLong(1), new String[]{rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                                String.valueOf(rs.getBoolean(6))});
                    });
        }
        List<BoardPlayer> players = new ArrayList<>();
        int recommended = 0;
        for (Long id : pool) {
            String[] p = info.get(id);
            boolean fill = fills.contains(id);
            boolean rec = fill && recommended < RECOMMEND;
            if (rec) recommended++;
            PlayerRankingService.Ranked r = ranks.get(id);
            List<String> eligible = el.getOrDefault(id, Set.of()).stream().filter(Slot::isStarting).map(Slot::name).sorted().toList();
            players.add(new BoardPlayer(id, p[0], p[1], p[2], p[3], "P".equals(p[3]), Boolean.parseBoolean(p[4]), eligible,
                    r == null ? null : r.rank(), fill, rec, Stats.of(basis.lines().get(id))));
        }
        return new Board(basis.label(), players, needs);
    }
}
