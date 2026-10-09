package tw.cpblf.pipeline;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import tw.cpblf.config.AppClock;
import tw.cpblf.config.AppProperties;
import tw.cpblf.source.CpblDataSource;
import tw.cpblf.common.Json;
import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.GameDetail;
import tw.cpblf.source.SourceModels.GameStatus;

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
    /**
     * 比賽日（E26）：官網的開賽時間有時不準（2026-10-09 季後賽第 1 戰顯示 01:05，實際 17:05），所以不能只靠表定開賽時間。
     * 當天還沒結束的比賽從 12:00 起就納入，離表定開賽還早於 BEFORE_START 的那段「早期」每場每 EARLY_INTERVAL 才看一次比賽頁
     * （只確認開打了沒）；進行中的比賽到 FINAL 為止都輪詢（安全上限 MAX_IN_PROGRESS）。非比賽日一次都不抓。
     */
    static final LocalTime DAY_START = LocalTime.of(12, 0);
    static final Duration EARLY_INTERVAL = Duration.ofMinutes(10);
    static final Duration MAX_IN_PROGRESS = Duration.ofHours(12);

    private final CpblDataSource source;
    private final JdbcClient jdbc;
    private final AppClock clock;
    private final AppProperties props;
    private final BoxScoreMapper mapper;
    private final SchedulePoller schedulePoller;
    private final TransactionTemplate tx;
    private volatile Instant lastScheduleRefresh = Instant.EPOCH;
    private final Map<Long, Instant> lastEarlyCheck = new ConcurrentHashMap<>();

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

    /**
     * 目前是否處於比賽時段（有任何未結束且已接近開賽的比賽）。
     *
     * <p>季後賽不結算（沒有賽後重抓），所以賽程更新先把比賽標成 FINAL 時，還要補抓一次最終 box score：
     * 條件是即時快照比 final_seen_at 舊（或根本沒有快照）。抓完 fetched_at 就不早於 final_seen_at，不會重抓。
     */
    public List<LiveGame> gamesInWindow() {
        Instant now = clock.now();
        Instant dayStart = clock.today().atTime(DAY_START).atZone(clock.zone()).toInstant();
        return jdbc.sql("""
                select id, season_year, kind_code, game_sno, home_team_code, away_team_code from game
                where ((start_time is not null and start_time <= ? and start_time > ?)
                       or (play_date = ? and cast(? as boolean))
                       or (status = 'IN_PROGRESS' and start_time is not null and start_time > ?))
                  and (status in ('SCHEDULED', 'IN_PROGRESS')
                       or (status = 'FINAL' and kind_code <> ? and final_seen_at is not null
                           and not exists (select 1 from live_game lg
                                           where lg.game_id = game.id and lg.fetched_at >= game.final_seen_at)))
                order by game_sno
                """).params(Timestamp.from(now.plus(BEFORE_START)), Timestamp.from(now.minus(MAX_GAME_LENGTH)),
                        clock.today(), !now.isBefore(dayStart), Timestamp.from(now.minus(MAX_IN_PROGRESS)), props.kindCode())
                .query((rs, n) -> new LiveGame(rs.getLong(1), rs.getInt(2), rs.getString(3), rs.getInt(4), rs.getString(5),
                        rs.getString(6)))
                .list();
    }

    public void poll(JobRunner.JobContext ctx) {
        List<LiveGame> games = gamesInWindow();
        if (games.isEmpty()) {
            return;
        }
        Instant checkAt = clock.now();
        // 偵測比賽結束需要賽程狀態；比賽時段內每 10 分鐘更新一次（只有「早期」的比賽時不更新，賽程更新要逐場讀比賽頁，太花請求）
        boolean anyNear = games.stream().anyMatch(g -> !isEarly(g.id(), checkAt));
        if (anyNear && Duration.between(lastScheduleRefresh, checkAt).compareTo(SCHEDULE_REFRESH) >= 0) {
            schedulePoller.poll(ctx);
            lastScheduleRefresh = clock.now();
            games = gamesInWindow();
        }
        Instant now = clock.now();
        for (LiveGame g : games) {
            if (isEarly(g.id(), now)) {
                Instant last = lastEarlyCheck.get(g.id());
                // 時鐘往回跳（demo、測試）時不當作「剛檢查過」
                Duration since = last == null ? null : Duration.between(last, now);
                if (since != null && !since.isNegative() && since.compareTo(EARLY_INTERVAL) < 0) {
                    continue;
                }
                lastEarlyCheck.put(g.id(), now);
            }
            BoxScore box = source.fetchBoxScore(g.year(), g.kind(), g.sno());
            if (box.batters().isEmpty() && box.pitchers().isEmpty()) {
                continue;
            }
            learnStart(g.id(), box, now);
            Map<Long, StatRow> rows = mapper.map(box, g.home(), g.away());
            tx.executeWithoutResult(s -> {
                write(g, box, rows, now);
                // 頁面已顯示結束：立即轉為 FINAL（停止輪詢、讓結算開始），不必等下一次賽程更新
                if (box.status() == GameStatus.FINAL && box.homeScore() != null && box.awayScore() != null) {
                    schedulePoller.markFinal(g.id(), box.homeScore(), box.awayScore());
                    // final_seen_at 比這次抓取晚幾毫秒；把 fetched_at 拉到不早於它，季後賽才不會被當成還要補抓
                    jdbc.sql("""
                            update live_game set fetched_at = greatest(fetched_at,
                                (select final_seen_at from game where id = ?)) where game_id = ?
                            """).params(g.id(), g.id()).update();
                }
            });
            ctx.item();
        }
    }

    private Instant startTime(long gameId) {
        Timestamp t = jdbc.sql("select start_time from game where id = ?").param(gameId).query(Timestamp.class).optional().orElse(null);
        return t == null ? null : t.toInstant();
    }

    /** 離表定開賽還早於 BEFORE_START（或沒有表定時間）：表定時間可能不準，只低頻確認。 */
    private boolean isEarly(long gameId, Instant now) {
        Instant start = startTime(gameId);
        return start == null || now.isBefore(start.minus(BEFORE_START));
    }

    /** 比賽頁顯示已開打，但表定開賽時間還沒到：表定時間不準，把實際開賽時間記下來（頁面「幾點開打」也跟著對）。 */
    private void learnStart(long gameId, BoxScore box, Instant now) {
        if (box.status() != GameStatus.IN_PROGRESS && box.status() != GameStatus.FINAL) {
            return;
        }
        jdbc.sql("""
                update game set start_time = ?, status = case when status = 'SCHEDULED' then 'IN_PROGRESS' else status end
                where id = ? and (start_time is null or start_time > ?)
                """).params(Timestamp.from(now), gameId, Timestamp.from(now)).update();
    }

    private void write(LiveGame g, BoxScore box, Map<Long, StatRow> rows, Instant now) {
        Timestamp ts = Timestamp.from(now);
        GameDetail d = box.detail();
        Map<String, Long> ids = playerIds(box);
        jdbc.sql("""
                insert into live_game (game_id, inning_text, home_score, away_score, fetched_at,
                                       line_score, batter_player_id, pitcher_player_id, pitch_count, batter_results, half_inning)
                values (?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?::jsonb, ?::jsonb)
                on conflict (game_id) do update set inning_text = excluded.inning_text, home_score = excluded.home_score,
                    away_score = excluded.away_score, fetched_at = excluded.fetched_at, line_score = excluded.line_score,
                    batter_player_id = excluded.batter_player_id, pitcher_player_id = excluded.pitcher_player_id,
                    pitch_count = excluded.pitch_count, batter_results = excluded.batter_results, half_inning = excluded.half_inning
                """).params(g.id(), box.inningText(), box.homeScore(), box.awayScore(), ts,
                d == null || d.lineScore() == null ? null : Json.write(d.lineScore()),
                d == null ? null : ids.get(d.batterId()), d == null ? null : ids.get(d.pitcherId()),
                d == null ? null : d.pitchCount(),
                d == null ? null : Json.write(d.batterResults()), d == null ? null : Json.write(d.halfInning())).update();

        // 和上一輪比較：數據有變的球員記下 changed_at（即時頁標「剛更新」）
        Map<Long, StatRow> before = new HashMap<>();
        Map<Long, Timestamp> changedBefore = new HashMap<>();
        jdbc.sql("select *, '' as positions from live_game_stat where game_id = ?").param(g.id()).query(rs -> {
            before.put(rs.getLong("player_id"), StatRow.fromResultSet(rs));
            changedBefore.put(rs.getLong("player_id"), rs.getTimestamp("changed_at"));
        });
        Map<Long, BatterLine> lineup = new HashMap<>();
        for (BatterLine b : box.batters()) {
            Long id = ids.get(b.cpblPlayerId());
            if (id != null) lineup.putIfAbsent(id, b);
        }
        jdbc.sql("delete from live_game_stat where game_id = ?").param(g.id()).update();
        // rows 依 box score 出現順序（打者依打序、再來投手依登板順序），存成 box_seq 供即時頁排序
        int order = 0;
        for (Map.Entry<Long, StatRow> e : rows.entrySet()) {
            StatRow s = e.getValue();
            StatRow prev = before.get(e.getKey());
            Timestamp changed = prev == null || !prev.values().equals(s.values()) ? ts : changedBefore.get(e.getKey());
            BatterLine b = lineup.get(e.getKey());
            jdbc.sql("""
                    insert into live_game_stat (game_id, player_id, team_code, batted, pa, ab, r, h, hr, rbi, sb, bb,
                                                pitched, started, outs, p_h, p_bb, p_er, p_k, sv, hld, w, fetched_at, box_seq,
                                                lineup_slot, is_sub, changed_at)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """).params(g.id(), e.getKey(), s.teamCode(), s.batted(), s.pa(), s.ab(), s.r(), s.h(), s.hr(), s.rbi(), s.sb(),
                    s.bb(), s.pitched(), s.started(), s.outs(), s.pH(), s.pBb(), s.pEr(), s.pK(), s.sv(), s.hld(), s.w(), ts,
                    order++, b == null ? null : b.lineupSlot(), b != null && b.sub(), changed).update();
        }
    }

    /** box score 與目前打者、投手的官網球員 ID → 本系統 player.id。 */
    private Map<String, Long> playerIds(BoxScore box) {
        List<String> cpblIds = new ArrayList<>();
        box.batters().forEach(b -> cpblIds.add(b.cpblPlayerId()));
        if (box.detail() != null) {
            if (box.detail().batterId() != null) cpblIds.add(box.detail().batterId());
            if (box.detail().pitcherId() != null) cpblIds.add(box.detail().pitcherId());
        }
        Map<String, Long> out = new HashMap<>();
        if (cpblIds.isEmpty()) {
            return out;
        }
        jdbc.sql("select cpbl_player_id, id from player where cpbl_player_id in (:ids)").param("ids", cpblIds)
                .query(rs -> {
                    out.put(rs.getString(1), rs.getLong(2));
                });
        return out;
    }

    public int intervalSeconds() {
        return Math.max(AppProperties.MIN_LIVE_POLL_SECONDS, props.crawler().livePollIntervalSeconds());
    }
}
