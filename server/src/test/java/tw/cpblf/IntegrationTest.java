package tw.cpblf;

import java.time.OffsetDateTime;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;

import tw.cpblf.config.AppClock;

/** 以真實 PostgreSQL 執行（CPBLF_TEST_DB_URL，預設 localhost/cpblf_test）。每個測試前重建 schema。 */
@SpringBootTest
@ActiveProfiles("test")
public abstract class IntegrationTest {

    public static final OffsetDateTime PRESEASON = OffsetDateTime.parse("2026-03-20T10:00:00+08:00");

    @Autowired
    protected Flyway flyway;
    @Autowired
    protected AppClock clock;
    @Autowired
    protected JdbcClient jdbc;

    @BeforeEach
    void resetDatabase() {
        flyway.clean();
        flyway.migrate();
        clock.setNow(PRESEASON.toInstant());
    }

    protected int count(String sql, Object... params) {
        return jdbc.sql(sql).params(params).query(Integer.class).single();
    }
}
