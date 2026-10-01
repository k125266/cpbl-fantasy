package tw.cpblf.config;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * 全系統唯一的時間來源。正式環境即系統時鐘；demo 模式可設定偏移以快轉賽季。
 */
@Component
public class AppClock {

    private static final String OFFSET_KEY = "clock.offset_seconds";

    private final ZoneId zone;
    private final boolean adjustable;
    private final JdbcClient jdbc;
    private volatile Duration offset = Duration.ZERO;

    public AppClock(AppProperties props, JdbcClient jdbc) {
        this.zone = props.zoneId();
        this.adjustable = props.isDemo();
        this.jdbc = jdbc;
        if (adjustable) {
            Long stored = jdbc.sql("select value from app_setting where key = ?")
                    .param(OFFSET_KEY).query(Long.class).optional().orElse(null);
            if (stored != null) {
                offset = Duration.ofSeconds(stored);
            } else if (props.demo() != null && props.demo().startAt() != null) {
                setNow(props.demo().startAt().toInstant());
            }
        }
    }

    public Instant now() {
        return Instant.now().plus(offset);
    }

    public LocalDate today() {
        return LocalDate.ofInstant(now(), zone);
    }

    public LocalDateTime localNow() {
        return LocalDateTime.ofInstant(now(), zone);
    }

    public ZoneId zone() {
        return zone;
    }

    public Instant atStartOfDay(LocalDate date) {
        return date.atStartOfDay(zone).toInstant();
    }

    public Instant at(LocalDate date, int hour) {
        return ZonedDateTime.of(date.atTime(hour, 0), zone).toInstant();
    }

    public boolean isAdjustable() {
        return adjustable;
    }

    public synchronized void setNow(Instant target) {
        if (!adjustable) {
            throw new IllegalStateException("時鐘僅在 demo 模式可調整");
        }
        offset = Duration.between(Instant.now(), target);
        jdbc.sql("""
                insert into app_setting (key, value, updated_at) values (?, ?, now())
                on conflict (key) do update set value = excluded.value, updated_at = now()
                """).params(OFFSET_KEY, String.valueOf(offset.toSeconds())).update();
    }
}
