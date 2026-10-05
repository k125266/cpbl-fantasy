package tw.cpblf.api;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tw.cpblf.auth.Auth;
import tw.cpblf.common.ApiException;
import tw.cpblf.config.AppClock;
import tw.cpblf.config.AppProperties;
import tw.cpblf.source.SourceArchive;
import tw.cpblf.demo.DemoService;
import tw.cpblf.league.LeagueService;
import tw.cpblf.pipeline.AlertService;
import tw.cpblf.pipeline.JobRunner;
import tw.cpblf.pipeline.Pipeline;
import tw.cpblf.pipeline.SettlementJob;
import tw.cpblf.scoring.MatchupService;

/** 系統管理員：job 監控、告警、修正歷程、手動作業與 demo 時鐘。 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final JdbcClient jdbc;
    private final JobRunner runner;
    private final AlertService alerts;
    private final Pipeline pipeline;
    private final SettlementJob settlement;
    private final MatchupService matchups;
    private final DemoService demo;
    private final AppClock clock;
    private final AppProperties props;
    private final SourceArchive archive;
    private final LeagueService leagues;

    public AdminController(JdbcClient jdbc, JobRunner runner, AlertService alerts, Pipeline pipeline, SettlementJob settlement,
                           MatchupService matchups, DemoService demo, AppClock clock, AppProperties props, SourceArchive archive,
                           LeagueService leagues) {
        this.leagues = leagues;
        this.props = props;
        this.archive = archive;
        this.jdbc = jdbc;
        this.runner = runner;
        this.alerts = alerts;
        this.pipeline = pipeline;
        this.settlement = settlement;
        this.matchups = matchups;
        this.demo = demo;
        this.clock = clock;
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        Auth.requireAdmin();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("now", clock.localNow().toString());
        out.put("demoClock", clock.isAdjustable());
        out.put("disabledJobs", runner.disabledJobs());
        out.put("jobs", jdbc.sql("""
                select id, job_name, started_at, finished_at, status, items_processed, revisions, anomalies, summary
                from job_run order by id desc limit 60
                """).query().listOfRows());
        out.put("alerts", alerts.recent(50));
        out.put("games", jdbc.sql("""
                select count(*) filter (where status = 'FINAL') as final_games,
                       count(*) filter (where stats_final) as stats_final_games,
                       count(*) filter (where status = 'POSTPONED') as postponed,
                       count(*) filter (where actual_play_date is not null) as makeups
                from game
                """).query().singleRow());
        if (props.isReplay()) {
            Map<String, Object> replay = new LinkedHashMap<>();
            replay.put("archivedGames", archive.count("game"));
            replay.put("archivedPlayers", archive.count("player"));
            replay.put("suggested", archive.suggestedSeason(props.seasonYear(), props.kindCode()));
            // 所有聯盟共用時鐘：列出各聯盟各半季的選秀狀態，快轉前確認
            replay.put("leagues", jdbc.sql("""
                    select l.id as league_id, l.name, h.half_no, h.start_date, coalesce(d.status, 'NONE') as draft_status
                    from league l left join season_half h on h.league_id = l.id
                    left join draft d on d.season_half_id = h.id
                    order by l.id, h.half_no
                    """).query().listOfRows());
            out.put("replay", replay);
        }
        return out;
    }

    // ---- 建盟碼：系統管理員發給各聯盟管理員（封閉註冊，docs/decisions.md「身分與隱私」）----

    @GetMapping("/create-codes")
    public List<LeagueService.CreateCode> createCodes() {
        Auth.requireAdmin();
        return leagues.createCodes();
    }

    @PostMapping("/create-codes")
    public Map<String, String> issueCreateCode() {
        return Map.of("code", leagues.issueCreateCode(Auth.requireAdmin()));
    }

    @PostMapping("/create-codes/{code}/revoke")
    public Map<String, Boolean> revokeCreateCode(@PathVariable String code) {
        Auth.requireAdmin();
        leagues.revokeCreateCode(code);
        return Map.of("ok", true);
    }

    @PostMapping("/jobs/{name}/run")
    public Map<String, Object> run(@PathVariable String name) {
        Auth.requireAdmin();
        switch (name) {
            case "schedule-poller" -> pipeline.pollSchedule();
            case "registration-sync" -> pipeline.syncRegistration();
            case "settlement" -> pipeline.settle();
            case "live-poller" -> pipeline.livePoll();
            case "roster-maintenance" -> pipeline.dailyMaintenance();
            case "waiver" -> pipeline.processWaivers();
            case "trade-review" -> pipeline.processTrades();
            case "matchup-progress" -> pipeline.progressMatchups();
            case "daily-summary" -> pipeline.dailySummary();
            case "reconciliation" -> {
                return Map.of("diffs", pipeline.reconcile());
            }
            case "registration-deadline" -> pipeline.registrationDeadlineSync();
            case "season-archive" -> pipeline.archiveSeason();
            default -> throw ApiException.badRequest("未知 job：" + name);
        }
        return Map.of("ok", true);
    }

    @PostMapping("/jobs/{name}/enable")
    public Map<String, Boolean> enable(@PathVariable String name) {
        Auth.requireAdmin();
        runner.enable(name);
        return Map.of("ok", true);
    }

    @PostMapping("/alerts/{id}/ack")
    public Map<String, Boolean> ack(@PathVariable long id) {
        Auth.requireAdmin();
        alerts.acknowledge(id);
        return Map.of("ok", true);
    }

    /** CPBLF-62：修正歷程查詢。 */
    @GetMapping("/revisions")
    public List<Map<String, Object>> revisions(@RequestParam(defaultValue = "100") int limit) {
        Auth.requireAdmin();
        return jdbc.sql("""
                select r.id, r.created_at, g.game_sno, g.play_date, p.name, r.old_revision, r.new_revision, r.old_values, r.new_values
                from stat_revision_log r join game g on g.id = r.game_id join player p on p.id = r.player_id
                order by r.id desc limit ?
                """).param(limit).query().listOfRows();
    }

    @PostMapping("/games/{gameId}/resettle")
    public Object resettle(@PathVariable long gameId) {
        Auth.requireAdmin();
        SettlementJob.GameResult r = settlement.settleById(gameId);
        LocalDateTime now = clock.localNow();
        jdbc.sql("select play_date from game where id = ?").param(gameId).query(java.time.LocalDate.class).optional()
                .ifPresent(d -> matchups.recomputeForDates(List.of(d)));
        return Map.of("result", r, "at", now.toString());
    }

    public record Advance(int days) {
    }

    @PostMapping("/demo/advance")
    public Map<String, String> advance(@RequestBody Advance req) {
        Auth.requireAdmin();
        return Map.of("now", demo.advanceDays(req.days()));
    }

    public record SetClock(String at) {
    }

    @PostMapping("/demo/clock")
    public Map<String, String> setClock(@RequestBody SetClock req) {
        Auth.requireAdmin();
        return Map.of("now", demo.setClock(LocalDateTime.parse(req.at())));
    }
}
