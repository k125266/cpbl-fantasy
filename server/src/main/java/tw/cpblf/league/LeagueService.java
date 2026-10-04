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

    /** 隊伍頭像（設計稿「登入與加入聯盟」的 12 種動物，Phosphor Icons 名稱）。非球隊隊徽或吉祥物。 */
    public static final List<String> ICONS = List.of("bird", "cat", "dog", "rabbit", "horse", "cow", "fish", "butterfly", "shrimp",
            "bug-beetle", "bug", "paw-print");
    /** 隊伍代表色（設計稿色票；前 5 色同前端 fantasyTeamColor 的預設色票）。 */
    public static final List<String> COLORS = List.of("#7b8cff", "#e8603c", "#3cb4c8", "#a77be0", "#78c27a", "#e86a9a", "#c9d65a",
            "#e8a23c");

    /** 建立或修改隊伍時的隊名、縮寫、頭像、代表色；頭像與色可為 null（舊資料、demo）。 */
    public record TeamIdentity(String name, String abbr, String icon, String color) {
    }

    public record TeamView(long id, String name, String abbr, long userId, String owner, int faabBudget, String lineupLockReason,
                           String icon, String color) {
    }

    public List<TeamView> teams(long leagueId) {
        return jdbc.sql("""
                select t.id, t.name, t.abbr, t.user_id, u.display_name, t.faab_budget, t.lineup_lock_reason, t.icon, t.color
                from fantasy_team t join app_user u on u.id = t.user_id where t.league_id = ? order by t.id
                """).param(leagueId).query((rs, n) -> new TeamView(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getLong(4),
                rs.getString(5), rs.getInt(6), rs.getString(7), rs.getString(8), rs.getString(9))).list();
    }

    /** 邀請碼預覽（公開，註冊前就能查）：只回聯盟名稱、管理員、隊數與已加入隊伍的隊名／頭像／色。 */
    public record InvitePreview(String leagueName, String commissioner, int teamCount, int maxTeams, boolean seasonStarted,
                                List<PreviewTeam> teams) {
    }

    public record PreviewTeam(String name, String icon, String color) {
    }

    public InvitePreview invitePreview(String code) {
        League league = byInviteCode(code);
        String commissioner = jdbc.sql("select display_name from app_user where id = ?").param(league.commissionerUserId())
                .query(String.class).single();
        List<PreviewTeam> teams = teams(league.id()).stream().map(t -> new PreviewTeam(t.name(), t.icon(), t.color())).toList();
        return new InvitePreview(league.name(), commissioner, teams.size(), league.maxTeams(), seasonStarted(league.id()), teams);
    }

    /** 邀請碼、建盟碼不分大小寫，忽略連字號與空白（例：ttmv-5ecb）。 */
    static String normalizeCode(String code) {
        return code == null ? "" : code.replaceAll("[\\s-]", "").toUpperCase();
    }

    private League byInviteCode(String code) {
        return jdbc.sql("select * from league where invite_code = ?").param(normalizeCode(code))
                .query((rs, n) -> League.from(rs)).optional()
                .orElseThrow(() -> ApiException.notFound("找不到這個邀請碼，請向聯盟管理員確認"));
    }

    private boolean seasonStarted(long leagueId) {
        return jdbc.sql("""
                select count(*) from scoring_period sp join season_half h on h.id = sp.season_half_id where h.league_id = ?
                """).param(leagueId).query(Integer.class).single() > 0;
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

    /** demo 與既有呼叫端：不帶頭像、色與建盟碼（系統管理員建立）。 */
    public League create(CurrentUser user, String name, int seasonYear, String teamName, String teamAbbr) {
        return create(user, name, seasonYear, new TeamIdentity(teamName, teamAbbr, null, null), null);
    }

    /**
     * 建立聯盟並成為管理員（含自己的隊伍）。封閉營運：系統管理員以外需要一次性建盟碼（docs/decisions.md「身分與隱私」）。
     */
    @Transactional
    public League create(CurrentUser user, String name, int seasonYear, TeamIdentity team, String createCode) {
        if (name == null || name.isBlank()) {
            throw ApiException.badRequest("請取一個聯盟名稱");
        }
        if (name.trim().length() > 60) {
            throw ApiException.badRequest("聯盟名稱最多 60 字");
        }
        String code = user.admin() ? null : claimCreateCode(createCode);
        long id = jdbc.sql("""
                insert into league (name, season_year, invite_code, commissioner_user_id) values (?, ?, ?, ?) returning id
                """).params(name.trim(), seasonYear, newInviteCode(), user.id()).query(Long.class).single();
        if (code != null) {
            jdbc.sql("update league_create_code set used_by = ?, used_at = now(), league_id = ? where code = ?")
                    .params(user.id(), id, code).update();
        }
        createTeam(id, user.id(), team);
        return get(id);
    }

    /** 檢查建盟碼可用（未用過、未撤銷），回傳正規化後的碼；交易內鎖定該列避免同時使用。 */
    private String claimCreateCode(String createCode) {
        String code = normalizeCode(createCode);
        if (code.isEmpty()) {
            throw ApiException.forbidden("建立聯盟需要系統管理員發的建盟碼");
        }
        var row = jdbc.sql("select used_by, revoked_at from league_create_code where code = ? for update").param(code)
                .query().listOfRows();
        if (row.isEmpty() || row.get(0).get("revoked_at") != null) {
            throw ApiException.badRequest("建盟碼無效，請向系統管理員確認");
        }
        if (row.get(0).get("used_by") != null) {
            throw ApiException.conflict("這個建盟碼已經用過了");
        }
        return code;
    }

    public record Registration(String username, String displayName, String password, String inviteCode, String createCode,
                               String leagueName, int seasonYear, TeamIdentity team) {
    }

    /**
     * 註冊（設計稿四步流程的最後一步一次送出），帳號與隊伍在同一個交易內建立，失敗時不會留下孤兒帳號：
     * 帶邀請碼 → 加入該聯盟；帶建盟碼 → 建立聯盟並成為管理員；都不帶 → 只有第一位使用者可以（成為系統管理員）。
     */
    @Transactional
    public CurrentUser register(Registration r) {
        boolean firstUser = jdbc.sql("select count(*) from app_user").query(Integer.class).single() == 0;
        boolean hasInvite = !normalizeCode(r.inviteCode()).isEmpty();
        boolean hasCreate = !normalizeCode(r.createCode()).isEmpty();
        League join = hasInvite ? byInviteCode(r.inviteCode()) : null;
        if (!hasInvite && !hasCreate && !firstUser) {
            throw ApiException.badRequest("本站為封閉聯盟，註冊需要邀請碼或建盟碼");
        }
        CurrentUser user = auth.register(r.username(), r.displayName(), r.password());
        if (join != null) {
            createTeam(join.id(), user.id(), r.team());
        } else if (hasCreate || (firstUser && r.leagueName() != null && !r.leagueName().isBlank())) {
            create(user, r.leagueName(), r.seasonYear(), r.team(), r.createCode());
        }
        return user;
    }

    /** demo 與既有呼叫端。 */
    public void joinWithInvite(CurrentUser user, String inviteCode, String teamName, String teamAbbr) {
        joinWithInvite(user, inviteCode, new TeamIdentity(teamName, teamAbbr, null, null));
    }

    @Transactional
    public void joinWithInvite(CurrentUser user, String inviteCode, TeamIdentity team) {
        createTeam(byInviteCode(inviteCode).id(), user.id(), team);
    }

    void createTeam(long leagueId, long userId, TeamIdentity team) {
        lock.lock(leagueId);
        League league = get(leagueId);
        int count = jdbc.sql("select count(*) from fantasy_team where league_id = ?").param(leagueId).query(Integer.class).single();
        if (count >= league.maxTeams()) {
            throw ApiException.conflict("聯盟已滿（上限 " + league.maxTeams() + " 隊）");
        }
        if (teamOf(leagueId, userId).isPresent()) {
            throw ApiException.conflict("你已在此聯盟中");
        }
        if (seasonStarted(leagueId)) {
            throw ApiException.conflict("賽程已產生，無法再加入新隊伍");
        }
        String name = team.name() == null || team.name().isBlank() ? "隊伍 " + (count + 1) : team.name().trim();
        if (name.length() > 40) {
            throw ApiException.badRequest("隊名最多 40 字");
        }
        String a = team.abbr() == null || team.abbr().isBlank() ? name.substring(0, Math.min(3, name.length())) : team.abbr().trim();
        if (a.length() > 6) {
            throw ApiException.badRequest("縮寫最多 6 字");
        }
        checkIdentity(leagueId, null, team.icon(), team.color());
        jdbc.sql("insert into fantasy_team (league_id, user_id, name, abbr, faab_budget, icon, color) values (?, ?, ?, ?, ?, ?, ?)")
                .params(leagueId, userId, name, a, league.faabBudgetPerHalf(), team.icon(), team.color()).update();
    }

    /** 頭像與色須在白名單內，且同一聯盟內沒有其他隊伍使用。 */
    private void checkIdentity(long leagueId, Long exceptTeamId, String icon, String color) {
        if (icon != null && !ICONS.contains(icon)) {
            throw ApiException.badRequest("不支援的頭像：" + icon);
        }
        if (color != null && !COLORS.contains(color)) {
            throw ApiException.badRequest("不支援的代表色：" + color);
        }
        long except = exceptTeamId == null ? -1 : exceptTeamId;
        if (icon != null) {
            jdbc.sql("select name from fantasy_team where league_id = ? and icon = ? and id <> ?").params(leagueId, icon, except)
                    .query(String.class).optional().ifPresent(n -> {
                        throw ApiException.conflict(n + " 已經用了這個頭像");
                    });
        }
        if (color != null) {
            jdbc.sql("select name from fantasy_team where league_id = ? and color = ? and id <> ?").params(leagueId, color, except)
                    .query(String.class).optional().ifPresent(n -> {
                        throw ApiException.conflict(n + " 已經用了這個顏色");
                    });
        }
    }

    /** 修改自己的隊名、縮寫、頭像、代表色（頭像與色為 null 時不變）。 */
    @Transactional
    public void updateTeam(long leagueId, long teamId, TeamIdentity t) {
        if (t.name() == null || t.name().isBlank() || t.name().length() > 40 || t.abbr() == null || t.abbr().isBlank()
                || t.abbr().length() > 6) {
            throw ApiException.badRequest("隊名 1-40 字、縮寫 1-6 字");
        }
        lock.lock(leagueId);
        checkIdentity(leagueId, teamId, t.icon(), t.color());
        jdbc.sql("""
                update fantasy_team set name = ?, abbr = ?, icon = coalesce(?, icon), color = coalesce(?, color) where id = ?
                """).params(t.name().trim(), t.abbr().trim(), t.icon(), t.color(), teamId).update();
    }

    // ------------------------------------------------------------------
    // 建盟碼（系統管理員發給各聯盟管理員，一次性）
    // ------------------------------------------------------------------

    public record CreateCode(String code, String createdAt, String usedBy, String usedAt, String leagueName, String revokedAt) {
    }

    @Transactional
    public String issueCreateCode(CurrentUser admin) {
        String code = newInviteCode();
        jdbc.sql("insert into league_create_code (code, created_by) values (?, ?)").params(code, admin.id()).update();
        return code;
    }

    public List<CreateCode> createCodes() {
        return jdbc.sql("""
                select c.code, c.created_at::text, u.display_name, c.used_at::text, l.name, c.revoked_at::text
                from league_create_code c left join app_user u on u.id = c.used_by left join league l on l.id = c.league_id
                order by c.created_at desc
                """).query((rs, n) -> new CreateCode(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getString(5), rs.getString(6))).list();
    }

    @Transactional
    public void revokeCreateCode(String code) {
        int n = jdbc.sql("update league_create_code set revoked_at = now() where code = ? and used_by is null and revoked_at is null")
                .param(normalizeCode(code)).update();
        if (n == 0) {
            throw ApiException.badRequest("建盟碼不存在、已使用或已撤銷");
        }
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
