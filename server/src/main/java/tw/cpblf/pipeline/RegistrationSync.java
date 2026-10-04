package tw.cpblf.pipeline;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tw.cpblf.config.AppClock;
import tw.cpblf.source.CpblDataSource;
import tw.cpblf.source.SourceModels.RegistrationSnapshot;
import tw.cpblf.source.SourceModels.SourcePlayer;

/**
 * CPBLF-12 / CPBLF-13：球員主檔與一軍登錄名單同步。
 *
 * <ul>
 *   <li>以 cpbl_player_id 為 key upsert；改名寫入 player_name_history</li>
 *   <li>在 60 人註冊名單、不在一軍名單 → MINORS（下二軍，可回歸）</li>
 *   <li>不在 60 人註冊名單 → DELISTED（註銷，本季死亡）。由 roster maintenance 於次日自動釋出</li>
 * </ul>
 */
@Service
public class RegistrationSync {

    public static final String JOB = "registration-sync";
    /** 單次同步若將超過此比例的已知球員判為註銷，視為來源結構異常而中止。 */
    static final double MAX_DELIST_RATIO = 0.2;

    private final CpblDataSource source;
    private final JdbcClient jdbc;
    private final AppClock clock;
    private final TeamResolver teams;
    private final AlertService alerts;

    public RegistrationSync(CpblDataSource source, JdbcClient jdbc, AppClock clock, TeamResolver teams, AlertService alerts) {
        this.source = source;
        this.jdbc = jdbc;
        this.clock = clock;
        this.teams = teams;
        this.alerts = alerts;
    }

    record Known(long id, String cpblId, String name, String team, String registration, String firstTeam) {
    }

    public record SyncResult(int added, int promoted, int demoted, int delisted, int renamed) {
        public int total() {
            return added + promoted + demoted + delisted + renamed;
        }
    }

    @Transactional
    public SyncResult sync(JobRunner.JobContext ctx) {
        RegistrationSnapshot snap = source.fetchRegistration();
        LocalDate today = clock.today();
        Map<String, Known> known = new HashMap<>();
        jdbc.sql("select id, cpbl_player_id, name, cpbl_team_code, registration_status, first_team_status from player")
                .query((rs, n) -> new Known(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                        rs.getString(6)))
                .list().forEach(k -> known.put(k.cpblId(), k));

        Map<String, SourcePlayer> registered = new HashMap<>();
        snap.registered().forEach(p -> registered.put(p.cpblPlayerId(), p));

        long toDelist = known.values().stream()
                .filter(k -> "REGISTERED".equals(k.registration()) && !registered.containsKey(k.cpblId())).count();
        long registeredKnown = known.values().stream().filter(k -> "REGISTERED".equals(k.registration())).count();
        if (registeredKnown > 20 && toDelist > registeredKnown * MAX_DELIST_RATIO) {
            throw new IllegalStateException("本次同步將註銷 " + toDelist + "/" + registeredKnown
                    + " 名球員，超過安全門檻，疑似來源結構變動，已中止");
        }

        int added = 0, promoted = 0, demoted = 0, delisted = 0, renamed = 0;
        for (SourcePlayer sp : snap.registered()) {
            Known k = known.get(sp.cpblPlayerId());
            String teamCode = teams.resolve(sp.teamName());
            String firstTeam = snap.firstTeamIds().contains(sp.cpblPlayerId()) ? "ACTIVE" : "MINORS";
            if (k == null) {
                SourcePlayer profile = sp.listedPosition() != null && sp.foreign() != null ? sp : source.fetchPlayerProfile(sp.cpblPlayerId());
                // 個人頁查無時，守位與背號沿用名單上的資料
                String pos = profile != null && profile.listedPosition() != null ? profile.listedPosition()
                        : sp.listedPosition() != null ? sp.listedPosition() : "UNKNOWN";
                String jersey = profile != null && profile.jerseyNumber() != null ? profile.jerseyNumber() : sp.jerseyNumber();
                boolean foreign = profile != null && Boolean.TRUE.equals(profile.foreign());
                long id = jdbc.sql("""
                        insert into player (cpbl_player_id, name, cpbl_team_code, is_foreign, listed_position,
                                            registration_status, first_team_status, first_team_changed_on, jersey_number)
                        values (?, ?, ?, ?, ?, 'REGISTERED', ?, ?, ?) returning id
                        """).params(sp.cpblPlayerId(), sp.name(), teamCode, foreign, pos, firstTeam, today, jersey)
                        .query(Long.class).single();
                log(id, "registration_status", null, "REGISTERED", today);
                log(id, "first_team_status", null, firstTeam, today);
                added++;
                continue;
            }
            if (!k.name().equals(sp.name())) {
                jdbc.sql("insert into player_name_history (player_id, old_name, new_name) values (?, ?, ?)")
                        .params(k.id(), k.name(), sp.name()).update();
                jdbc.sql("update player set name = ?, updated_at = now() where id = ?").params(sp.name(), k.id()).update();
                renamed++;
            }
            if (sp.jerseyNumber() != null) {
                jdbc.sql("update player set jersey_number = ? where id = ? and jersey_number is distinct from ?")
                        .params(sp.jerseyNumber(), k.id(), sp.jerseyNumber()).update();
            }
            if (teamCode != null && !teamCode.equals(k.team())) {
                jdbc.sql("update player set cpbl_team_code = ?, updated_at = now() where id = ?").params(teamCode, k.id()).update();
                log(k.id(), "cpbl_team_code", k.team(), teamCode, today);
            }
            if ("DELISTED".equals(k.registration())) {
                // 註銷球員本季不可回歸；若官網重新出現，交由人工判斷
                ctx.anomaly();
                alerts.raise(AlertService.Level.WARN, JOB, "已註銷球員重新出現在註冊名單：" + sp.name() + "（" + sp.cpblPlayerId()
                        + "），維持註銷狀態，請人工確認當季規章");
                continue;
            }
            if (!firstTeam.equals(k.firstTeam())) {
                jdbc.sql("update player set first_team_status = ?, first_team_changed_on = ?, updated_at = now() where id = ?")
                        .params(firstTeam, today, k.id()).update();
                log(k.id(), "first_team_status", k.firstTeam(), firstTeam, today);
                if ("ACTIVE".equals(firstTeam)) {
                    promoted++;
                } else {
                    demoted++;
                }
            }
        }
        for (Known k : known.values()) {
            if ("REGISTERED".equals(k.registration()) && !registered.containsKey(k.cpblId())) {
                jdbc.sql("""
                        update player set registration_status = 'DELISTED', delisted_on = ?, first_team_status = 'MINORS',
                               updated_at = now() where id = ?
                        """).params(today, k.id()).update();
                log(k.id(), "registration_status", "REGISTERED", "DELISTED", today);
                delisted++;
            }
        }
        SyncResult result = new SyncResult(added, promoted, demoted, delisted, renamed);
        ctx.items(result.total());
        ctx.note("新增 " + added + "、升一軍 " + promoted + "、下二軍 " + demoted + "、註銷 " + delisted + "、改名 " + renamed);
        return result;
    }

    private void log(long playerId, String field, String oldValue, String newValue, LocalDate date) {
        jdbc.sql("""
                insert into player_status_log (player_id, field, old_value, new_value, effective_date) values (?, ?, ?, ?, ?)
                """).params(playerId, field, oldValue, newValue, date).update();
    }

    public List<Map<String, Object>> changesOn(LocalDate date) {
        return jdbc.sql("""
                select p.name, p.cpbl_team_code as team, l.field, l.old_value, l.new_value
                from player_status_log l join player p on p.id = l.player_id
                where l.effective_date = ? order by p.cpbl_team_code, p.name
                """).param(date).query().listOfRows();
    }
}
