package tw.cpblf.auth;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Optional;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tw.cpblf.common.ApiException;

/**
 * 最小化身分機制：僅蒐集帳號、顯示名稱與密碼雜湊（規則書 10.4）。
 * Session 以 HttpOnly cookie 承載隨機 token，伺服器端可撤銷。
 */
@Service
public class AuthService {

    static final Duration SESSION_TTL = Duration.ofDays(30);

    private final JdbcClient jdbc;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    private final SecureRandom random = new SecureRandom();

    public AuthService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public CurrentUser register(String username, String displayName, String password) {
        validateCredentials(username, password);
        if (displayName == null || displayName.isBlank() || displayName.length() > 40) {
            throw ApiException.badRequest("顯示名稱需為 1-40 字");
        }
        boolean exists = jdbc.sql("select count(*) from app_user where lower(username) = lower(?)")
                .param(username).query(Integer.class).single() > 0;
        if (exists) {
            throw ApiException.conflict("帳號已被使用");
        }
        // 第一位註冊者為系統管理員（負責資料 pipeline 維運）
        boolean first = jdbc.sql("select count(*) from app_user").query(Integer.class).single() == 0;
        long id = jdbc.sql("""
                insert into app_user (username, display_name, password_hash, is_admin)
                values (?, ?, ?, ?) returning id
                """).params(username, displayName.trim(), encoder.encode(password), first)
                .query(Long.class).single();
        return new CurrentUser(id, username, displayName.trim(), first);
    }

    public CurrentUser createUserIfAbsent(String username, String displayName, String password, boolean admin) {
        return findByUsername(username).orElseGet(() -> {
            long id = jdbc.sql("""
                    insert into app_user (username, display_name, password_hash, is_admin)
                    values (?, ?, ?, ?) returning id
                    """).params(username, displayName, encoder.encode(password), admin).query(Long.class).single();
            return new CurrentUser(id, username, displayName, admin);
        });
    }

    public Optional<CurrentUser> findByUsername(String username) {
        return jdbc.sql("select id, username, display_name, is_admin from app_user where lower(username) = lower(?)")
                .param(username)
                .query((rs, n) -> new CurrentUser(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getBoolean(4)))
                .optional();
    }

    public CurrentUser authenticate(String username, String password) {
        record Row(CurrentUser user, String hash) {
        }
        Row row = jdbc.sql("""
                select id, username, display_name, is_admin, password_hash from app_user where lower(username) = lower(?)
                """).param(username == null ? "" : username)
                .query((rs, n) -> new Row(new CurrentUser(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getBoolean(4)),
                        rs.getString(5)))
                .optional().orElse(null);
        if (row == null || password == null || !encoder.matches(password, row.hash())) {
            throw ApiException.badRequest("帳號或密碼錯誤");
        }
        return row.user();
    }

    public String createSession(long userId) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = HexFormat.of().formatHex(bytes);
        jdbc.sql("insert into user_session (token, user_id, expires_at) values (?, ?, now() + make_interval(days => ?))")
                .params(token, userId, (int) SESSION_TTL.toDays()).update();
        return token;
    }

    public Optional<CurrentUser> resolve(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        return jdbc.sql("""
                select u.id, u.username, u.display_name, u.is_admin
                from user_session s join app_user u on u.id = s.user_id
                where s.token = ? and s.expires_at > now()
                """).param(token)
                .query((rs, n) -> new CurrentUser(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getBoolean(4)))
                .optional();
    }

    public void logout(String token) {
        jdbc.sql("delete from user_session where token = ?").param(token).update();
    }

    /** 刪除帳號（隱私權政策承諾的資料刪除途徑）。仍有聯盟隊伍時拒絕，避免破壞歷史對戰紀錄。 */
    @Transactional
    public void deleteAccount(long userId) {
        int teams = jdbc.sql("select count(*) from fantasy_team where user_id = ?").param(userId).query(Integer.class).single();
        if (teams > 0) {
            throw ApiException.conflict("帳號仍擁有聯盟隊伍，請先由聯盟管理員移交或於賽季結束後刪除");
        }
        jdbc.sql("delete from user_session where user_id = ?").param(userId).update();
        jdbc.sql("delete from app_user where id = ?").param(userId).update();
    }

    private static void validateCredentials(String username, String password) {
        if (username == null || !username.matches("[A-Za-z0-9_]{3,40}")) {
            throw ApiException.badRequest("帳號需為 3-40 個英數字或底線");
        }
        if (password == null || password.length() < 8) {
            throw ApiException.badRequest("密碼至少 8 個字元");
        }
    }
}
