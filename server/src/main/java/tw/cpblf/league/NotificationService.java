package tw.cpblf.league;

import java.time.OffsetDateTime;
import java.util.List;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class NotificationService {

    private final JdbcClient jdbc;

    public NotificationService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void notify(long teamId, String message) {
        jdbc.sql("insert into notification (team_id, message) values (?, ?)").params(teamId, message).update();
    }

    public void notifyLeague(long leagueId, String message) {
        jdbc.sql("insert into notification (team_id, message) select id, ? from fantasy_team where league_id = ?")
                .params(message, leagueId).update();
    }

    public record Notification(long id, String message, OffsetDateTime createdAt, boolean read) {
    }

    public List<Notification> list(long teamId) {
        return jdbc.sql("""
                select id, message, created_at, read_at is not null from notification where team_id = ?
                order by created_at desc, id desc limit 50
                """).param(teamId).query((rs, n) -> new Notification(rs.getLong(1), rs.getString(2),
                rs.getObject(3, OffsetDateTime.class), rs.getBoolean(4))).list();
    }

    public void markRead(long teamId) {
        jdbc.sql("update notification set read_at = now() where team_id = ? and read_at is null").param(teamId).update();
    }
}
