package tw.cpblf.common;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * 所有會改變 roster 的操作都在同一個 transaction 中先鎖定聯盟列，確保同一球員不會同時被兩隊取得。
 */
@Component
public class LeagueLock {

    private final JdbcClient jdbc;

    public LeagueLock(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void lock(long leagueId) {
        jdbc.sql("select id from league where id = ? for update").param(leagueId).query(Long.class).single();
    }
}
