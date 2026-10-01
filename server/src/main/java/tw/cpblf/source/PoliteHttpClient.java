package tw.cpblf.source;

import java.io.IOException;
import java.net.CookieManager;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import tw.cpblf.config.AppProperties;
import tw.cpblf.config.CrawlerSettingsValidator;

/**
 * 規則書 10.3 的強制要求集中於此：可識別的 User-Agent、請求最小間隔、指數退避、遇速率限制即停止。
 */
public class PoliteHttpClient {

    private static final Logger log = LoggerFactory.getLogger(PoliteHttpClient.class);

    private final AppProperties.Crawler cfg;
    private final HttpClient client;
    private long lastRequestAt;

    public PoliteHttpClient(AppProperties.Crawler cfg) {
        CrawlerSettingsValidator.validate(cfg);
        this.cfg = cfg;
        this.client = HttpClient.newBuilder()
                .cookieHandler(new CookieManager())
                .followRedirects(HttpClient.Redirect.NORMAL)
                .connectTimeout(Duration.ofSeconds(15))
                .build();
    }

    public String get(String url) {
        return send(base(url).GET().build());
    }

    public String postForm(String url, Map<String, String> form, Map<String, String> headers) {
        String body = form.entrySet().stream()
                .map(e -> enc(e.getKey()) + "=" + enc(e.getValue()))
                .collect(Collectors.joining("&"));
        HttpRequest.Builder b = base(url)
                .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        headers.forEach(b::header);
        return send(b.build());
    }

    private HttpRequest.Builder base(String url) {
        return HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(20))
                .header("User-Agent", cfg.userAgent())
                .header("Accept-Language", "zh-TW,zh;q=0.9");
    }

    private synchronized String send(HttpRequest req) {
        long backoff = cfg.initialBackoffMs();
        for (int attempt = 0; ; attempt++) {
            throttle();
            try {
                HttpResponse<String> res = client.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                int code = res.statusCode();
                if (code == 429 || code == 503 && res.headers().firstValue("Retry-After").isPresent()) {
                    // 不得重試繞過
                    throw new RateLimitedException("HTTP " + code + " from " + req.uri());
                }
                if (code >= 200 && code < 300) {
                    return res.body();
                }
                if (code >= 400 && code < 500) {
                    throw new SourceStructureException("HTTP " + code + " from " + req.uri());
                }
                log.warn("HTTP {} from {} (attempt {})", code, req.uri(), attempt + 1);
            } catch (IOException e) {
                log.warn("I/O error from {} (attempt {}): {}", req.uri(), attempt + 1, e.toString());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupted", e);
            }
            if (attempt + 1 >= cfg.maxRetries()) {
                throw new IllegalStateException("重試 " + cfg.maxRetries() + " 次仍失敗：" + req.uri());
            }
            sleep(backoff);
            backoff *= 2;
        }
    }

    private void throttle() {
        long wait = lastRequestAt + cfg.minRequestIntervalMs() - System.currentTimeMillis();
        if (wait > 0) {
            sleep(wait);
        }
        lastRequestAt = System.currentTimeMillis();
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted", e);
        }
    }

    private static String enc(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }
}
