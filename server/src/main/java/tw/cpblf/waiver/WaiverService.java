package tw.cpblf.waiver;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import tw.cpblf.common.ApiException;
import tw.cpblf.common.LeagueLock;
import tw.cpblf.config.AppClock;
import tw.cpblf.league.League;
import tw.cpblf.league.LeagueService;
import tw.cpblf.league.NotificationService;
import tw.cpblf.roster.RosterService;
import tw.cpblf.roster.Slot;
import tw.cpblf.season.SeasonService;

/**
 * CPBLF-35：Waiver 與 FAAB（規則書 8.1）。
 * 釋出球員進入 2 日 waiver 期；每日 03:00 結算；出價高者得，同價時當前戰績較差者優先，再同則先出價者優先。
 * FAAB 為聯盟內部虛擬預算，不得儲值、不具任何對外價值（規則書 10.1）。
 */
@Service
public class WaiverService {

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final LeagueLock lock;
    private final LeagueService leagues;
    private final RosterService roster;
    private final SeasonService season;
    private final NotificationService notifications;
    private final TransactionTemplate nested;

    public WaiverService(JdbcClient jdbc, AppClock clock, LeagueLock lock, LeagueService leagues, RosterService roster,
                         SeasonService season, NotificationService notifications, PlatformTransactionManager txm) {
        this.nested = new TransactionTemplate(txm);
        this.nested.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
        this.jdbc = jdbc;
        this.clock = clock;
        this.lock = lock;
        this.leagues = leagues;
        this.roster = roster;
        this.season = season;
        this.notifications = notifications;
    }

    public record Claim(long id, long teamId, String teamName, long playerId, String playerName, Long dropPlayerId,
                        String dropPlayerName, int faabBid, String status, String resultNote, OffsetDateTime createdAt,
                        OffsetDateTime processedAt) {
    }

    @Transactional
    public long claim(long teamId, long playerId, Long dropPlayerId, int bid) {
        RosterService.Team team = roster.team(teamId);
        League league = leagues.get(team.leagueId());
        lock.lock(league.id());
        roster.requireNoDraftInProgress(league.id());
        if (team.lineupLockReason() != null) {
            throw ApiException.conflict("名單鎖定中，請先處理：" + team.lineupLockReason());
        }
        boolean onWaivers = jdbc.sql("select count(*) from waiver_player where league_id = ? and player_id = ?")
                .params(league.id(), playerId).query(Integer.class).single() > 0;
        if (!onWaivers) {
            throw ApiException.badRequest("該球員不在 waiver 期，可直接自由球員簽入");
        }
        if (bid < 0 || bid > team.faabBudget()) {
            throw ApiException.badRequest("出價需介於 0 與剩餘 FAAB（" + team.faabBudget() + "）之間");
        }
        if (dropPlayerId != null) {
            roster.requireOnRoster(teamId, dropPlayerId, clock.today());
        }
        int dup = jdbc.sql("select count(*) from waiver_claim where team_id = ? and player_id = ? and status = 'PENDING'")
                .params(teamId, playerId).query(Integer.class).single();
        if (dup > 0) {
            throw ApiException.conflict("已對此球員出價，請先取消原出價");
        }
        return jdbc.sql("""
                insert into waiver_claim (league_id, team_id, player_id, drop_player_id, faab_bid) values (?, ?, ?, ?, ?)
                returning id
                """).params(league.id(), teamId, playerId, dropPlayerId, bid).query(Long.class).single();
    }

    @Transactional
    public void cancel(long teamId, long claimId) {
        int n = jdbc.sql("""
                update waiver_claim set status = 'CANCELLED', processed_at = now()
                where id = ? and team_id = ? and status = 'PENDING'
                """).params(claimId, teamId).update();
        if (n == 0) {
            throw ApiException.notFound("找不到可取消的出價");
        }
    }

    /** 隊伍只能看到自己的待結算出價（出價不公開），已結算結果全聯盟可見。 */
    public List<Claim> claims(long leagueId, long viewerTeamId) {
        return jdbc.sql("""
                select c.id, c.team_id, t.name, c.player_id, p.name, c.drop_player_id, dp.name, c.faab_bid, c.status,
                       c.result_note, c.created_at, c.processed_at
                from waiver_claim c join fantasy_team t on t.id = c.team_id join player p on p.id = c.player_id
                left join player dp on dp.id = c.drop_player_id
                where c.league_id = ? and (c.status <> 'PENDING' or c.team_id = ?)
                order by c.created_at desc limit 100
                """).params(leagueId, viewerTeamId).query((rs, n) -> {
            return new Claim(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getLong(4), rs.getString(5),
                    rs.getObject(6, Long.class), rs.getString(7), rs.getInt(8), rs.getString(9), rs.getString(10),
                    rs.getObject(11, OffsetDateTime.class), rs.getObject(12, OffsetDateTime.class));
        }).list();
    }

    record PendingClaim(long id, long teamId, long playerId, Long dropPlayerId, int bid, Instant createdAt) {
    }

    /** 結算所有已到期的 waiver 球員。回傳處理的出價數。 */
    @Transactional
    public int process(long leagueId) {
        League league = leagues.get(leagueId);
        lock.lock(leagueId);
        Instant now = clock.now();
        LocalDate today = clock.today();
        List<Long> due = jdbc.sql("select player_id from waiver_player where league_id = ? and clears_at <= ?")
                .params(leagueId, Timestamp.from(now)).query(Long.class).list();
        if (due.isEmpty()) {
            return 0;
        }
        List<PendingClaim> claims = jdbc.sql("""
                select id, team_id, player_id, drop_player_id, faab_bid, created_at from waiver_claim
                where league_id = :league and status = 'PENDING' and player_id in (:due)
                """).param("league", leagueId).param("due", due)
                .query((rs, n) -> {
                    return new PendingClaim(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getObject(4, Long.class), rs.getInt(5),
                            rs.getTimestamp(6).toInstant());
                }).list();

        // 戰績較差者優先：依當前半季排名倒序
        Map<Long, Integer> priority = new HashMap<>();
        int halfNo = season.currentHalf(leagueId, today).map(SeasonService.Half::halfNo).orElse(1);
        List<SeasonService.StandingRow> st = season.standings(leagueId, halfNo);
        for (SeasonService.StandingRow r : st) {
            priority.put(r.teamId(), r.rank());
        }
        List<PendingClaim> ordered = new ArrayList<>(claims);
        ordered.sort(Comparator.comparingInt(PendingClaim::bid).reversed()
                .thenComparing(c -> -priority.getOrDefault(c.teamId(), 0))
                .thenComparing(PendingClaim::createdAt)
                .thenComparingLong(PendingClaim::id));

        Set<Long> awarded = new HashSet<>();
        int processed = 0;
        for (PendingClaim c : ordered) {
            processed++;
            if (awarded.contains(c.playerId())) {
                finish(c.id(), "LOST", "已由出價較高或優先順位較前的隊伍取得");
                continue;
            }
            String invalid = tryAward(league, c, today);
            if (invalid != null) {
                finish(c.id(), "INVALID", invalid);
                notifications.notify(c.teamId(), "Waiver 出價無效（" + roster.playerName(c.playerId()) + "）：" + invalid);
                continue;
            }
            awarded.add(c.playerId());
            finish(c.id(), "WON", "以 " + c.bid() + " 點取得");
            notifications.notify(c.teamId(), "Waiver 成功：以 FAAB " + c.bid() + " 點取得 " + roster.playerName(c.playerId()));
        }
        for (Long pid : due) {
            jdbc.sql("delete from waiver_player where league_id = ? and player_id = ?").params(leagueId, pid).update();
        }
        return processed;
    }

    /** 嘗試成交；失敗時回傳原因並回滾此筆的 roster 變動。 */
    private String tryAward(League league, PendingClaim c, LocalDate today) {
        RosterService.Team team = roster.team(c.teamId());
        if (team.faabBudget() < c.bid()) {
            return "FAAB 不足";
        }
        if (team.lineupLockReason() != null) {
            return "名單鎖定中";
        }
        String[] st = jdbc.sql("select registration_status, first_team_status from player where id = ?").param(c.playerId())
                .query((rs, n) -> new String[]{rs.getString(1), rs.getString(2)}).single();
        if (!"REGISTERED".equals(st[0]) || !"ACTIVE".equals(st[1])) {
            return "球員目前不在一軍登錄名單";
        }
        if (roster.ownerTeam(league.id(), c.playerId(), today).isPresent()) {
            return "球員已在其他隊伍名單";
        }
        try {
            nested.executeWithoutResult(status -> award(league, c, today));
            return null;
        } catch (ApiException e) {
            return e.getMessage();
        }
    }

    private void award(League league, PendingClaim c, LocalDate today) {
        {
            LocalDate eff = roster.effectiveDate(c.playerId());
            if (c.dropPlayerId() != null) {
                boolean onRoster = roster.openEntries(c.teamId(), today).stream().anyMatch(e -> e.playerId() == c.dropPlayerId());
                if (!onRoster) {
                    throw ApiException.badRequest("欲釋出的球員已不在名單");
                }
                LocalDate dropEff = roster.effectiveDate(c.dropPlayerId());
                if (dropEff.isAfter(eff)) {
                    eff = dropEff;
                }
                roster.removeInternal(c.teamId(), c.dropPlayerId(), eff);
                roster.putOnWaivers(league, c.dropPlayerId(), today);
            }
            roster.addInternal(c.teamId(), c.playerId(), Slot.BN, eff, "WAIVER", c.bid());
            roster.validate(league, c.teamId(), today);
            roster.validate(league, c.teamId(), eff);
            jdbc.sql("update fantasy_team set faab_budget = faab_budget - ? where id = ?").params(c.bid(), c.teamId()).update();
        }
    }

    private void finish(long claimId, String status, String note) {
        jdbc.sql("update waiver_claim set status = ?, result_note = ?, processed_at = ? where id = ?")
                .params(status, note, Timestamp.from(clock.now()), claimId).update();
    }

    public List<Map<String, Object>> waiverPlayers(long leagueId) {
        return jdbc.sql("""
                select w.player_id, p.name, w.released_on, w.clears_at from waiver_player w join player p on p.id = w.player_id
                where w.league_id = ? order by w.clears_at
                """).param(leagueId).query().listOfRows();
    }
}
