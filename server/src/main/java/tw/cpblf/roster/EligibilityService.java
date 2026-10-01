package tw.cpblf.roster;

import java.time.LocalDate;
import java.util.Collection;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import tw.cpblf.league.League;
import tw.cpblf.season.SeasonService;

/**
 * CPBLF-32：守備位置資格。
 *
 * <ul>
 *   <li>野手：官網登錄位置為基本資格；本半季於 IF/OF 出賽達門檻（預設 5 場）即另外取得該位置資格。UTIL 任何野手皆可</li>
 *   <li>投手：本半季先發 ≥ 門檻（預設 3 場）取得 SP；其餘為 RP；有後援出賽者另取得 RP，兩者可並存</li>
 *   <li>資格逐半季重算，不跨半季繼承</li>
 *   <li>補充規則（規則書未明定，見 docs/decisions.md）：每半季開始後 grace 天數內樣本不足，投手 SP/RP 皆可</li>
 * </ul>
 */
@Service
public class EligibilityService {

    private final JdbcClient jdbc;
    private final SeasonService season;

    public EligibilityService(JdbcClient jdbc, SeasonService season) {
        this.jdbc = jdbc;
        this.season = season;
    }

    record Usage(int ifGames, int ofGames, int batGames, int starts, int reliefs) {
        static final Usage NONE = new Usage(0, 0, 0, 0, 0);
    }

    public Map<Long, Set<Slot>> eligibility(League league, Collection<Long> playerIds, LocalDate date) {
        Map<Long, Set<Slot>> out = new HashMap<>();
        if (playerIds.isEmpty()) {
            return out;
        }
        SeasonService.Half half = season.currentHalf(league.id(), date).orElse(null);
        LocalDate from = half == null ? LocalDate.of(league.seasonYear(), 1, 1) : half.startDate();
        LocalDate to = half == null ? date : (date.isAfter(half.endDate()) ? half.endDate() : date);
        boolean grace = half == null || date.isBefore(from.plusDays(league.eligibilityGraceDays()));

        Map<Long, String> listed = new HashMap<>();
        jdbc.sql("select id, listed_position from player where id in (:ids)").param("ids", playerIds)
                .query((rs, n) -> listed.put(rs.getLong(1), rs.getString(2))).list();

        Map<Long, Usage> usage = new HashMap<>();
        jdbc.sql("""
                select gs.player_id,
                       count(*) filter (where gs.positions ~ '(1B|2B|3B|SS)') as if_games,
                       count(*) filter (where gs.positions ~ '(LF|CF|RF)') as of_games,
                       count(*) filter (where gs.batted) as bat_games,
                       count(*) filter (where gs.pitched and gs.started) as starts,
                       count(*) filter (where gs.pitched and not gs.started) as reliefs
                from game_stat gs join game g on g.id = gs.game_id
                where gs.player_id in (:ids) and g.status = 'FINAL' and g.play_date between :from and :to
                group by gs.player_id
                """).param("ids", playerIds).param("from", from).param("to", to)
                .query((rs, n) -> usage.put(rs.getLong(1), new Usage(rs.getInt(2), rs.getInt(3), rs.getInt(4), rs.getInt(5),
                        rs.getInt(6)))).list();

        for (Long id : playerIds) {
            out.put(id, compute(listed.getOrDefault(id, "UNKNOWN"), usage.getOrDefault(id, Usage.NONE), league, grace));
        }
        return out;
    }

    public record Progress(String listedPosition, int halfNo, LocalDate graceUntil, boolean inGrace, int minGames, int minStarts,
                           int ifGames, int ofGames, int batGames, int starts, int reliefs) {
    }

    /** 位置資格進度（球員資料頁用）：本半季各守位出賽數與門檻。 */
    public Progress progress(League league, long playerId, LocalDate date) {
        SeasonService.Half half = season.currentHalf(league.id(), date).orElse(null);
        LocalDate from = half == null ? LocalDate.of(league.seasonYear(), 1, 1) : half.startDate();
        LocalDate to = half == null ? date : (date.isAfter(half.endDate()) ? half.endDate() : date);
        LocalDate graceUntil = from.plusDays(league.eligibilityGraceDays());
        String listed = jdbc.sql("select listed_position from player where id = ?").param(playerId).query(String.class).single();
        Usage u = jdbc.sql("""
                select count(*) filter (where gs.positions ~ '(1B|2B|3B|SS)'),
                       count(*) filter (where gs.positions ~ '(LF|CF|RF)'),
                       count(*) filter (where gs.batted),
                       count(*) filter (where gs.pitched and gs.started),
                       count(*) filter (where gs.pitched and not gs.started)
                from game_stat gs join game g on g.id = gs.game_id
                where gs.player_id = ? and g.status = 'FINAL' and g.play_date between ? and ?
                """).params(playerId, from, to)
                .query((rs, n) -> new Usage(rs.getInt(1), rs.getInt(2), rs.getInt(3), rs.getInt(4), rs.getInt(5))).single();
        return new Progress(listed, half == null ? 1 : half.halfNo(), graceUntil, date.isBefore(graceUntil),
                league.positionMinGames(), league.spMinStarts(), u.ifGames(), u.ofGames(), u.batGames(), u.starts(), u.reliefs());
    }

    public Set<Slot> eligibility(League league, long playerId, LocalDate date) {
        return eligibility(league, java.util.List.of(playerId), date).get(playerId);
    }

    static Set<Slot> compute(String listed, Usage u, League league, boolean grace) {
        Set<Slot> s = EnumSet.noneOf(Slot.class);
        boolean listedPitcher = "P".equals(listed);
        // 野手
        if (!listedPitcher || u.batGames() >= league.positionMinGames()) {
            s.add(Slot.UTIL);
        }
        if ("IF".equals(listed) || u.ifGames() >= league.positionMinGames()) {
            s.add(Slot.IF);
        }
        if ("OF".equals(listed) || u.ofGames() >= league.positionMinGames()) {
            s.add(Slot.OF);
        }
        // 投手
        boolean pitcher = listedPitcher || u.starts() + u.reliefs() > 0;
        if (pitcher) {
            if (grace && listedPitcher) {
                s.add(Slot.SP);
                s.add(Slot.RP);
            } else {
                boolean sp = u.starts() >= league.spMinStarts();
                if (sp) {
                    s.add(Slot.SP);
                }
                if (!sp || u.reliefs() > 0) {
                    s.add(Slot.RP);
                }
            }
        }
        if ("UNKNOWN".equals(listed) && s.isEmpty()) {
            s.add(Slot.UTIL);
        }
        return s;
    }
}
