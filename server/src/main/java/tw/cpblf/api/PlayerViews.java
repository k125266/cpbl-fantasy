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

    public record Basic(long id, String cpblId, String name, String team, boolean foreign, String listedPosition,
                        String jerseyNumber) {
    }

    /** 當日比賽。teamScore / oppScore 以該球員所屬球隊為準；inning 僅進行中有值（例：7上）。 */
    public record TodayGame(long gameId, String opponent, boolean home, OffsetDateTime startTime, String status,
                            Integer teamScore, Integer oppScore, String inning) {
    }

    public Map<Long, Basic> basics(Collection<Long> ids) {
        Map<Long, Basic> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        jdbc.sql("select id, cpbl_player_id, name, cpbl_team_code, is_foreign, listed_position, jersey_number from player where id in (:ids)")
                .param("ids", ids)
                .query((rs, n) -> out.put(rs.getLong(1), new Basic(rs.getLong(1), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getBoolean(5), rs.getString(6), rs.getString(7)))).list();
        return out;
    }

    public Map<Long, Set<Slot>> eligibility(League league, Collection<Long> ids) {
        return eligibility.eligibility(league, ids, clock.today());
    }

    public Map<Long, PlayerStatusService.PlayerStatus> statuses(League league, Collection<Long> ids) {
        return statuses.statuses(league, ids, clock.today());
    }

    /** 各中職球隊當日的比賽（含當日宣布延賽者）。比分：已結束取 game，進行中取 live_game。 */
    public Map<String, TodayGame> todayGames(LocalDate date) {
        Map<String, TodayGame> out = new HashMap<>();
        jdbc.sql("""
                select g.id, g.home_team_code, g.away_team_code, g.start_time, g.status,
                       case when g.status = 'FINAL' then g.home_score else coalesce(lg.home_score, g.home_score) end,
                       case when g.status = 'FINAL' then g.away_score else coalesce(lg.away_score, g.away_score) end,
                       case when g.status = 'FINAL' then null else lg.inning_text end
                from game g left join live_game lg on lg.game_id = g.id
                where g.play_date = ? and g.status <> 'CANCELLED'
                """).param(date).query((rs, n) -> {
            OffsetDateTime st = rs.getObject(4, OffsetDateTime.class);
            Integer hs = rs.getObject(6, Integer.class);
            Integer as = rs.getObject(7, Integer.class);
            String inning = rs.getString(8);
            out.put(rs.getString(2), new TodayGame(rs.getLong(1), rs.getString(3), true, st, rs.getString(5), hs, as, inning));
            out.put(rs.getString(3), new TodayGame(rs.getLong(1), rs.getString(2), false, st, rs.getString(5), as, hs, inning));
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

    /** 今日數據一行字與數字。比賽進行中取 live 表（非最終），已結算取 game_stat。 */
    public record TodayLine(String text, boolean live, TodayStats stats) {
    }

    /** 今日數據（隊伍首頁數據格用）：pitched 為 true 時看投球欄位，否則看打擊欄位。 */
    public record TodayStats(boolean pitched, int ab, int h, int hr, int bb, int r, int outs, int er, int k,
                             int sv, int w) {
    }

    public Map<Long, TodayLine> todayLines(Collection<Long> ids, LocalDate date) {
        Map<Long, TodayLine> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        String cols = "player_id, batted, pa, ab, h, hr, r, bb, pitched, outs, p_er, p_k, sv, w";
        for (String table : new String[]{"game_stat", "live_game_stat"}) {
            boolean live = table.startsWith("live");
            jdbc.sql("select s." + cols.replace(", ", ", s.") + " from " + table + " s join game g on g.id = s.game_id"
                            + " where s.player_id in (:ids) and g.play_date = :d" + (live ? " and g.status <> 'FINAL'" : ""))
                    .param("ids", ids).param("d", date)
                    .query((rs, n) -> {
                        StringBuilder sb = new StringBuilder();
                        if (rs.getBoolean("pitched")) {
                            int outs = rs.getInt("outs");
                            sb.append(outs / 3).append('.').append(outs % 3).append(" 局 ").append(rs.getInt("p_er")).append(" 責 ")
                                    .append(rs.getInt("p_k")).append(" K");
                            if (rs.getInt("w") > 0) sb.append("・W");
                            if (rs.getInt("sv") > 0) sb.append("・SV");
                        } else if (rs.getBoolean("batted") && rs.getInt("pa") > 0) {
                            sb.append(rs.getInt("h")).append("/").append(rs.getInt("ab")).append(" H/AB");
                            if (rs.getInt("hr") > 0) sb.append(", ").append(rs.getInt("hr") > 1 ? rs.getInt("hr") + " " : "").append("HR");
                            if (rs.getInt("r") > 0) sb.append(", ").append(rs.getInt("r")).append(" R");
                            if (rs.getInt("bb") > 0) sb.append(", ").append(rs.getInt("bb") > 1 ? rs.getInt("bb") + " " : "").append("BB");
                        }
                        if (!sb.isEmpty()) {
                            TodayStats stats = new TodayStats(rs.getBoolean("pitched"), rs.getInt("ab"), rs.getInt("h"),
                                    rs.getInt("hr"), rs.getInt("bb"), rs.getInt("r"), rs.getInt("outs"),
                                    rs.getInt("p_er"), rs.getInt("p_k"), rs.getInt("sv"), rs.getInt("w"));
                            out.putIfAbsent(rs.getLong("player_id"), new TodayLine(sb.toString(), live, stats));
                        }
                        return null;
                    }).list();
        }
        return out;
    }

    public List<String> sortedSlots(Set<Slot> s) {
        return s.stream().sorted().map(Enum::name).toList();
    }
}
