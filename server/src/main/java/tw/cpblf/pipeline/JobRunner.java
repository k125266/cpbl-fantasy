package tw.cpblf.pipeline;

import java.util.List;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import tw.cpblf.config.AppClock;
import tw.cpblf.source.RateLimitedException;

/**
 * 所有 job 的共同外殼：寫入 job_run、處理例外、遇速率限制時停用該 job（需人工重新啟用）。
 */
@Component
public class JobRunner {

    private static final Logger log = LoggerFactory.getLogger(JobRunner.class);

    public static final class JobContext {
        int items;
        int revisions;
        int anomalies;
        final StringBuilder summary = new StringBuilder();

        public void item() {
            items++;
        }

        public void items(int n) {
            items += n;
        }

        public void revision(int n) {
            revisions += n;
        }

        public void anomaly() {
            anomalies++;
        }

        public void note(String s) {
            if (!summary.isEmpty()) {
                summary.append("；");
            }
            summary.append(s);
        }

        public int items() {
            return items;
        }

        public int revisions() {
            return revisions;
        }

        public int anomalies() {
            return anomalies;
        }
    }

    @FunctionalInterface
    public interface Job {
        void run(JobContext ctx);
    }

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final AlertService alerts;

    public JobRunner(JdbcClient jdbc, AppClock clock, AlertService alerts) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.alerts = alerts;
    }

    public Optional<String> disabledReason(String jobName) {
        return jdbc.sql("select value from app_setting where key = ?").param("job.disabled." + jobName)
                .query(String.class).optional();
    }

    public void enable(String jobName) {
        jdbc.sql("delete from app_setting where key = ?").param("job.disabled." + jobName).update();
        alerts.raise(AlertService.Level.INFO, jobName, "已由管理員重新啟用");
    }

    public List<String> disabledJobs() {
        return jdbc.sql("select substring(key from 14) from app_setting where key like 'job.disabled.%'").query(String.class).list();
    }

    public JobContext run(String jobName, Job job) {
        JobContext ctx = new JobContext();
        if (disabledReason(jobName).isPresent()) {
            log.debug("job {} disabled, skip", jobName);
            return ctx;
        }
        long id = jdbc.sql("insert into job_run (job_name, started_at, status) values (?, ?, 'RUNNING') returning id")
                .params(jobName, java.sql.Timestamp.from(clock.now())).query(Long.class).single();
        String status = "SUCCESS";
        try {
            job.run(ctx);
        } catch (RateLimitedException e) {
            status = "STOPPED";
            ctx.note("速率限制：" + e.getMessage());
            jdbc.sql("""
                    insert into app_setting (key, value) values (?, ?)
                    on conflict (key) do update set value = excluded.value, updated_at = now()
                    """).params("job.disabled." + jobName, "rate limited: " + e.getMessage()).update();
            alerts.raise(AlertService.Level.ERROR, jobName, "收到速率限制回應，已停止此 job，需人工確認後重新啟用：" + e.getMessage());
        } catch (Exception e) {
            status = "FAILED";
            ctx.note("失敗：" + e);
            log.error("job {} failed", jobName, e);
            alerts.raise(AlertService.Level.ERROR, jobName, "執行失敗：" + e);
        }
        jdbc.sql("""
                update job_run set finished_at = ?, status = ?, items_processed = ?, revisions = ?, anomalies = ?, summary = ?
                where id = ?
                """).params(java.sql.Timestamp.from(clock.now()), status, ctx.items, ctx.revisions, ctx.anomalies,
                ctx.summary.toString(), id).update();
        return ctx;
    }
}
