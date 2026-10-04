package tw.cpblf.pipeline;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import tw.cpblf.card.WeeklyMvpService;
import tw.cpblf.common.Json;
import tw.cpblf.config.AppClock;
import tw.cpblf.config.AppProperties;
import tw.cpblf.league.League;
import tw.cpblf.league.LeagueService;
import tw.cpblf.roster.RosterService;
import tw.cpblf.scoring.MatchupService;
import tw.cpblf.source.CpblDataSource;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.trade.TradeService;
import tw.cpblf.waiver.WaiverService;

/** 所有排程工作的進入點，每個都經過 JobRunner 記錄。排程器與 demo 快轉共用。 */
@Service
public class Pipeline {

    private final JobRunner runner;
    private final SchedulePoller schedule;
    private final RegistrationSync registration;
    private final SettlementJob settlement;
    private final LivePoller live;
    private final MatchupService matchups;
    private final RosterService roster;
    private final WaiverService waivers;
    private final TradeService trades;
    private final LeagueService leagues;
    private final AlertService alerts;
    private final CpblDataSource source;
    private final BoxScoreMapper mapper;
    private final JdbcClient jdbc;
    private final AppClock clock;
    private final AppProperties props;
    private final WeeklyMvpService weeklyMvp;

    public Pipeline(JobRunner runner, SchedulePoller schedule, RegistrationSync registration, SettlementJob settlement,
                    LivePoller live, MatchupService matchups, RosterService roster, WaiverService waivers, TradeService trades,
                    LeagueService leagues, AlertService alerts, CpblDataSource source, BoxScoreMapper mapper, JdbcClient jdbc,
                    AppClock clock, AppProperties props, WeeklyMvpService weeklyMvp) {
        this.weeklyMvp = weeklyMvp;
        this.runner = runner;
        this.schedule = schedule;
        this.registration = registration;
        this.settlement = settlement;
        this.live = live;
        this.matchups = matchups;
        this.roster = roster;
        this.waivers = waivers;
        this.trades = trades;
        this.leagues = leagues;
        this.alerts = alerts;
        this.source = source;
        this.mapper = mapper;
        this.jdbc = jdbc;
        this.clock = clock;
        this.props = props;
    }

    public void pollSchedule() {
        runner.run(SchedulePoller.JOB, schedule::poll);
    }

    public void syncRegistration() {
        runner.run(RegistrationSync.JOB, registration::sync);
    }

    public void settle() {
        runner.run(SettlementJob.JOB, ctx -> {
            Set<LocalDate> dates = settlement.run(ctx);
            matchups.recomputeForDates(dates);
        });
    }

    public void livePoll() {
        if (live.gamesInWindow().isEmpty()) {
            // 非比賽時段：不發請求、不寫紀錄
            return;
        }
        runner.run(LivePoller.JOB, live::poll);
    }

    public void progressMatchups() {
        runner.run("matchup-progress", ctx -> matchups.progress());
    }

    /** 每日維護：註銷自動釋出、NA 回歸、對戰期推進。 */
    public void dailyMaintenance() {
        runner.run("roster-maintenance", ctx -> {
            for (Long id : leagueIds()) {
                League league = leagues.get(id);
                int released = roster.releaseDelisted(league);
                roster.resolveAllNaReturns(league);
                weeklyMvp.refresh(id);
                ctx.items(released);
                if (released > 0) {
                    ctx.note("聯盟 " + id + " 自動釋出註銷球員 " + released + " 名");
                }
            }
            matchups.progress();
        });
    }

    public void processWaivers() {
        runner.run("waiver", ctx -> {
            for (Long id : leagueIds()) {
                ctx.items(waivers.process(id));
            }
        });
    }

    public void processTrades() {
        runner.run("trade-review", ctx -> ctx.items(trades.processDue()));
    }

    /** CPBLF-60：每日摘要（處理場次、修正筆數、異常數）。 */
    public void dailySummary() {
        runner.run("daily-summary", ctx -> {
            Map<String, Object> row = jdbc.sql("""
                    select coalesce(sum(items_processed) filter (where job_name = 'settlement'), 0) as games,
                           coalesce(sum(revisions), 0) as revisions,
                           coalesce(sum(anomalies), 0) as anomalies,
                           count(*) filter (where status in ('FAILED', 'STOPPED')) as failures
                    from job_run where started_at > now() - interval '24 hours'
                    """).query().singleRow();
            String msg = "過去 24 小時：結算 " + row.get("games") + " 場次、數據修正 " + row.get("revisions") + " 筆、異常 "
                    + row.get("anomalies") + " 件、job 失敗 " + row.get("failures") + " 次";
            ctx.note(msg);
            alerts.raise(AlertService.Level.INFO, "daily-summary", msg);
        });
    }

    /**
     * CPBLF-16 / CPBLF-62：當季全量對帳。重新取得已定版比賽的 box score 與 game_stat 比對，
     * 只輸出差異清單並告警，不自動修正（需人工以「重新結算」確認）。
     */
    public List<String> reconcile() {
        List<String> diffs = new ArrayList<>();
        runner.run("reconciliation", ctx -> {
            record G(long id, int year, String kind, int sno, String home, String away) {
            }
            List<G> games = jdbc.sql("""
                    select id, season_year, kind_code, game_sno, home_team_code, away_team_code from game
                    where stats_final and season_year = ? order by game_sno
                    """).param(props.seasonYear()).query((rs, n) -> new G(rs.getLong(1), rs.getInt(2), rs.getString(3),
                    rs.getInt(4), rs.getString(5), rs.getString(6))).list();
            for (G g : games) {
                BoxScore box = source.fetchBoxScore(g.year(), g.kind(), g.sno());
                Map<Long, StatRow> fresh;
                try {
                    fresh = mapper.map(box, g.home(), g.away());
                } catch (BoxScoreMapper.UnknownPlayerException e) {
                    diffs.add("第 " + g.sno() + " 場：" + e.getMessage());
                    continue;
                }
                Map<Long, StatRow> stored = new java.util.HashMap<>();
                jdbc.sql("select * from game_stat where game_id = ?").param(g.id())
                        .query((rs, n) -> stored.put(rs.getLong("player_id"), StatRow.fromResultSet(rs))).list();
                Set<Long> all = new java.util.HashSet<>(fresh.keySet());
                all.addAll(stored.keySet());
                for (Long pid : all) {
                    StatRow a = stored.get(pid);
                    StatRow b = fresh.get(pid);
                    if (a == null || b == null || !a.values().equals(b.values())) {
                        diffs.add("第 " + g.sno() + " 場 player#" + pid + "：DB=" + (a == null ? "無" : Json.write(a.values()))
                                + " 官網=" + (b == null ? "無" : Json.write(b.values())));
                    }
                }
                ctx.item();
            }
            ctx.note("差異 " + diffs.size() + " 筆");
            if (!diffs.isEmpty()) {
                ctx.anomaly();
                alerts.raise(AlertService.Level.WARN, "reconciliation", "對帳發現 " + diffs.size() + " 筆差異（未自動修正）：\n"
                        + String.join("\n", diffs.subList(0, Math.min(30, diffs.size()))));
            }
        });
        return diffs;
    }

    /** CPBLF-61：8/31 註冊大限前後的全量名單同步；大量異動時產出報表供人工確認。 */
    public void registrationDeadlineSync() {
        runner.run("registration-deadline", ctx -> {
            RegistrationSync.SyncResult r = registration.sync(ctx);
            if (r.total() >= 10) {
                List<Map<String, Object>> changes = registration.changesOn(clock.today());
                StringBuilder sb = new StringBuilder("註冊大限名單大量異動 " + r.total() + " 筆，請人工確認：\n");
                changes.stream().limit(60).forEach(c -> sb.append(c.get("team")).append(" ").append(c.get("name")).append(" ")
                        .append(c.get("field")).append(" ").append(c.get("old_value")).append(" → ").append(c.get("new_value"))
                        .append("\n"));
                alerts.raise(AlertService.Level.WARN, "registration-deadline", sb.toString());
            }
        });
    }

    private List<Long> leagueIds() {
        return jdbc.sql("select id from league order by id").query(Long.class).list();
    }
}
