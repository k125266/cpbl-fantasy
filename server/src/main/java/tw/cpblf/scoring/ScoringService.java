package tw.cpblf.scoring;

import java.time.LocalDate;
import java.util.List;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * CPBLF-21 / CPBLF-22：以比賽實際開打日 join effective-dated roster，只計先發 slot。
 * 每次都由 game_stat 原始數據重新加總，不使用累加更新。
 */
@Service
public class ScoringService {

    /** 打擊數據只在 IF/OF/UTIL 計分，投球數據只在 SP/RP 計分。 */
    private static final String SUMS = """
            coalesce(sum(case when re.slot in ('IF','OF','UTIL') then gs.ab end), 0) as ab,
            coalesce(sum(case when re.slot in ('IF','OF','UTIL') then gs.h end), 0) as h,
            coalesce(sum(case when re.slot in ('IF','OF','UTIL') then gs.r end), 0) as r,
            coalesce(sum(case when re.slot in ('IF','OF','UTIL') then gs.hr end), 0) as hr,
            coalesce(sum(case when re.slot in ('IF','OF','UTIL') then gs.rbi end), 0) as rbi,
            coalesce(sum(case when re.slot in ('IF','OF','UTIL') then gs.sb end), 0) as sb,
            coalesce(sum(case when re.slot in ('SP','RP') then gs.outs end), 0) as outs,
            coalesce(sum(case when re.slot in ('SP','RP') then gs.p_er end), 0) as er,
            coalesce(sum(case when re.slot in ('SP','RP') then gs.p_h end), 0) as p_h,
            coalesce(sum(case when re.slot in ('SP','RP') then gs.p_bb end), 0) as p_bb,
            coalesce(sum(case when re.slot in ('SP','RP') then gs.p_k end), 0) as k,
            coalesce(sum(case when re.slot in ('SP','RP') then gs.sv end), 0) as sv,
            coalesce(sum(case when re.slot in ('SP','RP') then gs.hld end), 0) as hld,
            coalesce(sum(case when re.slot in ('SP','RP') and gs.outs >= 18 and gs.p_er <= 3 then 1 else 0 end), 0) as qs
            """;

    private static final String FROM = """
            from game_stat gs
            join game g on g.id = gs.game_id
            join roster_entry re on re.player_id = gs.player_id and re.team_id = :team
                 and re.valid_from <= g.play_date and (re.valid_to is null or re.valid_to > g.play_date)
            where g.status = 'FINAL' and g.play_date between :from and :to
              and re.slot in ('IF','OF','UTIL','SP','RP')
            """;

    private final JdbcClient jdbc;

    public ScoringService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public StatTotals teamTotals(long teamId, LocalDate from, LocalDate to) {
        return jdbc.sql("select " + SUMS + FROM)
                .param("team", teamId).param("from", from).param("to", to)
                .query((rs, n) -> totals(rs)).single();
    }

    public record PlayerContribution(long playerId, String name, String cpblTeam, String jerseyNumber, String slots,
                                     StatTotals totals) {
    }

    /** 對戰頁逐人貢獻。 */
    public List<PlayerContribution> contributions(long teamId, LocalDate from, LocalDate to) {
        return jdbc.sql("select p.id as pid, p.name, p.cpbl_team_code, p.jersey_number, string_agg(distinct re.slot, ',') as slots, "
                        + SUMS + FROM.replace("from game_stat gs", "from game_stat gs join player p on p.id = gs.player_id")
                        + " group by p.id, p.name, p.cpbl_team_code, p.jersey_number order by p.name")
                .param("team", teamId).param("from", from).param("to", to)
                .query((rs, n) -> new PlayerContribution(rs.getLong("pid"), rs.getString("name"), rs.getString("cpbl_team_code"),
                        rs.getString("jersey_number"), rs.getString("slots"), totals(rs)))
                .list();
    }

    /** 球員本身（不論 roster）在期間內的數據，用於 FA 頁近期表現與排名。 */
    public StatTotals playerTotals(long playerId, LocalDate from, LocalDate to) {
        return jdbc.sql("""
                select coalesce(sum(gs.ab),0) ab, coalesce(sum(gs.h),0) h, coalesce(sum(gs.r),0) r, coalesce(sum(gs.hr),0) hr,
                       coalesce(sum(gs.rbi),0) rbi, coalesce(sum(gs.sb),0) sb, coalesce(sum(gs.outs),0) outs,
                       coalesce(sum(gs.p_er),0) er, coalesce(sum(gs.p_h),0) p_h, coalesce(sum(gs.p_bb),0) p_bb,
                       coalesce(sum(gs.p_k),0) k, coalesce(sum(gs.sv),0) sv, coalesce(sum(gs.hld),0) hld,
                       coalesce(sum(case when gs.outs >= 18 and gs.p_er <= 3 then 1 else 0 end),0) qs
                from game_stat gs join game g on g.id = gs.game_id
                where gs.player_id = ? and g.status = 'FINAL' and g.play_date between ? and ?
                """).params(playerId, from, to).query((rs, n) -> totals(rs)).single();
    }

    /** 所有球員在期間內的數據（一次查詢）。 */
    public java.util.Map<Long, StatTotals> allPlayerTotals(LocalDate from, LocalDate to) {
        java.util.Map<Long, StatTotals> out = new java.util.HashMap<>();
        jdbc.sql("""
                select gs.player_id, coalesce(sum(gs.ab),0) ab, coalesce(sum(gs.h),0) h, coalesce(sum(gs.r),0) r,
                       coalesce(sum(gs.hr),0) hr, coalesce(sum(gs.rbi),0) rbi, coalesce(sum(gs.sb),0) sb,
                       coalesce(sum(gs.outs),0) outs, coalesce(sum(gs.p_er),0) er, coalesce(sum(gs.p_h),0) p_h,
                       coalesce(sum(gs.p_bb),0) p_bb, coalesce(sum(gs.p_k),0) k, coalesce(sum(gs.sv),0) sv,
                       coalesce(sum(gs.hld),0) hld,
                       coalesce(sum(case when gs.outs >= 18 and gs.p_er <= 3 then 1 else 0 end),0) qs
                from game_stat gs join game g on g.id = gs.game_id
                where g.status = 'FINAL' and g.play_date between ? and ?
                group by gs.player_id
                """).params(from, to).query((rs, n) -> out.put(rs.getLong("player_id"), totals(rs))).list();
        return out;
    }

    static StatTotals totals(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new StatTotals(rs.getLong("ab"), rs.getLong("h"), rs.getLong("r"), rs.getLong("hr"), rs.getLong("rbi"),
                rs.getLong("sb"), rs.getLong("outs"), rs.getLong("er"), rs.getLong("p_h"), rs.getLong("p_bb"), rs.getLong("k"),
                rs.getLong("sv"), rs.getLong("hld"), rs.getLong("qs"));
    }
}
