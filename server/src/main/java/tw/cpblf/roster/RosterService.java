package tw.cpblf.roster;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tw.cpblf.common.ApiException;
import tw.cpblf.common.LeagueLock;
import tw.cpblf.config.AppClock;
import tw.cpblf.league.League;
import tw.cpblf.league.LeagueService;
import tw.cpblf.league.NotificationService;

/**
 * CPBLF-31：Roster 操作。所有異動都寫成 effective-dated 的 roster_entry（valid_from 含、valid_to 不含）。
 *
 * <p>每日鎖定（規則書 8.3）：球員所屬中職球隊當日比賽開賽後，該球員當日的 slot 不可再變動。
 * 新增 / 釋出若涉及已鎖定球員，生效日自動延到次日，避免「賽後撿人吃當日數據」。
 */
@Service
public class RosterService {

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final LeagueLock leagueLock;
    private final LeagueService leagues;
    private final EligibilityService eligibility;
    private final NotificationService notifications;

    public RosterService(JdbcClient jdbc, AppClock clock, LeagueLock leagueLock, LeagueService leagues,
                         EligibilityService eligibility, NotificationService notifications) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.leagueLock = leagueLock;
        this.leagues = leagues;
        this.eligibility = eligibility;
        this.notifications = notifications;
    }

    public record Entry(long id, long teamId, long playerId, Slot slot, LocalDate validFrom, LocalDate validTo, String via,
                        int faabSpent) {

        boolean coversOrAfter(LocalDate d) {
            return validTo == null || validTo.isAfter(d);
        }

        boolean covers(LocalDate d) {
            return !validFrom.isAfter(d) && coversOrAfter(d);
        }
    }

    private static Entry map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Entry(rs.getLong("id"), rs.getLong("team_id"), rs.getLong("player_id"), Slot.valueOf(rs.getString("slot")),
                rs.getObject("valid_from", LocalDate.class), rs.getObject("valid_to", LocalDate.class),
                rs.getString("acquired_via"), rs.getInt("faab_spent"));
    }

    // ------------------------------------------------------------------
    // 查詢
    // ------------------------------------------------------------------

    /** 該日當下有效、或之後才生效的所有列。 */
    public List<Entry> openEntries(long teamId, LocalDate date) {
        return jdbc.sql("""
                select * from roster_entry where team_id = ? and (valid_to is null or valid_to > ?) order by valid_from, id
                """).params(teamId, date).query((rs, n) -> map(rs)).list();
    }

    public List<Entry> entriesOn(long teamId, LocalDate date) {
        return jdbc.sql("""
                select * from roster_entry where team_id = ? and valid_from <= ? and (valid_to is null or valid_to > ?)
                order by id
                """).params(teamId, date, date).query((rs, n) -> map(rs)).list();
    }

    /** 聯盟內持有該球員的隊伍（含次日才生效者）。 */
    public Optional<Long> ownerTeam(long leagueId, long playerId, LocalDate date) {
        return jdbc.sql("""
                select re.team_id from roster_entry re join fantasy_team t on t.id = re.team_id
                where t.league_id = ? and re.player_id = ? and (re.valid_to is null or re.valid_to > ?)
                order by re.valid_from desc limit 1
                """).params(leagueId, playerId, date).query(Long.class).optional();
    }

    public boolean isLocked(long playerId) {
        return isLocked(playerId, clock.today(), clock.now());
    }

    /** 球員所屬球隊當日比賽已開賽（或已結束）即鎖定。延賽不鎖。 */
    public boolean isLocked(long playerId, LocalDate today, Instant now) {
        return jdbc.sql("""
                select count(*) from game g join player p on p.cpbl_team_code in (g.home_team_code, g.away_team_code)
                where p.id = ? and g.play_date = ?
                  and (g.status in ('IN_PROGRESS', 'FINAL', 'SUSPENDED')
                       or (g.status = 'SCHEDULED' and g.start_time is not null and g.start_time <= ?))
                """).params(playerId, today, Timestamp.from(now)).query(Integer.class).single() > 0;
    }

    /** 異動生效日：未鎖定為今日，已鎖定為明日。 */
    public LocalDate effectiveDate(long playerId) {
        LocalDate today = clock.today();
        return isLocked(playerId, today, clock.now()) ? today.plusDays(1) : today;
    }

    // ------------------------------------------------------------------
    // 使用者操作
    // ------------------------------------------------------------------

    /** 調整先發 / 板凳 / NA。moves 為 playerId → 新 slot。 */
    @Transactional
    public void setSlots(long teamId, Map<Long, Slot> moves) {
        Team team = team(teamId);
        League league = leagues.get(team.leagueId());
        leagueLock.lock(league.id());
        LocalDate today = clock.today();
        Instant now = clock.now();
        List<Entry> open = openEntries(teamId, today);

        for (Map.Entry<Long, Slot> mv : moves.entrySet()) {
            long pid = mv.getKey();
            Slot target = mv.getValue();
            Entry current = open.stream().filter(e -> e.playerId() == pid && e.covers(today)).findFirst().orElse(null);
            Entry pending = open.stream().filter(e -> e.playerId() == pid && e.validFrom().isAfter(today)).findFirst().orElse(null);
            if (current == null && pending == null) {
                throw ApiException.badRequest("球員不在名單中：" + playerName(pid));
            }
            Entry e = current != null ? current : pending;
            if (e.slot() == target) {
                continue;
            }
            LocalDate checkDate = current != null ? today : pending.validFrom();
            checkSlotAllowed(league, pid, target, checkDate);
            if (current != null) {
                if (isLocked(pid, today, now)) {
                    throw ApiException.conflict(playerName(pid) + " 今日比賽已開打，已鎖定");
                }
                changeSlot(current, target, today);
                // 次日才生效的同一球員列（例如已排定明日釋出者）不受影響
            } else {
                jdbc.sql("update roster_entry set slot = ? where id = ?").params(target.name(), pending.id()).update();
            }
        }
        validate(league, teamId, today);
        validate(league, teamId, today.plusDays(1));
        if (team.lineupLockReason() != null) {
            if (hasReturnedPlayersInNa(teamId, today)) {
                throw ApiException.conflict("名單鎖定中：" + team.lineupLockReason());
            }
            clearLineupLock(teamId);
        }
    }

    @Transactional
    public LocalDate addFreeAgent(long teamId, long playerId, Long dropPlayerId) {
        Team team = team(teamId);
        League league = leagues.get(team.leagueId());
        leagueLock.lock(league.id());
        if (team.lineupLockReason() != null) {
            throw ApiException.conflict("名單鎖定中，請先處理：" + team.lineupLockReason());
        }
        requireNoDraftInProgress(league.id());
        LocalDate today = clock.today();
        requireAvailable(league, playerId, today);
        boolean onWaivers = jdbc.sql("select count(*) from waiver_player where league_id = ? and player_id = ?")
                .params(league.id(), playerId).query(Integer.class).single() > 0;
        if (onWaivers) {
            throw ApiException.conflict("該球員仍在 waiver 期，請提出 FAAB 出價");
        }
        LocalDate eff = effectiveDate(playerId);
        if (dropPlayerId != null) {
            requireOnRoster(teamId, dropPlayerId, today);
            LocalDate dropEff = effectiveDate(dropPlayerId);
            if (dropEff.isAfter(eff)) {
                eff = dropEff;
            }
            removeInternal(teamId, dropPlayerId, eff);
            putOnWaivers(league, dropPlayerId, today);
        }
        addInternal(teamId, playerId, Slot.BN, eff, "FA", 0);
        validate(league, teamId, today);
        validate(league, teamId, eff);
        return eff;
    }

    @Transactional
    public LocalDate drop(long teamId, long playerId) {
        Team team = team(teamId);
        League league = leagues.get(team.leagueId());
        leagueLock.lock(league.id());
        LocalDate today = clock.today();
        requireOnRoster(teamId, playerId, today);
        LocalDate eff = effectiveDate(playerId);
        removeInternal(teamId, playerId, eff);
        putOnWaivers(league, playerId, today);
        jdbc.sql("""
                update waiver_claim set status = 'CANCELLED', result_note = '欲釋出的球員已不在名單', processed_at = now()
                where team_id = ? and drop_player_id = ? and status = 'PENDING'
                """).params(teamId, playerId).update();
        resolveNaReturns(league, teamId);
        return eff;
    }

    // ------------------------------------------------------------------
    // 內部操作（waiver、交易、選秀、維護 job 共用）
    // ------------------------------------------------------------------

    public void addInternal(long teamId, long playerId, Slot slot, LocalDate eff, String via, int faabSpent) {
        jdbc.sql("""
                insert into roster_entry (team_id, player_id, slot, valid_from, acquired_via, faab_spent)
                values (?, ?, ?, ?, ?, ?)
                """).params(teamId, playerId, slot.name(), eff, via, faabSpent).update();
    }

    /** 自生效日起移出名單：之後才生效的列直接刪除，進行中的列在生效日截止。 */
    public void removeInternal(long teamId, long playerId, LocalDate eff) {
        jdbc.sql("delete from roster_entry where team_id = ? and player_id = ? and valid_from >= ?")
                .params(teamId, playerId, eff).update();
        jdbc.sql("""
                update roster_entry set valid_to = ?
                where team_id = ? and player_id = ? and valid_from < ? and (valid_to is null or valid_to > ?)
                """).params(eff, teamId, playerId, eff, eff).update();
    }

    void changeSlot(Entry e, Slot target, LocalDate eff) {
        if (!e.validFrom().isBefore(eff)) {
            jdbc.sql("update roster_entry set slot = ? where id = ?").params(target.name(), e.id()).update();
            return;
        }
        jdbc.sql("update roster_entry set valid_to = ? where id = ?").params(eff, e.id()).update();
        jdbc.sql("""
                insert into roster_entry (team_id, player_id, slot, valid_from, valid_to, acquired_via, faab_spent)
                values (?, ?, ?, ?, ?, 'MOVE', ?)
                """).params(e.teamId(), e.playerId(), target.name(), eff, e.validTo(), e.faabSpent()).update();
    }

    public void putOnWaivers(League league, long playerId, LocalDate today) {
        String reg = jdbc.sql("select registration_status from player where id = ?").param(playerId).query(String.class).single();
        if ("DELISTED".equals(reg)) {
            return;
        }
        Instant clears = clock.at(today.plusDays(league.waiverDays()), league.waiverProcessHour());
        jdbc.sql("""
                insert into waiver_player (league_id, player_id, released_on, clears_at) values (?, ?, ?, ?)
                on conflict (league_id, player_id) do update set released_on = excluded.released_on, clears_at = excluded.clears_at
                """).params(league.id(), playerId, today, Timestamp.from(clears)).update();
    }

    /** 驗證某日的名單：各 slot 名額、roster 額度（不含 NA）、洋將上限。 */
    public void validate(League league, long teamId, LocalDate date) {
        List<Entry> on = entriesOn(teamId, date);
        Map<Slot, Integer> counts = new EnumMap<>(Slot.class);
        on.forEach(e -> counts.merge(e.slot(), 1, Integer::sum));
        Map<Slot, Integer> limits = league.slotCounts();
        for (Map.Entry<Slot, Integer> c : counts.entrySet()) {
            if (c.getValue() > limits.get(c.getKey())) {
                throw ApiException.badRequest(c.getKey() + " 名額已滿（上限 " + limits.get(c.getKey()) + "）");
            }
        }
        long rostered = on.stream().filter(e -> e.slot() != Slot.NA).count();
        if (rostered > league.rosterSize()) {
            throw ApiException.badRequest("名單已滿（上限 " + league.rosterSize() + " 人，不含 NA）");
        }
        List<Long> ids = on.stream().map(Entry::playerId).toList();
        if (!ids.isEmpty()) {
            int foreign = jdbc.sql("select count(*) from player where id in (:ids) and is_foreign").param("ids", ids)
                    .query(Integer.class).single();
            if (foreign > league.foreignPlayerLimit()) {
                throw ApiException.badRequest("洋將人數超過上限（" + league.foreignPlayerLimit() + " 人）");
            }
        }
    }

    void checkSlotAllowed(League league, long playerId, Slot target, LocalDate date) {
        if (target == Slot.BN) {
            return;
        }
        if (target == Slot.NA) {
            String[] st = jdbc.sql("select registration_status, first_team_status from player where id = ?").param(playerId)
                    .query((rs, n) -> new String[]{rs.getString(1), rs.getString(2)}).single();
            if (!"REGISTERED".equals(st[0]) || !"MINORS".equals(st[1])) {
                throw ApiException.badRequest("NA 僅限下二軍球員：" + playerName(playerId));
            }
            return;
        }
        Set<Slot> el = eligibility.eligibility(league, playerId, date);
        if (!el.contains(target)) {
            throw ApiException.badRequest(playerName(playerId) + " 不具 " + target + " 資格");
        }
    }

    // ------------------------------------------------------------------
    // 維護（規則書 6.1.5、CPBLF-34、CPBLF-37）
    // ------------------------------------------------------------------

    /** 註銷球員於次日自動釋出，不進 waiver。 */
    @Transactional
    public int releaseDelisted(League league) {
        leagueLock.lock(league.id());
        LocalDate today = clock.today();
        record Row(long teamId, long playerId, String name, int faab) {
        }
        List<Row> rows = jdbc.sql("""
                select distinct re.team_id, re.player_id, p.name, re.faab_spent
                from roster_entry re join fantasy_team t on t.id = re.team_id join player p on p.id = re.player_id
                where t.league_id = ? and (re.valid_to is null or re.valid_to > ?)
                  and p.registration_status = 'DELISTED' and p.delisted_on < ?
                """).params(league.id(), today, today)
                .query((rs, n) -> new Row(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getInt(4))).list();
        for (Row r : rows) {
            removeInternal(r.teamId(), r.playerId(), today);
            String msg = r.name() + " 已遭註銷（本季不可回歸），系統已自動釋出";
            if (league.refundFaabOnDelist() && r.faab() > 0) {
                jdbc.sql("update fantasy_team set faab_budget = faab_budget + ? where id = ?").params(r.faab(), r.teamId()).update();
                msg += "，退還 FAAB " + r.faab() + " 點";
            }
            notifications.notify(r.teamId(), msg);
            resolveNaReturns(league, r.teamId());
        }
        return rows.size();
    }

    /** 已重新登錄一軍的 NA 球員，於次日移至板凳；板凳已滿則鎖定該隊 lineup 操作。 */
    public void resolveNaReturns(League league, long teamId) {
        LocalDate today = clock.today();
        List<Entry> returned = returnedInNa(teamId, today);
        for (Entry e : returned) {
            long bench = entriesOn(teamId, today).stream().filter(x -> x.slot() == Slot.BN).count();
            if (bench < league.slotsBench()) {
                changeSlot(e, Slot.BN, today);
                notifications.notify(teamId, playerName(e.playerId()) + " 已重新登錄一軍，系統已自 NA 移至板凳");
            }
        }
        List<Entry> stillThere = returnedInNa(teamId, today);
        if (stillThere.isEmpty()) {
            clearLineupLock(teamId);
        } else {
            String reason = playerName(stillThere.get(0).playerId()) + " 已重新登錄一軍但板凳已滿，請於下一個比賽日前釋出或調整球員";
            Team t = team(teamId);
            if (t.lineupLockReason() == null) {
                notifications.notify(teamId, reason);
            }
            jdbc.sql("update fantasy_team set lineup_lock_reason = ? where id = ?").params(reason, teamId).update();
        }
    }

    @Transactional
    public void resolveAllNaReturns(League league) {
        leagueLock.lock(league.id());
        for (Long teamId : jdbc.sql("select id from fantasy_team where league_id = ?").param(league.id()).query(Long.class).list()) {
            resolveNaReturns(league, teamId);
        }
    }

    private List<Entry> returnedInNa(long teamId, LocalDate today) {
        List<Entry> out = new ArrayList<>();
        for (Entry e : entriesOn(teamId, today)) {
            if (e.slot() != Slot.NA) {
                continue;
            }
            Boolean returned = jdbc.sql("""
                    select first_team_status = 'ACTIVE' and registration_status = 'REGISTERED'
                           and (first_team_changed_on is null or first_team_changed_on < ?)
                    from player where id = ?
                    """).params(today, e.playerId()).query(Boolean.class).single();
            if (Boolean.TRUE.equals(returned)) {
                out.add(e);
            }
        }
        return out;
    }

    private boolean hasReturnedPlayersInNa(long teamId, LocalDate today) {
        return !returnedInNa(teamId, today).isEmpty();
    }

    private void clearLineupLock(long teamId) {
        jdbc.sql("update fantasy_team set lineup_lock_reason = null where id = ? and lineup_lock_reason is not null")
                .param(teamId).update();
    }

    // ------------------------------------------------------------------
    // 共用檢查
    // ------------------------------------------------------------------

    public record Team(long id, long leagueId, long userId, String name, int faabBudget, String lineupLockReason) {
    }

    public Team team(long teamId) {
        return jdbc.sql("select id, league_id, user_id, name, faab_budget, lineup_lock_reason from fantasy_team where id = ?")
                .param(teamId)
                .query((rs, n) -> new Team(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getString(4), rs.getInt(5),
                        rs.getString(6)))
                .optional().orElseThrow(() -> ApiException.notFound("隊伍不存在"));
    }

    /** 可被選取：已註冊、一軍登錄、且不在聯盟任何名單中。 */
    public void requireAvailable(League league, long playerId, LocalDate today) {
        String[] st = jdbc.sql("select registration_status, first_team_status from player where id = ?").param(playerId)
                .query((rs, n) -> new String[]{rs.getString(1), rs.getString(2)}).optional()
                .orElseThrow(() -> ApiException.notFound("球員不存在"));
        if (!"REGISTERED".equals(st[0]) || !"ACTIVE".equals(st[1])) {
            throw ApiException.badRequest("只有一軍登錄球員可被選取");
        }
        if (ownerTeam(league.id(), playerId, today).isPresent()) {
            throw ApiException.conflict("該球員已在其他隊伍名單中");
        }
    }

    public void requireOnRoster(long teamId, long playerId, LocalDate today) {
        boolean on = openEntries(teamId, today).stream().anyMatch(e -> e.playerId() == playerId);
        if (!on) {
            throw ApiException.badRequest("球員不在名單中：" + playerName(playerId));
        }
    }

    public void requireNoDraftInProgress(long leagueId) {
        int n = jdbc.sql("select count(*) from draft where league_id = ? and status = 'IN_PROGRESS'").param(leagueId)
                .query(Integer.class).single();
        if (n > 0) {
            throw ApiException.conflict("選秀進行中，暫停球員異動");
        }
    }

    public String playerName(long playerId) {
        return jdbc.sql("select name from player where id = ?").param(playerId).query(String.class).optional().orElse("#" + playerId);
    }
}
