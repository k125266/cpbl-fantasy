package tw.cpblf.config;

import java.time.OffsetDateTime;
import java.time.ZoneId;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "cpblf")
public record AppProperties(
        String zone,
        int seasonYear,
        String kindCode,
        java.util.List<String> postseasonKindCodes,
        java.util.Map<String, Series> postseasonSeries,
        String source,
        boolean schedulerEnabled,
        Crawler crawler,
        Demo demo,
        Replay replay) {

    /** 規則書 10.3：Live Poller 間隔不得低於 60 秒。 */
    public static final int MIN_LIVE_POLL_SECONDS = 60;

    /**
     * 賽程與即時輪詢追蹤的所有賽事：例行賽在前，接著是季後賽。季後賽只做即時比分，
     * 不結算、不計入 fantasy（docs/decisions.md「賽季結構」）。
     */
    public java.util.List<String> trackedKindCodes() {
        java.util.List<String> out = new java.util.ArrayList<>(java.util.List.of(kindCode));
        if (postseasonKindCodes != null) {
            postseasonKindCodes.stream().filter(k -> !k.isBlank() && !k.equals(kindCode)).forEach(out::add);
        }
        return out;
    }

    /**
     * 季後賽一個系列戰的賽制。
     *
     * @param name          專區顯示的賽事名稱
     * @param winsNeeded    先拿到幾勝晉級（三勝制 3、七戰四勝 4）
     * @param advantageTeam 保送 1 勝的球隊代碼（每年依規定更新）；沒有優勢時為 null
     */
    public record Series(String name, int winsNeeded, String advantageTeam) {
    }

    /** 某個賽事代碼的賽制；沒設定的代碼退回「代碼名稱、先拿 4 勝、無優勢」。 */
    public Series series(String kind) {
        Series s = postseasonSeries == null ? null : postseasonSeries.get(kind);
        return s != null ? s : new Series("季後賽 " + kind, 4, null);
    }

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
