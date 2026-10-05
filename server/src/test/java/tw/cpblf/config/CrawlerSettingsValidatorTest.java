package tw.cpblf.config;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** CPBLF-71：設定不合規時啟動失敗。 */
class CrawlerSettingsValidatorTest {

    static AppProperties.Crawler crawler(String ua, int liveSeconds) {
        return new AppProperties.Crawler(ua, "https://www.cpbl.com.tw", "https://stats.cpbl.com.tw", liveSeconds, 1500, 3, 2000, true);
    }

    @Test
    void acceptsCompliantSettings() {
        assertThatCode(() -> CrawlerSettingsValidator.validate(crawler("Bot/1.0", 60))).doesNotThrowAnyException();
    }

    @Test
    void rejectsPollingFasterThan60Seconds() {
        assertThatThrownBy(() -> CrawlerSettingsValidator.validate(crawler("Bot/1.0", 59))).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void rejectsMissingUserAgent() {
        assertThatThrownBy(() -> CrawlerSettingsValidator.validate(crawler(" ", 60))).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> CrawlerSettingsValidator.validate(crawler(null, 60))).isInstanceOf(IllegalStateException.class);
    }
}
