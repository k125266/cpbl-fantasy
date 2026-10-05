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
        Demo demo,
        Replay replay) {

    /** 規則書 10.3：Live Poller 間隔不得低於 60 秒。 */
    public static final int MIN_LIVE_POLL_SECONDS = 60;

    public ZoneId zoneId() {
        return ZoneId.of(zone);
    }

    public boolean isDemo() {
        return "demo".equalsIgnoreCase(source);
    }

    /** E12：以封存的真實球季重播（ReplayDataSource）。 */
    public boolean isReplay() {
        return "replay".equalsIgnoreCase(source);
    }

    /** demo 與重播模式的時鐘可調整，每日型工作改由「快轉」驅動。 */
    public boolean clockAdjustable() {
        return isDemo() || isReplay();
    }

    /**
     * @param baseUrl      官網 www.cpbl.com.tw（source=web）
     * @param statsBaseUrl 中職進階數據網站 stats.cpbl.com.tw（source=stats）
     */
    public record Crawler(
            String userAgent,
            String baseUrl,
            String statsBaseUrl,
            int livePollIntervalSeconds,
            long minRequestIntervalMs,
            int maxRetries,
            long initialBackoffMs,
            /** 是否擷取進行中的賽況細節（目前打者與投手、打席結果代碼）；收到權利人要求時關閉（docs/rulebook-amendments.md） */
            boolean liveDetailEnabled) {
    }

    public record Demo(OffsetDateTime startAt, long seed, boolean seedLeague) {
    }

    /** @param startAt 重播時鐘的起點（開幕前） */
    public record Replay(OffsetDateTime startAt) {
    }
}
