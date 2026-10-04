package tw.cpblf.demo;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import tw.cpblf.common.ApiException;
import tw.cpblf.config.AppClock;
import tw.cpblf.config.AppProperties;
import tw.cpblf.draft.DraftService;
import tw.cpblf.pipeline.Pipeline;

/**
 * demo 與重播模式的時間快轉。每快轉一天，依正式排程的順序執行當日所有工作。
 * 時鐘是全系統共用的，所以重播時所有聯盟同步推進。
 */
@Service
public class DemoService {

    private final AppClock clock;
    private final AppProperties props;
    private final Pipeline pipeline;
    private final DraftService drafts;
    private final JdbcClient jdbc;

    public DemoService(AppClock clock, AppProperties props, Pipeline pipeline, DraftService drafts, JdbcClient jdbc) {
        this.clock = clock;
        this.props = props;
        this.pipeline = pipeline;
        this.drafts = drafts;
        this.jdbc = jdbc;
    }

    private void requireDemo() {
        if (!props.clockAdjustable()) {
            throw ApiException.forbidden("僅 demo 與重播模式可用");
        }
    }

    /**
     * 重播時多個聯盟共用時鐘：快轉若會跨過某聯盟的半季開始日，而該半季的選秀還沒完成，就擋下。
     * 名單自選秀完成的次日（且不早於半季開始日）生效，所以要在開始日之前選完。
     */
    void requireDraftsDone(LocalDate target) {
        if (!props.isReplay()) {
            return;
        }
        List<String> pending = jdbc.sql("""
                select l.name || '（' || h.half_no || ' 半季，' || to_char(h.start_date, 'MM/DD') || ' 開始）'
                from season_half h join league l on l.id = h.league_id
                left join draft d on d.season_half_id = h.id
                where h.start_date > ? and h.start_date <= ? and (d.id is null or d.status <> 'COMPLETED')
                order by h.start_date, l.id
                """).params(clock.today(), target).query(String.class).list();
        if (!pending.isEmpty()) {
            throw ApiException.badRequest("以下聯盟的選秀還沒完成，不能快轉到半季開始日：" + String.join("、", pending));
        }
    }

    /** 快轉 n 天，停在最後一天的 23:30（當日比賽皆已結束並結算）。 */
    public synchronized String advanceDays(int days) {
        requireDemo();
        if (days < 1 || days > 60) {
            throw ApiException.badRequest("一次快轉 1-60 天");
        }
        requireDraftsDone(clock.today().plusDays(days));
        LocalDate d = clock.today();
        // 若今天的晚間結算尚未跑過，先補跑
        if (clock.localNow().toLocalTime().isBefore(LocalTime.of(23, 30))) {
            at(d, 23, 30);
            evening();
            days--;
        }
        for (int i = 0; i < days; i++) {
            d = d.plusDays(1);
            at(d, 0, 10);
            pipeline.dailyMaintenance();
            at(d, 3, 1);
            pipeline.processWaivers();
            at(d, 5, 30);
            pipeline.syncRegistration();
            at(d, 6, 0);
            pipeline.pollSchedule();
            pipeline.progressMatchups();
            at(d, 23, 30);
            evening();
        }
        return clock.localNow().toString();
    }

    /** 跳到指定時間並執行一輪週期性工作（例如跳到比賽中看即時比分）。 */
    public synchronized String setClock(LocalDateTime target) {
        requireDemo();
        Instant t = target.atZone(clock.zone()).toInstant();
        if (t.isBefore(clock.now())) {
            throw ApiException.badRequest("demo 時鐘只能往後調");
        }
        requireDraftsDone(target.toLocalDate());
        clock.setNow(t);
        pipeline.pollSchedule();
        pipeline.livePoll();
        pipeline.settle();
        pipeline.processWaivers();
        pipeline.processTrades();
        pipeline.progressMatchups();
        return clock.localNow().toString();
    }

    private void evening() {
        pipeline.pollSchedule();
        pipeline.settle();
        pipeline.processTrades();
        pipeline.progressMatchups();
        for (Long id : drafts.overdueDrafts()) {
            while (drafts.inProgress(id)) {
                drafts.autoPick(id);
            }
        }
    }

    private void at(LocalDate d, int h, int m) {
        Instant t = d.atTime(h, m).atZone(clock.zone()).toInstant();
        if (t.isAfter(clock.now())) {
            clock.setNow(t);
        }
    }
}
