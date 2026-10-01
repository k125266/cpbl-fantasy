package tw.cpblf.config;

import java.time.OffsetDateTime;
import java.time.ZoneId;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "cpblf")
public record AppProperties(
        String zone,
        int seasonYear,
        String kindCode,
        String source,
        boolean schedulerEnabled,
        Crawler crawler,
        Demo demo) {

    /** 規則書 10.3：Live Poller 間隔不得低於 60 秒。 */
    public static final int MIN_LIVE_POLL_SECONDS = 60;

    public ZoneId zoneId() {
        return ZoneId.of(zone);
    }

    public boolean isDemo() {
        return "demo".equalsIgnoreCase(source);
    }

    public record Crawler(
            String userAgent,
            String baseUrl,
            int livePollIntervalSeconds,
            long minRequestIntervalMs,
            int maxRetries,
            long initialBackoffMs) {
    }

    public record Demo(OffsetDateTime startAt, long seed, boolean seedLeague) {
    }
}
