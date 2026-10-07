package tw.cpblf.pipeline;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

import tw.cpblf.config.AppProperties;
import tw.cpblf.draft.DraftService;

/**
 * 排程（Asia/Taipei）。demo 模式下每日型工作改由「快轉一天」驅動，避免真實時鐘與模擬時鐘錯位。
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "cpblf.scheduler-enabled", havingValue = "true")
public class PipelineScheduler {

    private static final Logger log = LoggerFactory.getLogger(PipelineScheduler.class);
    private static final String ZONE = "Asia/Taipei";

    private final Pipeline pipeline;
    private final DraftService drafts;
    private final boolean demo;

    public PipelineScheduler(Pipeline pipeline, DraftService drafts, AppProperties props) {
        this.pipeline = pipeline;
        this.drafts = drafts;
        // demo 與重播模式：每日型工作由「快轉」驅動
        this.demo = props.clockAdjustable();
    }

    // ---- 每日型（僅正式模式）----

    @Scheduled(cron = "0 10 0 * * *", zone = ZONE)
    void maintenance() {
        if (!demo) pipeline.dailyMaintenance();
    }

    @Scheduled(cron = "0 30 5 * * *", zone = ZONE)
    void registration() {
        if (!demo) pipeline.syncRegistration();
    }

    @Scheduled(cron = "0 0 6 * * *", zone = ZONE)
    void schedule() {
        if (!demo) pipeline.pollSchedule();
    }

    @Scheduled(cron = "0 0 9 * * *", zone = ZONE)
    void summary() {
        if (!demo) pipeline.dailySummary();
    }

    @Scheduled(cron = "0 0 4 * * MON", zone = ZONE)
    void reconcile() {
        if (!demo) pipeline.reconcile();
    }

    @Scheduled(cron = "0 0 */3 29-31 8 *", zone = ZONE)
    void deadlineAug() {
        if (!demo) pipeline.registrationDeadlineSync();
    }

    @Scheduled(cron = "0 0 */3 1-2 9 *", zone = ZONE)
    void deadlineSep() {
        if (!demo) pipeline.registrationDeadlineSync();
    }

    // ---- 週期型（兩種模式皆執行；各自只處理已到期項目）----

    @Scheduled(fixedDelayString = "#{${cpblf.crawler.live-poll-interval-seconds} * 1000}", initialDelay = 30_000)
    void live() {
        pipeline.livePoll();
    }

    @Scheduled(fixedDelay = 600_000, initialDelay = 60_000)
    void settlement() {
        pipeline.settle();
    }

    @Scheduled(fixedDelay = 300_000, initialDelay = 45_000)
    void periodic() {
        pipeline.processWaivers();
        pipeline.processTrades();
        pipeline.progressMatchups();
    }

    @Scheduled(fixedDelay = 1000, initialDelay = 5000)
    void draftClock() {
        // 管理員按開始 → 馬上揭曉 → 動畫播完自動開始第一手（docs/decisions.md「選秀與 keeper」）
        for (Long id : drafts.dueStarts()) {
            try {
                drafts.start(id);
            } catch (Exception e) {
                log.error("auto start failed for draft {}", id, e);
            }
        }
        for (Long id : drafts.overdueDrafts()) {
            try {
                drafts.autoPick(id);
            } catch (Exception e) {
                log.error("auto pick failed for draft {}", id, e);
            }
        }
    }
}
