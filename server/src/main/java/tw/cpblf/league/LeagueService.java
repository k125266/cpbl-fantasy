package tw.cpblf.league;

import java.security.SecureRandom;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tw.cpblf.auth.AuthService;
import tw.cpblf.auth.CurrentUser;
import tw.cpblf.common.ApiException;
import tw.cpblf.common.LeagueLock;

/** CPBLF-30：聯盟、邀請、隊伍與可調設定。 */
@Service
public class LeagueService {

    private static final String CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private final JdbcClient jdbc;
    private final AuthService auth;
    private final LeagueLock lock;
    private final SecureRandom random = new SecureRandom();

    public LeagueService(JdbcClient jdbc, AuthService auth, LeagueLock lock) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.lock = lock;
    }

    public League get(long leagueId) {
        return jdbc.sql("select * from league where id = ?").param(leagueId).query((rs, n) -> League.from(rs)).optional()
                .orElseThrow(() -> ApiException.notFound("聯盟不存在"));
    }

    public record TeamView(long id, String name, String abbr, long userId, String owner, int faabBudget, String lineupLockReason) {
    }

    public List<TeamView> teams(long leagueId) {
        return jdbc.sql("""
                select t.id, t.name, t.abbr, t.user_id, u.display_name, t.faab_budget, t.lineup_lock_reason
                from fantasy_team t join app_user u on u.id = t.user_id where t.league_id = ? order by t.id
                """).param(leagueId).query((rs, n) -> new TeamView(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getLong(4),
                rs.getString(5), rs.getInt(6), rs.getString(7))).list();
    }

    public record Membership(long leagueId, String leagueName, long teamId, String teamName, boolean commissioner) {
    }

    public List<Membership> memberships(long userId) {
        return jdbc.sql("""
                select l.id, l.name, t.id, t.name, l.commissioner_user_id = ?
                from fantasy_team t join league l on l.id = t.league_id where t.user_id = ? order by l.id
                """).params(userId, userId).query((rs, n) -> new Membership(rs.getLong(1), rs.getString(2), rs.getLong(3),
                rs.getString(4), rs.getBoolean(5))).list();
    }

    public Optional<Long> teamOf(long leagueId, long userId) {
        return jdbc.sql("select id from fantasy_team where league_id = ? and user_id = ?").params(leagueId, userId)
                .query(Long.class).optional();
    }

    public long requireTeam(long leagueId, CurrentUser user) {
        return teamOf(leagueId, user.id()).orElseThrow(() -> ApiException.forbidden("你不是此聯盟成員"));
    }

    public void requireMember(long leagueId, CurrentUser user) {
        if (teamOf(leagueId, user.id()).isEmpty() && !user.admin()) {
            throw ApiException.forbidden("你不是此聯盟成員");
        }
    }

    public void requireCommissioner(long leagueId, CurrentUser user) {
        if (get(leagueId).commissionerUserId() != user.id() && !user.admin()) {
            throw ApiException.forbidden("需要聯盟管理員權限");
        }
    }

    @Transactional
    public League create(CurrentUser user, String name, int seasonYear, String teamName, String teamAbbr) {
        if (name == null || name.isBlank()) {
            throw ApiException.badRequest("請輸入聯盟名稱");
        }
        long id = jdbc.sql("""
                insert into league (name, season_year, invite_code, commissioner_user_id) values (?, ?, ?, ?) returning id
                """).params(name.trim(), seasonYear, newInviteCode(), user.id()).query(Long.class).single();
        createTeam(id, user.id(), teamName, teamAbbr);
        return get(id);
    }

    /** 以邀請碼註冊並加入聯盟。第一位使用者可不帶邀請碼（成為系統管理員，之後自行建立聯盟）。 */
    @Transactional
    public CurrentUser registerWithInvite(String username, String displayName, String password, String inviteCode,
                                          String teamName, String teamAbbr) {
        boolean firstUser = jdbc.sql("select count(*) from app_user").query(Integer.class).single() == 0;
        League league = null;
        if (inviteCode != null && !inviteCode.isBlank()) {
            league = jdbc.sql("select * from league where invite_code = ?").param(inviteCode.trim().toUpperCase())
                    .query((rs, n) -> League.from(rs)).optional()
                    .orElseThrow(() -> ApiException.badRequest("邀請碼無效"));
        } else if (!firstUser) {
            throw ApiException.badRequest("本站為封閉聯盟，註冊需要邀請碼");
        }
        CurrentUser user = auth.register(username, displayName, password);
        if (league != null) {
            createTeam(league.id(), user.id(), teamName == null || teamName.isBlank() ? displayName + " 隊" : teamName, teamAbbr);
        }
        return user;
    }

    @Transactional
    public void joinWithInvite(CurrentUser user, String inviteCode, String teamName, String teamAbbr) {
        League league = jdbc.sql("select * from league where invite_code = ?").param(inviteCode.trim().toUpperCase())
                .query((rs, n) -> League.from(rs)).optional().orElseThrow(() -> ApiException.badRequest("邀請碼無效"));
        createTeam(league.id(), user.id(), teamName, teamAbbr);
    }

    void createTeam(long leagueId, long userId, String teamName, String abbr) {
        lock.lock(leagueId);
        League league = get(leagueId);
        int count = jdbc.sql("select count(*) from fantasy_team where league_id = ?").param(leagueId).query(Integer.class).single();
        if (count >= league.maxTeams()) {
            throw ApiException.conflict("聯盟已滿（上限 " + league.maxTeams() + " 隊）");
        }
        if (teamOf(leagueId, userId).isPresent()) {
            throw ApiException.conflict("你已在此聯盟中");
        }
        int seasonStarted = jdbc.sql("""
                select count(*) from scoring_period sp join season_half h on h.id = sp.season_half_id where h.league_id = ?
                """).param(leagueId).query(Integer.class).single();
        if (seasonStarted > 0) {
            throw ApiException.conflict("賽程已產生，無法再加入新隊伍");
        }
        String name = teamName == null || teamName.isBlank() ? "隊伍 " + (count + 1) : teamName.trim();
        if (name.length() > 40) {
            throw ApiException.badRequest("隊名最多 40 字");
        }
        String a = abbr == null || abbr.isBlank() ? name.substring(0, Math.min(3, name.length())) : abbr.trim();
        if (a.length() > 6) {
            throw ApiException.badRequest("縮寫最多 6 字");
        }
        jdbc.sql("insert into fantasy_team (league_id, user_id, name, abbr, faab_budget) values (?, ?, ?, ?, ?)")
                .params(leagueId, userId, name, a, league.faabBudgetPerHalf()).update();
    }

    @Transactional
    public void renameTeam(long teamId, String name, String abbr) {
        if (name == null || name.isBlank() || name.length() > 40 || abbr == null || abbr.isBlank() || abbr.length() > 6) {
            throw ApiException.badRequest("隊名 1-40 字、縮寫 1-6 字");
        }
        jdbc.sql("update fantasy_team set name = ?, abbr = ? where id = ?").params(name.trim(), abbr.trim(), teamId).update();
    }

    /** 可調整的設定欄位（白名單）。 */
    static final List<String> SETTINGS = List.of(
            "foreign_player_limit", "position_min_games", "sp_min_starts", "eligibility_grace_days", "faab_budget_per_half",
            "slots_na", "minors_return_days", "foreign_minors_return_days", "hitter_idle_game_days", "pitcher_idle_days",
            "waiver_days", "trade_review_hours", "matchup_lock_hours", "keeper_limit", "draft_pick_seconds",
            "refund_faab_on_delist");

    @Transactional
    public League updateSettings(long leagueId, Map<String, Object> values) {
        for (Map.Entry<String, Object> e : values.entrySet()) {
            if (!SETTINGS.contains(e.getKey())) {
                throw ApiException.badRequest("不可調整的設定：" + e.getKey());
            }
            Object v = e.getValue();
            if ("refund_faab_on_delist".equals(e.getKey())) {
                if (!(v instanceof Boolean)) {
                    throw ApiException.badRequest(e.getKey() + " 需為 true/false");
                }
            } else if (!(v instanceof Number num) || num.intValue() < 0 || num.intValue() > 1000) {
                throw ApiException.badRequest(e.getKey() + " 需為 0-1000 的整數");
            }
            if ("draft_pick_seconds".equals(e.getKey()) && ((Number) v).intValue() < 15) {
                throw ApiException.badRequest("每次選擇時限至少 15 秒");
            }
            jdbc.sql("update league set " + e.getKey() + " = ? where id = ?").params(v, leagueId).update();
        }
        return get(leagueId);
    }

    private String newInviteCode() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 8; i++) {
            sb.append(CODE_CHARS.charAt(random.nextInt(CODE_CHARS.length())));
        }
        return sb.toString();
    }
}
