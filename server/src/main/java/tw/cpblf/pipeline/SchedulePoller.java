package tw.cpblf.pipeline;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tw.cpblf.config.AppClock;
import tw.cpblf.config.AppProperties;
import tw.cpblf.source.CpblDataSource;
import tw.cpblf.source.GameTimes;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.SourceGame;

/**
 * CPBLF-11：抓取當季賽程並 upsert 至 game。
 * 補賽時保留原定日期（scheduled_date），實際開打日寫入 actual_play_date。
 */
@Service
public class SchedulePoller {

    public static final String JOB = "schedule-poller";

    private final CpblDataSource source;
    private final JdbcClient jdbc;
    private final AppClock clock;
    private final AppProperties props;
    private final TeamResolver teams;
    private final AlertService alerts;

    public SchedulePoller(CpblDataSource source, JdbcClient jdbc, AppClock clock, AppProperties props, TeamResolver teams,
                          AlertService alerts) {
        this.source = source;
        this.jdbc = jdbc;
        this.clock = clock;
        this.props = props;
        this.teams = teams;
        this.alerts = alerts;
    }

    @Transactional
    public void poll(JobRunner.JobContext ctx) {
        List<SourceGame> games = source.fetchSchedule(props.seasonYear(), props.kindCode());
        if (games.isEmpty()) {
            alerts.raise(AlertService.Level.WARN, JOB, "賽程回應為空");
            return;
        }
        for (SourceGame g : games) {
            String home = teams.resolve(g.homeTeamName());
            String away = teams.resolve(g.awayTeamName());
            if (home == null || away == null) {
                ctx.anomaly();
                alerts.raise(AlertService.Level.WARN, JOB, "無法辨識球隊：" + g.homeTeamName() + " / " + g.awayTeamName());
                continue;
            }
            upsert(g, home, away);
            ctx.item();
        }
    }

    record Existing(long id, LocalDate scheduledDate, LocalDate actualPlayDate, String status, boolean finalSeen,
                    Instant startTime) {
    }

    void upsert(SourceGame g, String home, String away) {
        Existing ex = jdbc.sql("""
                select id, scheduled_date, actual_play_date, status, final_seen_at is not null, start_time
                from game where season_year = ? and kind_code = ? and game_sno = ?
                """).params(g.year(), g.kindCode(), g.gameSno())
                .query((rs, n) -> new Existing(rs.getLong(1), rs.getObject(2, LocalDate.class),
                        rs.getObject(3, LocalDate.class), rs.getString(4), rs.getBoolean(5),
                        rs.getTimestamp(6) == null ? null : rs.getTimestamp(6).toInstant()))
                .optional().orElse(null);
        Instant startAt = startTime(g, ex);
        GameStatus status = effectiveStatus(g, startAt);
        String result = null;
        if (status == GameStatus.FINAL && g.homeScore() != null && g.awayScore() != null) {
            int c = Integer.compare(g.homeScore(), g.awayScore());
            result = c > 0 ? "HOME_WIN" : c < 0 ? "AWAY_WIN" : "TIE";
        }
        Timestamp start = startAt == null ? null : Timestamp.from(startAt);
        if (ex == null) {
            jdbc.sql("""
                    insert into game (season_year, kind_code, game_sno, scheduled_date, start_time, home_team_code, away_team_code,
                                      status, result, home_score, away_score, final_seen_at)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """).params(g.year(), g.kindCode(), g.gameSno(), g.date(), start, home, away, status.name(), result,
                    g.homeScore(), g.awayScore(), status == GameStatus.FINAL ? Timestamp.from(clock.now()) : null).update();
            return;
        }
        // 日期改變 = 延賽後補賽。原定日期不覆寫。
        LocalDate actual = g.date().equals(ex.scheduledDate()) ? null : g.date();
        jdbc.sql("""
                update game set actual_play_date = ?, start_time = ?, home_team_code = ?, away_team_code = ?, status = ?,
                       result = ?, home_score = ?, away_score = ?,
                       final_seen_at = case when ? and final_seen_at is null then ? else final_seen_at end,
                       updated_at = now()
                where id = ?
                  and (actual_play_date is distinct from ? or start_time is distinct from ? or status <> ?
                       or result is distinct from ? or home_score is distinct from ? or away_score is distinct from ?
                       or home_team_code <> ? or away_team_code <> ?)
                """).params(actual, start, home, away, status.name(), result, g.homeScore(), g.awayScore(),
                status == GameStatus.FINAL, Timestamp.from(clock.now()), ex.id(),
                actual, start, status.name(), result, g.homeScore(), g.awayScore(), home, away).update();
    }

    /**
     * 即時輪詢看到比賽頁已顯示結束時呼叫：立即轉為 FINAL，不必等下一次賽程更新（實測最多晚 10 分鐘）。
     * final_seen_at 只在第一次設定，結算的重算時程以它為準。
     */
    void markFinal(long gameId, int homeScore, int awayScore) {
        int c = Integer.compare(homeScore, awayScore);
        String result = c > 0 ? "HOME_WIN" : c < 0 ? "AWAY_WIN" : "TIE";
        jdbc.sql("""
                update game set status = 'FINAL', result = ?, home_score = ?, away_score = ?,
                       final_seen_at = coalesce(final_seen_at, ?), updated_at = now()
                where id = ? and status <> 'FINAL'
                """).params(result, homeScore, awayScore, Timestamp.from(clock.now()), gameId).update();
    }

    /**
     * 開賽時間：資料源有給就用；沒有時沿用已知的同一天時間（例：開打後賽程列表不再顯示時間），
     * 改期或從未知道時，尚未結束的比賽用預設時間（平日 18:35、週末 17:05），讓即時輪詢能啟動。
     */
    Instant startTime(SourceGame g, Existing ex) {
        if (g.startTime() != null) {
            return g.startTime();
        }
        Instant known = ex == null ? null : ex.startTime();
        if (known != null && known.atZone(clock.zone()).toLocalDate().equals(g.date())) {
            return known;
        }
        if (g.status() == GameStatus.FINAL || g.status() == GameStatus.CANCELLED) {
            return known;
        }
        return GameTimes.defaultStart(g.date());
    }

    /** 官網賽程沒有「進行中」狀態；已過表定開賽時間且尚未結束者視為進行中。 */
    private GameStatus effectiveStatus(SourceGame g, Instant startTime) {
        if (g.status() == GameStatus.SCHEDULED && startTime != null && !clock.now().isBefore(startTime)) {
            return GameStatus.IN_PROGRESS;
        }
        return g.status();
    }
}
