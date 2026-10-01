package tw.cpblf.api;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import tw.cpblf.config.AppClock;
import tw.cpblf.league.League;
import tw.cpblf.roster.EligibilityService;
import tw.cpblf.roster.PlayerStatusService;
import tw.cpblf.roster.Slot;
import tw.cpblf.scoring.Category;
import tw.cpblf.scoring.StatTotals;

/** 組裝前端用的球員資訊。 */
@Component
public class PlayerViews {

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final EligibilityService eligibility;
    private final PlayerStatusService statuses;

    public PlayerViews(JdbcClient jdbc, AppClock clock, EligibilityService eligibility, PlayerStatusService statuses) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.eligibility = eligibility;
        this.statuses = statuses;
    }

    public record Basic(long id, String cpblId, String name, String team, boolean foreign, String listedPosition) {
    }

    public record TodayGame(long gameId, String opponent, boolean home, OffsetDateTime startTime, String status) {
    }

    public Map<Long, Basic> basics(Collection<Long> ids) {
        Map<Long, Basic> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        jdbc.sql("select id, cpbl_player_id, name, cpbl_team_code, is_foreign, listed_position from player where id in (:ids)")
                .param("ids", ids)
                .query((rs, n) -> out.put(rs.getLong(1), new Basic(rs.getLong(1), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getBoolean(5), rs.getString(6)))).list();
        return out;
    }

    public Map<Long, Set<Slot>> eligibility(League league, Collection<Long> ids) {
        return eligibility.eligibility(league, ids, clock.today());
    }

    public Map<Long, PlayerStatusService.PlayerStatus> statuses(League league, Collection<Long> ids) {
        return statuses.statuses(league, ids, clock.today());
    }

    /** 各中職球隊當日的比賽（含當日宣布延賽者）。 */
    public Map<String, TodayGame> todayGames(LocalDate date) {
        Map<String, TodayGame> out = new HashMap<>();
        jdbc.sql("""
                select id, home_team_code, away_team_code, start_time, status from game
                where play_date = ? and status <> 'CANCELLED'
                """).param(date).query((rs, n) -> {
            OffsetDateTime st = rs.getObject(4, OffsetDateTime.class);
            out.put(rs.getString(2), new TodayGame(rs.getLong(1), rs.getString(3), true, st, rs.getString(5)));
            out.put(rs.getString(3), new TodayGame(rs.getLong(1), rs.getString(2), false, st, rs.getString(5)));
            return null;
        }).list();
        return out;
    }

    public static Map<String, String> statLine(StatTotals t) {
        Map<String, String> m = new java.util.LinkedHashMap<>();
        for (Category c : Category.values()) {
            m.put(c.label, t.display(c));
        }
        m.put("AB", String.valueOf(t.ab()));
        m.put("H", String.valueOf(t.h()));
        m.put("IP", t.inningsPitched());
        return m;
    }

    public List<String> sortedSlots(Set<Slot> s) {
        return s.stream().sorted().map(Enum::name).toList();
    }
}
