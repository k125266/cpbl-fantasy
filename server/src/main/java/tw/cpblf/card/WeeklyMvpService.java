package tw.cpblf.card;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tw.cpblf.config.AppClock;

/**
 * 聯盟內週 MVP：每週（一～日）在「當週任一天在本聯盟任一隊名單上」的球員中，各選貢獻分最高的打者與投手。
 *
 * <p>貢獻分與前端 matchups.ts 的 contributionScore 相同（只用來挑人，不影響計分）：
 * 打者 R + 2·HR + H + BB；投手 IP + K + 3·QS + 2·(W+SV) − 2·ER。分數須大於 0；同分取 player_id 較小者。
 */
@Service
public class WeeklyMvpService {

    /** 數據可能在賽後被修正，最近幾個完整週每天重算。 */
    static final int RECOMPUTE_RECENT_WEEKS = 2;

    public record Mvp(LocalDate weekStart, int weekNo, String kind, long playerId) {
    }

    private final JdbcClient jdbc;
    private final AppClock clock;

    public WeeklyMvpService(JdbcClient jdbc, AppClock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** 賽季第一週的週一；聯盟尚未建立賽程時為 null。 */
    LocalDate firstWeek(long leagueId) {
        LocalDate start = jdbc.sql("select min(start_date) from season_half where league_id = ?").param(leagueId)
                .query(LocalDate.class).optional().orElse(null);
        return start == null ? null : start.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }

    /** 補算尚未計算的完整週，並重算最近幾週。回傳重算的週數。 */
    @Transactional
    public int refresh(long leagueId) {
        LocalDate first = firstWeek(leagueId);
        if (first == null) {
            return 0;
        }
        // 已完整結束的最後一週：本週週一的前一週（週日在今天之前）
        LocalDate lastDone = clock.today().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).minusWeeks(1);
        Set<LocalDate> done = new HashSet<>(jdbc.sql("select distinct week_start from weekly_mvp where league_id = ?")
                .param(leagueId).query(LocalDate.class).list());
        int n = 0;
        for (LocalDate w = first; !w.isAfter(lastDone); w = w.plusWeeks(1)) {
            boolean recent = !w.isBefore(lastDone.minusWeeks(RECOMPUTE_RECENT_WEEKS - 1));
            if (!done.contains(w) || recent) {
                compute(leagueId, w);
                n++;
            }
        }
        return n;
    }

    /** 計算某一週並覆寫該週結果（可重複執行）。 */
    void compute(long leagueId, LocalDate weekStart) {
        LocalDate weekEnd = weekStart.plusDays(6);
        jdbc.sql("delete from weekly_mvp where league_id = ? and week_start = ?").params(leagueId, weekStart).update();
        for (String kind : List.of("H", "P")) {
            String score = kind.equals("H")
                    ? "sum(case when gs.batted then gs.r + 2 * gs.hr + gs.h + gs.bb else 0 end)"
                    : "sum(case when gs.pitched then gs.outs / 3.0 + gs.p_k"
                    + " + case when gs.outs >= 18 and gs.p_er <= 3 then 3 else 0 end + 2 * (gs.w + gs.sv) - 2 * gs.p_er else 0 end)";
            String played = kind.equals("H") ? "gs.batted" : "gs.pitched";
            jdbc.sql("""
                    insert into weekly_mvp (league_id, week_start, kind, player_id, score)
                    select :league, :start, :kind, gs.player_id, round((%s)::numeric, 2) as s
                    from game_stat gs join game g on g.id = gs.game_id
                    where g.status = 'FINAL' and g.play_date between :start and :end and %s
                      and gs.player_id in (
                          select re.player_id from roster_entry re join fantasy_team t on t.id = re.team_id
                          where t.league_id = :league and re.valid_from <= :end and (re.valid_to is null or re.valid_to > :start))
                    group by gs.player_id
                    having %s > 0
                    order by s desc, gs.player_id
                    limit 1
                    """.formatted(score, played, score))
                    .param("league", leagueId).param("start", weekStart).param("end", weekEnd).param("kind", kind)
                    .update();
        }
    }

    /** 某位球員在本聯盟拿過的週 MVP（依週排序）。 */
    public List<Mvp> forPlayer(long leagueId, long playerId) {
        LocalDate first = firstWeek(leagueId);
        return jdbc.sql("select week_start, kind from weekly_mvp where league_id = ? and player_id = ? order by week_start, kind")
                .params(leagueId, playerId)
                .query((rs, i) -> {
                    LocalDate w = rs.getObject(1, LocalDate.class);
                    int no = first == null ? 0 : (int) ChronoUnit.WEEKS.between(first, w) + 1;
                    return new Mvp(w, no, rs.getString(2), playerId);
                }).list();
    }
}
