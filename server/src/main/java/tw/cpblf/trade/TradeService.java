package tw.cpblf.trade;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
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
 * CPBLF-36：交易（規則書 8.2）。
 *
 * <ol>
 *   <li>提案 → 對方接受 → 24 小時聯盟審核期</li>
 *   <li>審核期間非當事隊伍可表示反對；反對數過半（非當事隊伍的半數以上）即否決</li>
 *   <li>審核期滿自動執行；交易截止日為各半季最後一期例行對戰開始前</li>
 * </ol>
 * 執行後的歸屬為 effective-dated，因此歷史對戰比分不會因交易而改變。
 */
@Service
public class TradeService {

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final LeagueLock lock;
    private final LeagueService leagues;
    private final RosterService roster;
    private final SeasonService season;
    private final NotificationService notifications;
    private final TransactionTemplate nested;

    public TradeService(JdbcClient jdbc, AppClock clock, LeagueLock lock, LeagueService leagues, RosterService roster,
                        SeasonService season, NotificationService notifications, PlatformTransactionManager txm) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.lock = lock;
        this.leagues = leagues;
        this.roster = roster;
        this.season = season;
        this.notifications = notifications;
        this.nested = new TransactionTemplate(txm);
        this.nested.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    }

    public record TradeItem(long playerId, String playerName, long fromTeamId) {
    }

    public record Trade(long id, long proposerTeamId, String proposerName, long receiverTeamId, String receiverName,
                        String status, String message, String resultNote, OffsetDateTime createdAt,
                        OffsetDateTime reviewEndsAt, List<TradeItem> items, int objections, int eligibleVoters,
                        boolean myObjection) {
    }

    @Transactional
    public long propose(long proposerTeamId, long receiverTeamId, List<Long> give, List<Long> receive, String message) {
        RosterService.Team proposer = roster.team(proposerTeamId);
        RosterService.Team receiver = roster.team(receiverTeamId);
        if (proposer.leagueId() != receiver.leagueId() || proposerTeamId == receiverTeamId) {
            throw ApiException.badRequest("交易對象無效");
        }
        if ((give == null || give.isEmpty()) && (receive == null || receive.isEmpty())) {
            throw ApiException.badRequest("交易內容不可為空");
        }
        League league = leagues.get(proposer.leagueId());
        lock.lock(league.id());
        requireBeforeDeadline(league.id());
        LocalDate today = clock.today();
        for (Long p : give) {
            roster.requireOnRoster(proposerTeamId, p, today);
        }
        for (Long p : receive) {
            roster.requireOnRoster(receiverTeamId, p, today);
        }
        long id = jdbc.sql("""
                insert into trade (league_id, proposer_team_id, receiver_team_id, message) values (?, ?, ?, ?) returning id
                """).params(league.id(), proposerTeamId, receiverTeamId, message).query(Long.class).single();
        for (Long p : give) {
            jdbc.sql("insert into trade_item (trade_id, player_id, from_team_id) values (?, ?, ?)").params(id, p, proposerTeamId).update();
        }
        for (Long p : receive) {
            jdbc.sql("insert into trade_item (trade_id, player_id, from_team_id) values (?, ?, ?)").params(id, p, receiverTeamId).update();
        }
        notifications.notify(receiverTeamId, proposer.name() + " 向你提出交易");
        return id;
    }

    @Transactional
    public void respond(long teamId, long tradeId, boolean accept) {
        TradeRow t = row(tradeId);
        if (!"PROPOSED".equals(t.status())) {
            throw ApiException.conflict("交易狀態已變更");
        }
        if (t.receiverTeamId() == teamId) {
            if (accept) {
                League league = leagues.get(t.leagueId());
                requireBeforeDeadline(league.id());
                Instant ends = clock.now().plus(Duration.ofHours(league.tradeReviewHours()));
                jdbc.sql("update trade set status = 'IN_REVIEW', accepted_at = ?, review_ends_at = ? where id = ?")
                        .params(Timestamp.from(clock.now()), Timestamp.from(ends), tradeId).update();
                notifications.notifyLeague(t.leagueId(), "交易進入 " + league.tradeReviewHours() + " 小時聯盟審核期，可於交易頁表示反對");
            } else {
                setStatus(tradeId, "REJECTED", "對方拒絕");
                notifications.notify(t.proposerTeamId(), "交易提案遭拒絕");
            }
        } else if (t.proposerTeamId() == teamId && !accept) {
            setStatus(tradeId, "CANCELLED", "提案方撤回");
        } else {
            throw ApiException.forbidden("你無權處理此交易");
        }
    }

    @Transactional
    public void vote(long teamId, long tradeId, boolean object) {
        TradeRow t = row(tradeId);
        if (!"IN_REVIEW".equals(t.status())) {
            throw ApiException.conflict("交易不在審核期");
        }
        if (teamId == t.proposerTeamId() || teamId == t.receiverTeamId()) {
            throw ApiException.badRequest("交易當事隊伍不可投票");
        }
        jdbc.sql("""
                insert into trade_vote (trade_id, team_id, objects) values (?, ?, ?)
                on conflict (trade_id, team_id) do update set objects = excluded.objects, created_at = now()
                """).params(tradeId, teamId, object).update();
        int[] tally = tally(t);
        if (tally[0] * 2 > tally[1]) {
            setStatus(tradeId, "VETOED", "過半數隊伍反對，交易否決");
            notifications.notify(t.proposerTeamId(), "交易遭聯盟否決");
            notifications.notify(t.receiverTeamId(), "交易遭聯盟否決");
        }
    }

    /** 審核期滿的交易自動執行。 */
    @Transactional
    public int processDue() {
        List<Long> due = jdbc.sql("select id from trade where status = 'IN_REVIEW' and review_ends_at <= ?")
                .param(Timestamp.from(clock.now())).query(Long.class).list();
        for (Long id : due) {
            TradeRow t = row(id);
            lock.lock(t.leagueId());
            try {
                nested.executeWithoutResult(s -> execute(t));
                setStatus(id, "COMPLETED", "交易完成");
                notifications.notifyLeague(t.leagueId(), "交易完成：" + describe(id));
            } catch (ApiException e) {
                setStatus(id, "FAILED", e.getMessage());
                notifications.notify(t.proposerTeamId(), "交易無法執行：" + e.getMessage());
                notifications.notify(t.receiverTeamId(), "交易無法執行：" + e.getMessage());
            }
        }
        return due.size();
    }

    private void execute(TradeRow t) {
        League league = leagues.get(t.leagueId());
        LocalDate today = clock.today();
        List<TradeItem> items = items(t.id());
        LocalDate eff = today;
        for (TradeItem i : items) {
            roster.requireOnRoster(i.fromTeamId(), i.playerId(), today);
            LocalDate e = roster.effectiveDate(i.playerId());
            if (e.isAfter(eff)) {
                eff = e;
            }
        }
        for (TradeItem i : items) {
            long to = i.fromTeamId() == t.proposerTeamId() ? t.receiverTeamId() : t.proposerTeamId();
            roster.removeInternal(i.fromTeamId(), i.playerId(), eff);
            roster.addInternal(to, i.playerId(), Slot.BN, eff, "TRADE", 0);
        }
        for (long team : new long[]{t.proposerTeamId(), t.receiverTeamId()}) {
            roster.validate(league, team, today);
            roster.validate(league, team, eff);
        }
    }

    private void requireBeforeDeadline(long leagueId) {
        LocalDate today = clock.today();
        SeasonService.Half half = season.currentHalf(leagueId, today).orElse(null);
        if (half == null) {
            return;
        }
        LocalDate lastStart = season.periods(leagueId).stream()
                .filter(p -> p.halfId() == half.id() && "REGULAR".equals(p.kind()))
                .map(SeasonService.Period::startDate).max(LocalDate::compareTo).orElse(null);
        if (lastStart != null && !today.isBefore(lastStart) && !today.isAfter(half.endDate())) {
            throw ApiException.conflict("已過本半季交易截止日（最後一期對戰開始前）");
        }
    }

    record TradeRow(long id, long leagueId, long proposerTeamId, long receiverTeamId, String status) {
    }

    private TradeRow row(long id) {
        return jdbc.sql("select id, league_id, proposer_team_id, receiver_team_id, status from trade where id = ?").param(id)
                .query((rs, n) -> new TradeRow(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getLong(4), rs.getString(5)))
                .optional().orElseThrow(() -> ApiException.notFound("交易不存在"));
    }

    /** [反對數, 有投票權隊伍數]。 */
    private int[] tally(TradeRow t) {
        int voters = jdbc.sql("select count(*) from fantasy_team where league_id = ?").param(t.leagueId()).query(Integer.class).single() - 2;
        int objections = jdbc.sql("select count(*) from trade_vote where trade_id = ? and objects").param(t.id())
                .query(Integer.class).single();
        return new int[]{objections, voters};
    }

    private void setStatus(long id, String status, String note) {
        jdbc.sql("""
                update trade set status = ?, result_note = ?, completed_at = case when ? then ? else completed_at end where id = ?
                """).params(status, note, "COMPLETED".equals(status), Timestamp.from(clock.now()), id).update();
    }

    private List<TradeItem> items(long tradeId) {
        return jdbc.sql("""
                select i.player_id, p.name, i.from_team_id from trade_item i join player p on p.id = i.player_id where i.trade_id = ?
                """).param(tradeId).query((rs, n) -> new TradeItem(rs.getLong(1), rs.getString(2), rs.getLong(3))).list();
    }

    private String describe(long tradeId) {
        List<String> parts = new ArrayList<>();
        for (TradeItem i : items(tradeId)) {
            parts.add(i.playerName());
        }
        return String.join("、", parts);
    }

    public List<Trade> list(long leagueId, long viewerTeamId) {
        record Base(long id, long p, String pn, long r, String rn, String status, String message, String note,
                    OffsetDateTime created, OffsetDateTime ends) {
        }
        List<Base> bases = jdbc.sql("""
                select t.id, t.proposer_team_id, tp.name, t.receiver_team_id, tr.name, t.status, t.message, t.result_note,
                       t.created_at, t.review_ends_at
                from trade t join fantasy_team tp on tp.id = t.proposer_team_id join fantasy_team tr on tr.id = t.receiver_team_id
                where t.league_id = ? order by t.created_at desc limit 50
                """).param(leagueId).query((rs, n) -> new Base(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getLong(4),
                rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8), rs.getObject(9, OffsetDateTime.class),
                rs.getObject(10, OffsetDateTime.class))).list();
        List<Trade> out = new ArrayList<>();
        Set<Long> mine = new HashSet<>(jdbc.sql("select trade_id from trade_vote where team_id = ? and objects")
                .param(viewerTeamId).query(Long.class).list());
        for (Base b : bases) {
            // 提案中的交易只有當事雙方可見
            if ("PROPOSED".equals(b.status()) && viewerTeamId != b.p() && viewerTeamId != b.r()) {
                continue;
            }
            int[] tally = tally(new TradeRow(b.id(), leagueId, b.p(), b.r(), b.status()));
            out.add(new Trade(b.id(), b.p(), b.pn(), b.r(), b.rn(), b.status(), b.message(), b.note(), b.created(), b.ends(),
                    items(b.id()), tally[0], tally[1], mine.contains(b.id())));
        }
        return out;
    }

    /** 半季重新選秀時，未完成的交易一律取消。 */
    public void cancelOpen(long leagueId, String reason) {
        jdbc.sql("update trade set status = 'CANCELLED', result_note = ? where league_id = ? and status in ('PROPOSED', 'IN_REVIEW')")
                .params(reason, leagueId).update();
    }
}
