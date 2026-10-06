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
