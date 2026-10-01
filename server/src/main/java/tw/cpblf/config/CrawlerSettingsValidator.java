package tw.cpblf.config;

import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;

/**
 * CPBLF-71：頻率與識別設定不合規時啟動失敗，而不是默默修正。
 */
@Component
public class CrawlerSettingsValidator {

    private final AppProperties props;

    public CrawlerSettingsValidator(AppProperties props) {
        this.props = props;
    }

    @PostConstruct
    void validate() {
        validate(props.crawler());
    }

    public static void validate(AppProperties.Crawler crawler) {
        if (crawler == null) {
            throw new IllegalStateException("cpblf.crawler 設定缺失");
        }
        if (crawler.userAgent() == null || crawler.userAgent().isBlank()) {
            throw new IllegalStateException("cpblf.crawler.user-agent 為必填（規則書 10.3）");
        }
        if (crawler.livePollIntervalSeconds() < AppProperties.MIN_LIVE_POLL_SECONDS) {
            throw new IllegalStateException("cpblf.crawler.live-poll-interval-seconds 不得低於 "
                    + AppProperties.MIN_LIVE_POLL_SECONDS + " 秒（目前為 " + crawler.livePollIntervalSeconds() + "）");
        }
        if (crawler.minRequestIntervalMs() < 1000) {
            throw new IllegalStateException("cpblf.crawler.min-request-interval-ms 不得低於 1000");
        }
    }
}
