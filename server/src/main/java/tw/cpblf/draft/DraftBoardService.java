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
    private final tw.cpblf.config.AppProperties props;

    public DraftBoardService(DraftService drafts, PlayerRankingService ranking, EligibilityService eligibility,
                             LeagueService leagues, JdbcClient jdbc, tw.cpblf.config.AppProperties props) {
        this.props = props;
        this.drafts = drafts;
        this.ranking = ranking;
        this.eligibility = eligibility;
        this.leagues = leagues;
        this.jdbc = jdbc;
    }

    /**
     * 一位球員一段期間的數據。打者：g 出賽、pa、ab、h、r、hr、bb、avg；投手：pg 出賽、gs 先發、outs（IP 以出局數表示）、
     * w、sv、wsv、qs、k、ph 被安打、pbb 四壞、era、whip。ab、outs 為 0 時比率類別為 null。官網沒有打點、盜壘、中繼。
     */
    public record Stats(long g, long pa, long ab, long h, long r, long hr, long bb, Double avg,
                        long pg, long gs, long outs, long w, long sv, long wsv, long qs, long k, long ph, long pbb,
                        Double era, Double whip) {

        static Stats of(PlayerRankingService.Line l) {
            if (l == null) {
                return new Stats(0, 0, 0, 0, 0, 0, 0, null, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null, null);
            }
            return new Stats(l.gBat(), l.pa(), l.ab(), l.h(), l.r(), l.hr(), l.bb(), l.ab() == 0 ? null : (double) l.h() / l.ab(),
                    l.gPit(), l.gs(), l.outs(), l.w(), l.sv(), l.wsv(), l.qs(), l.k(), l.ph(), l.pbb(),
                    l.outs() == 0 ? null : l.er() * 27.0 / l.outs(), l.outs() == 0 ? null : (l.ph() + l.pbb()) * 3.0 / l.outs());
        }
    }

    /** 已被選走或保留：teamId、第幾順位（keeper 為 null）。 */
    public record Taken(long teamId, Integer pickNo, boolean keeper) {
    }

    /**
     * @param stats 各期間的數據（key 為 {@link PlayerRankingService.Period} 名稱；只含可選的期間）
     * @param taken 已被選走或保留時才有；排名、補缺位、推薦只看還沒被選的球員
     */
    public record BoardPlayer(long playerId, String name, String jerseyNumber, String cpblTeam, String position,
                              boolean pitcher, boolean foreign, List<String> eligible, Integer rank, boolean fillsNeed,
                              boolean recommended, Map<String, Stats> stats, Taken taken) {
    }

    /** 先發缺位：這個位置目前排得進幾人／名額。 */
    public record Need(String slot, int filled, int max) {
    }

    /** 數據期間的選項（設計稿：上半季開季前只有參考季）。 */
    public record PeriodView(String key, String label, boolean available) {
    }

    /**
     * @param basis         排名來源：「2025」（參考季）或「本季」
     * @param players       可選與已選（taken）的球員，依選秀排名
     * @param defaultPeriod 預設的數據期間
     */
    public record Board(String basis, List<BoardPlayer> players, List<Need> needs, List<PeriodView> periods,
                        String defaultPeriod) {
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
        boolean foreignFull = false;
        if (teamId != null) {
            List<SlotAssigner.Candidate> cands = mine.stream().map(id -> new SlotAssigner.Candidate(id, el.get(id))).toList();
            Map<Long, Slot> assigned = SlotAssigner.assign(cands, league.slotCounts());
            Map<Slot, Integer> filled = new EnumMap<>(Slot.class);
            assigned.values().forEach(s -> filled.merge(s, 1, Integer::sum));
            for (Slot s : STARTING) {
                needs.add(new Need(s.name(), filled.getOrDefault(s, 0), league.slotCounts().getOrDefault(s, 0)));
            }
            fills = drafts.fillsNeed(d, teamId, pool.subList(0, Math.min(pool.size(), DraftService.NEED_LOOKAHEAD)));
            // 洋將已達上限：之後選洋將會被拒絕，所以不標成補缺位或推薦
            foreignFull = !mine.isEmpty() && jdbc.sql("select count(*) from player where id in (:ids) and is_foreign")
                    .param("ids", mine).query(Integer.class).single() >= league.foreignPlayerLimit();
        }

        // 已選與 keeper（「顯示已選」用）。揭曉前別隊的 keeper 保密：不標為 keeper，照常列在可選裡
        Map<Long, Taken> taken = new HashMap<>();
        jdbc.sql("select player_id, team_id, pick_no from draft_pick where draft_id = ? and player_id is not null")
                .param(d.id()).query(rs -> {
                    taken.put(rs.getLong(1), new Taken(rs.getLong(2), rs.getInt(3), false));
                });
        boolean revealed = d.revealedAt() != null;
        jdbc.sql("select player_id, team_id from keeper_selection where draft_id = ?").param(d.id()).query(rs -> {
            long t = rs.getLong(2);
            if (revealed || (teamId != null && t == teamId)) {
                taken.put(rs.getLong(1), new Taken(t, null, true));
            } else if (!pool.contains(rs.getLong(1))) {
                pool.add(rs.getLong(1));
            }
        });
        pool.sort(Comparator.comparingInt(id -> ranks.containsKey(id) ? ranks.get(id).rank() : Integer.MAX_VALUE));
        List<Long> shown = new ArrayList<>(pool);
        shown.addAll(taken.keySet());
        shown.sort(Comparator.comparingInt(id -> ranks.containsKey(id) ? ranks.get(id).rank() : Integer.MAX_VALUE));
        Map<Long, Set<Slot>> elAll = new HashMap<>(el);
        List<Long> missing = taken.keySet().stream().filter(id -> !elAll.containsKey(id)).toList();
        if (!missing.isEmpty()) {
            elAll.putAll(eligibility.eligibility(league, missing, drafts.eligibilityDate(d)));
        }

        // 數據期間：上半季開季前只有參考季（沒有封存時用本季）；下半季三段都有
        List<PeriodView> periods = new ArrayList<>();
        boolean refOk = ranking.available(PlayerRankingService.Period.REF);
        boolean first = d.halfNo() == 1;
        periods.add(new PeriodView("REF", (props.seasonYear() - 1) + " 全季", refOk));
        periods.add(new PeriodView("SEASON", props.seasonYear() + " 本季",
                (!first || !refOk) && ranking.available(PlayerRankingService.Period.SEASON)));
        periods.add(new PeriodView("LAST14", "近 14 天", !first && ranking.available(PlayerRankingService.Period.LAST14)));
        String defaultPeriod = first && refOk ? "REF" : "SEASON";
        Map<String, Map<Long, PlayerRankingService.Line>> byPeriod = new HashMap<>();
        for (PeriodView p : periods) {
            if (p.available() || p.key().equals(defaultPeriod)) {
                byPeriod.put(p.key(), ranking.lines(PlayerRankingService.Period.valueOf(p.key())));
            }
        }

        Map<Long, String[]> info = new HashMap<>();
        if (!shown.isEmpty()) {
            jdbc.sql("select id, name, jersey_number, cpbl_team_code, listed_position, is_foreign from player where id in (:ids)")
                    .param("ids", shown).query(rs -> {
                        info.put(rs.getLong(1), new String[]{rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                                String.valueOf(rs.getBoolean(6))});
                    });
        }
        List<BoardPlayer> players = new ArrayList<>();
        int recommended = 0;
        for (Long id : shown) {
            String[] p = info.get(id);
            if (p == null) continue;
            Taken t = taken.get(id);
            boolean fill = t == null && fills.contains(id) && !(foreignFull && Boolean.parseBoolean(p[4]));
            boolean rec = fill && recommended < RECOMMEND;
            if (rec) recommended++;
            PlayerRankingService.Ranked r = ranks.get(id);
            List<String> eligible = elAll.getOrDefault(id, Set.of()).stream().filter(Slot::isStarting).map(Slot::name).sorted().toList();
            Map<String, Stats> stats = new HashMap<>();
            byPeriod.forEach((k, lines) -> stats.put(k, Stats.of(lines.get(id))));
            players.add(new BoardPlayer(id, p[0], p[1], p[2], p[3], "P".equals(p[3]), Boolean.parseBoolean(p[4]), eligible,
                    r == null ? null : r.rank(), fill, rec, stats, t));
        }
        return new Board(basis.label(), players, needs, periods, defaultPeriod);
    }
}
