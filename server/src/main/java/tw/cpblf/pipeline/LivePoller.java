package tw.cpblf.pipeline;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import tw.cpblf.config.AppClock;
import tw.cpblf.config.AppProperties;
import tw.cpblf.source.CpblDataSource;
import tw.cpblf.source.SourceModels.BoxScore;

/**
 * CPBLF-15：比賽進行中輪詢，只寫 live_game / live_game_stat，絕不觸碰 game_stat。
 * 非比賽時段不發出任何請求（規則書 10.3）。
 */
@Service
public class LivePoller {

    public static final String JOB = "live-poller";
    /** 比賽時段：表定開賽前 15 分鐘至開賽後 5 小時。 */
    static final Duration BEFORE_START = Duration.ofMinutes(15);
    static final Duration MAX_GAME_LENGTH = Duration.ofHours(5);
    static final Duration SCHEDULE_REFRESH = Duration.ofMinutes(10);

    private final CpblDataSource source;
    private final JdbcClient jdbc;
    private final AppClock clock;
    private final AppProperties props;
    private final BoxScoreMapper mapper;
    private final SchedulePoller schedulePoller;
    private final TransactionTemplate tx;
    private volatile Instant lastScheduleRefresh = Instant.EPOCH;

    public LivePoller(CpblDataSource source, JdbcClient jdbc, AppClock clock, AppProperties props, BoxScoreMapper mapper,
                      SchedulePoller schedulePoller, TransactionTemplate tx) {
        this.source = source;
        this.jdbc = jdbc;
        this.clock = clock;
        this.props = props;
        this.mapper = mapper;
        this.schedulePoller = schedulePoller;
        this.tx = tx;
    }

    record LiveGame(long id, int year, String kind, int sno, String home, String away) {
    }

    /** 目前是否處於比賽時段（有任何未結束且已接近開賽的比賽）。 */
    public List<LiveGame> gamesInWindow() {
        Instant now = clock.now();
        return jdbc.sql("""
                select id, season_year, kind_code, game_sno, home_team_code, away_team_code from game
                where status in ('SCHEDULED', 'IN_PROGRESS') and start_time is not null
                  and start_time <= ? and start_time > ?
                order by game_sno
                """).params(Timestamp.from(now.plus(BEFORE_START)), Timestamp.from(now.minus(MAX_GAME_LENGTH)))
                .query((rs, n) -> new LiveGame(rs.getLong(1), rs.getInt(2), rs.getString(3), rs.getInt(4), rs.getString(5),
                        rs.getString(6)))
                .list();
    }

    public void poll(JobRunner.JobContext ctx) {
        List<LiveGame> games = gamesInWindow();
        if (games.isEmpty()) {
            return;
        }
        // 偵測比賽結束需要賽程狀態；比賽時段內每 10 分鐘更新一次
        if (Duration.between(lastScheduleRefresh, clock.now()).compareTo(SCHEDULE_REFRESH) >= 0) {
            schedulePoller.poll(ctx);
            lastScheduleRefresh = clock.now();
            games = gamesInWindow();
        }
        Instant now = clock.now();
        for (LiveGame g : games) {
            if (now.isBefore(startTime(g.id()))) {
                continue;
            }
            BoxScore box = source.fetchBoxScore(g.year(), g.kind(), g.sno());
            if (box.batters().isEmpty() && box.pitchers().isEmpty()) {
                continue;
            }
            Map<Long, StatRow> rows = mapper.map(box, g.home(), g.away());
            tx.executeWithoutResult(s -> write(g, box, rows, now));
            ctx.item();
        }
    }

    private Instant startTime(long gameId) {
        return jdbc.sql("select start_time from game where id = ?").param(gameId).query(Timestamp.class).single().toInstant();
    }

    private void write(LiveGame g, BoxScore box, Map<Long, StatRow> rows, Instant now) {
        Timestamp ts = Timestamp.from(now);
        jdbc.sql("""
                insert into live_game (game_id, inning_text, home_score, away_score, fetched_at) values (?, ?, ?, ?, ?)
                on conflict (game_id) do update set inning_text = excluded.inning_text, home_score = excluded.home_score,
                    away_score = excluded.away_score, fetched_at = excluded.fetched_at
                """).params(g.id(), box.inningText(), box.homeScore(), box.awayScore(), ts).update();
        jdbc.sql("delete from live_game_stat where game_id = ?").param(g.id()).update();
        rows.forEach((pid, s) -> jdbc.sql("""
                insert into live_game_stat (game_id, player_id, team_code, batted, pa, ab, r, h, hr, rbi, sb, bb,
                                            pitched, started, outs, p_h, p_bb, p_er, p_k, sv, hld, w, fetched_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """).params(g.id(), pid, s.teamCode(), s.batted(), s.pa(), s.ab(), s.r(), s.h(), s.hr(), s.rbi(), s.sb(), s.bb(),
                s.pitched(), s.started(), s.outs(), s.pH(), s.pBb(), s.pEr(), s.pK(), s.sv(), s.hld(), s.w(), ts).update());
    }

    public int intervalSeconds() {
        return Math.max(AppProperties.MIN_LIVE_POLL_SECONDS, props.crawler().livePollIntervalSeconds());
    }
}
