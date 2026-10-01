package tw.cpblf.pipeline;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import tw.cpblf.common.Json;

/** CPBLF-60：失敗、未知球員、結構變動時發出通知。寫入 alert 表，並可選擇轉送 webhook。 */
@Service
public class AlertService {

    private static final Logger log = LoggerFactory.getLogger(AlertService.class);

    public enum Level { INFO, WARN, ERROR }

    private final JdbcClient jdbc;
    private final String webhookUrl;

    public AlertService(JdbcClient jdbc, @Value("${CPBLF_ALERT_WEBHOOK:}") String webhookUrl) {
        this.jdbc = jdbc;
        this.webhookUrl = webhookUrl;
    }

    public void raise(Level level, String source, String message) {
        switch (level) {
            case ERROR -> log.error("[{}] {}", source, message);
            case WARN -> log.warn("[{}] {}", source, message);
            default -> log.info("[{}] {}", source, message);
        }
        jdbc.sql("insert into alert (level, source, message) values (?, ?, ?)")
                .params(level.name(), source, message).update();
        if (level != Level.INFO && webhookUrl != null && !webhookUrl.isBlank()) {
            try {
                HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(webhookUrl))
                        .timeout(Duration.ofSeconds(10))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(Json.write(Map.of("content", "[" + level + "][" + source + "] " + message))))
                        .build(), HttpResponse.BodyHandlers.discarding());
            } catch (Exception e) {
                log.warn("webhook 傳送失敗：{}", e.toString());
            }
        }
    }

    public record AlertRow(long id, String level, String source, String message, java.time.OffsetDateTime createdAt,
                           boolean acknowledged) {
    }

    public List<AlertRow> recent(int limit) {
        return jdbc.sql("select id, level, source, message, created_at, acknowledged from alert order by created_at desc, id desc limit ?")
                .param(limit)
                .query((rs, n) -> new AlertRow(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getObject(5, java.time.OffsetDateTime.class), rs.getBoolean(6)))
                .list();
    }

    public void acknowledge(long id) {
        jdbc.sql("update alert set acknowledged = true where id = ?").param(id).update();
    }
}
