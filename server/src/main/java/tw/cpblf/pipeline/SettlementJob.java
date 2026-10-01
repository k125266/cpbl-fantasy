package tw.cpblf.pipeline;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import tw.cpblf.common.Json;
import tw.cpblf.config.AppClock;
import tw.cpblf.config.AppProperties;
import tw.cpblf.source.CpblDataSource;
import tw.cpblf.source.SourceModels.BoxScore;

/**
 * CPBLF-14：game_stat 的唯一寫入者。
 *
 * <ul>
 *   <li>只處理已結束（FINAL）的比賽</li>
 *   <li>新資料 insert，revision = 1；數值相同時跳過且不更新 updated_at</li>
 *   <li>數值不同時覆寫同列、revision + 1，並寫入 stat_revision_log</li>
 *   <li>遇未知 player_id 中斷該場並告警</li>
 *   <li>is_final：官網狀態為結束，且連續 24 小時無 revision</li>
 * </ul>
 * 重複執行結果一致：每次都以官方完整 box score 覆寫比對，不做累加。
 */
@Service
public class SettlementJob {

    public static final String JOB = "settlement";
    public static final Duration FINAL_QUIET_PERIOD = Duration.ofHours(24);

    private final CpblDataSource source;
    private final JdbcClient jdbc;
    private final AppClock clock;
    private final AppProperties props;
    private final BoxScoreMapper mapper;
    private final AlertService alerts;
    private final TransactionTemplate tx;

    public SettlementJob(CpblDataSource source, JdbcClient jdbc, AppClock clock, AppProperties props, BoxScoreMapper mapper,
                         AlertService alerts, TransactionTemplate tx) {
        this.source = source;
        this.jdbc = jdbc;
        this.clock = clock;
        this.props = props;
        this.mapper = mapper;
        this.alerts = alerts;
        this.tx = tx;
    }

    record GameRef(long id, int year, String kindCode, int sno, String home, String away, LocalDate playDate,
                   Instant finalSeenAt, Instant lastSettledAt, Instant lastRevisionAt) {
    }

    public record GameResult(int inserted, int revised, int unchanged, boolean becameFinal) {
    }

    /** 選出需要結算的比賽：剛結束的頻繁檢查，之後放慢直到 is_final。 */
    public List<GameRef> dueGames() {
        Instant now = clock.now();
        return jdbc.sql("""
                select id, season_year, kind_code, game_sno, home_team_code, away_team_code, play_date,
                       final_seen_at, last_settled_at, last_revision_at
                from game
                where status = 'FINAL' and not stats_final and season_year = ? and kind_code = ?
                order by play_date, game_sno
                """).params(props.seasonYear(), props.kindCode())
                .query((rs, n) -> new GameRef(rs.getLong(1), rs.getInt(2), rs.getString(3), rs.getInt(4), rs.getString(5),
                        rs.getString(6), rs.getObject(7, LocalDate.class), instant(rs.getTimestamp(8)),
                        instant(rs.getTimestamp(9)), instant(rs.getTimestamp(10))))
                .list().stream()
                .filter(g -> {
                    if (g.lastSettledAt() == null) {
                        return true;
                    }
                    Instant finalSeen = g.finalSeenAt() == null ? g.lastSettledAt() : g.finalSeenAt();
                    Duration interval = Duration.between(finalSeen, now).compareTo(Duration.ofHours(3)) < 0
                            ? Duration.ofMinutes(25) : Duration.ofHours(6);
                    return !g.lastSettledAt().plus(interval).isAfter(now);
                })
                .toList();
    }

    /** 執行一輪結算，回傳受影響的比賽日期（供對戰重算）。 */
    public Set<LocalDate> run(JobRunner.JobContext ctx) {
        Set<LocalDate> dates = new TreeSet<>();
        for (GameRef g : dueGames()) {
            try {
                GameResult r = settle(g);
                ctx.item();
                ctx.revision(r.revised());
                if (r.inserted() > 0 || r.revised() > 0 || r.becameFinal()) {
                    dates.add(g.playDate());
                }
            } catch (BoxScoreMapper.UnknownPlayerException e) {
                ctx.anomaly();
                alerts.raise(AlertService.Level.ERROR, JOB, "第 " + g.sno() + " 場結算中斷：" + e.getMessage());
            }
        }
        return dates;
    }

    public GameResult settleById(long gameId) {
        GameRef g = jdbc.sql("""
                select id, season_year, kind_code, game_sno, home_team_code, away_team_code, play_date,
                       final_seen_at, last_settled_at, last_revision_at
                from game where id = ? and status = 'FINAL'
                """).param(gameId)
                .query((rs, n) -> new GameRef(rs.getLong(1), rs.getInt(2), rs.getString(3), rs.getInt(4), rs.getString(5),
                        rs.getString(6), rs.getObject(7, LocalDate.class), instant(rs.getTimestamp(8)),
                        instant(rs.getTimestamp(9)), instant(rs.getTimestamp(10))))
                .optional().orElseThrow(() -> new IllegalArgumentException("比賽不存在或尚未結束：" + gameId));
        return settle(g);
    }

    GameResult settle(GameRef g) {
        BoxScore box = source.fetchBoxScore(g.year(), g.kindCode(), g.sno());
        return tx.execute(status -> apply(g, box));
    }

    /** 將一份完整 box score 套用到 game_stat。可重複執行。 */
    GameResult apply(GameRef g, BoxScore box) {
        Map<Long, StatRow> incoming = mapper.map(box, g.home(), g.away());
        Instant now = clock.now();
        int inserted = 0, revised = 0, unchanged = 0;

        Map<Long, StatRow> existing = new java.util.HashMap<>();
        Map<Long, Integer> revisions = new java.util.HashMap<>();
        jdbc.sql("select * from game_stat where game_id = ?").param(g.id())
                .query((rs, n) -> {
                    existing.put(rs.getLong("player_id"), StatRow.fromResultSet(rs));
                    revisions.put(rs.getLong("player_id"), rs.getInt("revision"));
                    return null;
                }).list();

        // 原本有數據、修正後從 box score 消失的球員：歸零（視為修正）
        for (Long pid : existing.keySet()) {
            if (!incoming.containsKey(pid)) {
                StatRow old = existing.get(pid);
                incoming.put(pid, new StatRow(old.teamCode(), false, "", 0, 0, 0, 0, 0, 0, 0, 0, false, false, 0, 0, 0, 0, 0, 0, 0));
            }
        }

        for (Map.Entry<Long, StatRow> e : incoming.entrySet()) {
            long pid = e.getKey();
            StatRow row = e.getValue();
            StatRow old = existing.get(pid);
            if (old == null) {
                insert(g.id(), pid, row, now);
                inserted++;
            } else if (old.values().equals(row.values())) {
                unchanged++;
            } else {
                int rev = revisions.get(pid);
                update(g.id(), pid, row, rev + 1, now);
                jdbc.sql("""
                        insert into stat_revision_log (game_id, player_id, old_revision, new_revision, old_values, new_values, created_at)
                        values (?, ?, ?, ?, ?, ?, ?)
                        """).params(g.id(), pid, rev, rev + 1, Json.write(old.values()), Json.write(row.values()), Timestamp.from(now))
                        .update();
                revised++;
            }
        }

        Instant lastChange = (revised > 0 || inserted > 0) ? now : g.lastRevisionAt();
        if (lastChange == null) {
            lastChange = g.finalSeenAt() == null ? now : g.finalSeenAt();
        }
        boolean becameFinal = existing.size() > 0 && revised == 0 && inserted == 0
                && !lastChange.plus(FINAL_QUIET_PERIOD).isAfter(now);
        jdbc.sql("""
                update game set last_settled_at = ?, last_revision_at = ?,
                       stats_final = case when ? then false else (stats_final or ?) end
                where id = ?
                """).params(Timestamp.from(now), Timestamp.from(lastChange), revised > 0, becameFinal, g.id()).update();
        if (becameFinal) {
            jdbc.sql("update game_stat set is_final = true where game_id = ? and not is_final").param(g.id()).update();
        }
        return new GameResult(inserted, revised, unchanged, becameFinal);
    }

    private void insert(long gameId, long playerId, StatRow s, Instant now) {
        jdbc.sql("""
                insert into game_stat (game_id, player_id, team_code, batted, positions, pa, ab, r, h, hr, rbi, sb, bb,
                                       pitched, started, outs, p_h, p_bb, p_er, p_k, sv, hld, revision, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """).params(gameId, playerId, s.teamCode(), s.batted(), s.positions(), s.pa(), s.ab(), s.r(), s.h(), s.hr(),
                s.rbi(), s.sb(), s.bb(), s.pitched(), s.started(), s.outs(), s.pH(), s.pBb(), s.pEr(), s.pK(), s.sv(), s.hld(),
                Timestamp.from(now), Timestamp.from(now)).update();
    }

    private void update(long gameId, long playerId, StatRow s, int revision, Instant now) {
        jdbc.sql("""
                update game_stat set batted = ?, positions = ?, pa = ?, ab = ?, r = ?, h = ?, hr = ?, rbi = ?, sb = ?, bb = ?,
                       pitched = ?, started = ?, outs = ?, p_h = ?, p_bb = ?, p_er = ?, p_k = ?, sv = ?, hld = ?,
                       revision = ?, is_final = false, updated_at = ?
                where game_id = ? and player_id = ?
                """).params(s.batted(), s.positions(), s.pa(), s.ab(), s.r(), s.h(), s.hr(), s.rbi(), s.sb(), s.bb(),
                s.pitched(), s.started(), s.outs(), s.pH(), s.pBb(), s.pEr(), s.pK(), s.sv(), s.hld(), revision,
                Timestamp.from(now), gameId, playerId).update();
    }

    private static Instant instant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}
