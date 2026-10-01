package tw.cpblf.draft;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
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
import tw.cpblf.roster.EligibilityService;
import tw.cpblf.roster.RosterService;
import tw.cpblf.roster.Slot;
import tw.cpblf.roster.SlotAssigner;
import tw.cpblf.season.SeasonService;
import tw.cpblf.trade.TradeService;

/**
 * CPBLF-40 / CPBLF-41：Snake draft 與 keeper（規則書 7、4.3）。
 */
@Service
public class DraftService {

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final LeagueLock lock;
    private final LeagueService leagues;
    private final SeasonService season;
    private final RosterService roster;
    private final EligibilityService eligibility;
    private final PlayerRankingService ranking;
    private final TradeService trades;
    private final NotificationService notifications;

    public DraftService(JdbcClient jdbc, AppClock clock, LeagueLock lock, LeagueService leagues, SeasonService season,
                        RosterService roster, EligibilityService eligibility, PlayerRankingService ranking, TradeService trades,
                        NotificationService notifications) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.lock = lock;
        this.leagues = leagues;
        this.season = season;
        this.roster = roster;
        this.eligibility = eligibility;
        this.ranking = ranking;
        this.trades = trades;
        this.notifications = notifications;
    }

    record DraftRow(long id, long leagueId, long halfId, int halfNo, LocalDate halfStart, String status, int rounds,
                    int pickSeconds, int currentPickNo, Instant deadline) {
    }

    private DraftRow draft(long draftId) {
        return jdbc.sql("""
                select d.id, d.league_id, d.season_half_id, h.half_no, h.start_date, d.status, d.rounds, d.pick_seconds,
                       d.current_pick_no, d.current_pick_deadline
                from draft d join season_half h on h.id = d.season_half_id where d.id = ?
                """).param(draftId).query((rs, n) -> new DraftRow(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getInt(4),
                rs.getObject(5, LocalDate.class), rs.getString(6), rs.getInt(7), rs.getInt(8), rs.getInt(9),
                rs.getTimestamp(10) == null ? null : rs.getTimestamp(10).toInstant()))
                .optional().orElseThrow(() -> ApiException.notFound("選秀不存在"));
    }

    // ------------------------------------------------------------------
    // 建立、keeper、開始
    // ------------------------------------------------------------------

    @Transactional
    public long create(long leagueId, int halfNo, List<Long> order) {
        League league = leagues.get(leagueId);
        lock.lock(leagueId);
        SeasonService.Half half = season.halves(leagueId).stream().filter(h -> h.halfNo() == halfNo).findFirst()
                .orElseThrow(() -> ApiException.badRequest("請先產生賽程"));
        Long existing = jdbc.sql("select id from draft where season_half_id = ?").param(half.id()).query(Long.class)
                .optional().orElse(null);
        if (existing != null) {
            String st = draft(existing).status();
            if ("IN_PROGRESS".equals(st) || "COMPLETED".equals(st)) {
                throw ApiException.conflict("此半季選秀已開始或已完成");
            }
            jdbc.sql("delete from keeper_selection where draft_id = ?").param(existing).update();
            jdbc.sql("delete from draft_slot where draft_id = ?").param(existing).update();
            jdbc.sql("delete from draft where id = ?").param(existing).update();
        }
        List<Long> teams = jdbc.sql("select id from fantasy_team where league_id = ? order by id").param(leagueId)
                .query(Long.class).list();
        if (teams.size() < 2) {
            throw ApiException.badRequest("至少需要 2 隊");
        }
        if (league.draftRounds() > league.rosterSize() + league.slotsNa()) {
            throw ApiException.badRequest("選秀輪數超過名單容量");
        }
        List<Long> o;
        if (order != null && !order.isEmpty()) {
            if (!new HashSet<>(order).equals(new HashSet<>(teams)) || order.size() != teams.size()) {
                throw ApiException.badRequest("選秀順序需包含所有隊伍各一次");
            }
            o = order;
        } else {
            o = new ArrayList<>(teams);
            Collections.shuffle(o, new Random(clock.now().toEpochMilli()));
        }
        boolean keepers = halfNo == 2 && league.keeperLimit() > 0;
        long id = jdbc.sql("""
                insert into draft (league_id, season_half_id, status, rounds, pick_seconds) values (?, ?, ?, ?, ?) returning id
                """).params(leagueId, half.id(), keepers ? "KEEPERS" : "SETUP", league.draftRounds(), league.draftPickSeconds())
                .query(Long.class).single();
        for (int i = 0; i < o.size(); i++) {
            jdbc.sql("insert into draft_slot (draft_id, team_id, draft_position) values (?, ?, ?)").params(id, o.get(i), i + 1).update();
        }
        notifications.notifyLeague(leagueId, (halfNo == 1 ? "上" : "下") + "半季選秀已建立"
                + (keepers ? "，請於選秀開始前選定至多 " + league.keeperLimit() + " 名 keeper" : ""));
        return id;
    }

    public record KeeperView(long playerId, String name, int round) {
    }

    @Transactional
    public List<KeeperView> setKeepers(long draftId, long teamId, List<Long> playerIds) {
        DraftRow d = draft(draftId);
        League league = leagues.get(d.leagueId());
        lock.lock(d.leagueId());
        if (!"KEEPERS".equals(d.status())) {
            throw ApiException.conflict("目前不是 keeper 選擇期");
        }
        if (playerIds.size() > league.keeperLimit()) {
            throw ApiException.badRequest("keeper 至多 " + league.keeperLimit() + " 人");
        }
        LocalDate today = clock.today();
        for (Long p : playerIds) {
            roster.requireOnRoster(teamId, p, today);
            String reg = jdbc.sql("select registration_status from player where id = ?").param(p).query(String.class).single();
            if ("DELISTED".equals(reg)) {
                throw ApiException.badRequest("已註銷球員不可保留：" + roster.playerName(p));
            }
        }
        int foreign = playerIds.isEmpty() ? 0 : jdbc.sql("select count(*) from player where id in (:ids) and is_foreign")
                .param("ids", playerIds).query(Integer.class).single();
        if (foreign > league.foreignPlayerLimit()) {
            throw ApiException.badRequest("keeper 洋將超過上限");
        }
        jdbc.sql("delete from keeper_selection where draft_id = ? and team_id = ?").params(draftId, teamId).update();

        // Keeper 佔用輪次 = 上次被選中輪次 − offset；非選秀取得者視為最後一輪。同隊衝突時往前一輪找，再往後找。
        Long prevDraft = jdbc.sql("""
                select d.id from draft d join season_half h on h.id = d.season_half_id
                where d.league_id = ? and h.half_no < ? and d.status = 'COMPLETED' order by h.half_no desc limit 1
                """).params(d.leagueId(), d.halfNo()).query(Long.class).optional().orElse(null);
        List<long[]> wanted = new ArrayList<>();
        for (Long p : playerIds) {
            Integer last = prevDraft == null ? null : jdbc.sql("""
                    select round from draft_pick where draft_id = ? and player_id = ?
                    """).params(prevDraft, p).query(Integer.class).optional().orElse(null);
            int base = last == null ? d.rounds() : last;
            wanted.add(new long[]{p, Math.max(1, base - league.keeperRoundOffset())});
        }
        wanted.sort(Comparator.comparingLong(w -> w[1]));
        Set<Integer> used = new HashSet<>();
        List<KeeperView> out = new ArrayList<>();
        for (long[] w : wanted) {
            int r = (int) w[1];
            int chosen = -1;
            for (int x = r; x >= 1 && chosen < 0; x--) {
                if (!used.contains(x)) chosen = x;
            }
            for (int x = r + 1; x <= d.rounds() && chosen < 0; x++) {
                if (!used.contains(x)) chosen = x;
            }
            used.add(chosen);
            jdbc.sql("insert into keeper_selection (draft_id, team_id, player_id, round) values (?, ?, ?, ?)")
                    .params(draftId, teamId, w[0], chosen).update();
            out.add(new KeeperView(w[0], roster.playerName(w[0]), chosen));
        }
        return out;
    }

    @Transactional
    public void start(long draftId) {
        DraftRow d = draft(draftId);
        lock.lock(d.leagueId());
        if (!"SETUP".equals(d.status()) && !"KEEPERS".equals(d.status())) {
            throw ApiException.conflict("選秀已開始");
        }
        List<Long> order = jdbc.sql("select team_id from draft_slot where draft_id = ? order by draft_position").param(draftId)
                .query(Long.class).list();
        int n = order.size();
        int pickNo = 1;
        Map<String, Integer> pickOf = new HashMap<>();
        for (int r = 1; r <= d.rounds(); r++) {
            for (int i = 0; i < n; i++) {
                long team = r % 2 == 1 ? order.get(i) : order.get(n - 1 - i);
                jdbc.sql("insert into draft_pick (draft_id, pick_no, round, team_id) values (?, ?, ?, ?)")
                        .params(draftId, pickNo, r, team).update();
                pickOf.put(team + ":" + r, pickNo);
                pickNo++;
            }
        }
        Instant now = clock.now();
        jdbc.sql("select team_id, player_id, round from keeper_selection where draft_id = ?").param(draftId)
                .query((rs, x) -> {
                    int pn = pickOf.get(rs.getLong(1) + ":" + rs.getInt(3));
                    jdbc.sql("""
                            update draft_pick set player_id = ?, is_keeper = true, picked_at = ? where draft_id = ? and pick_no = ?
                            """).params(rs.getLong(2), Timestamp.from(now), draftId, pn).update();
                    return null;
                }).list();
        jdbc.sql("update draft set status = 'IN_PROGRESS', started_at = ? where id = ?").params(Timestamp.from(now), draftId).update();
        trades.cancelOpen(d.leagueId(), "選秀開始，未完成交易取消");
        advance(draftId);
        notifications.notifyLeague(d.leagueId(), "選秀開始！");
    }

    // ------------------------------------------------------------------
    // 選擇
    // ------------------------------------------------------------------

    @Transactional
    public void pick(long draftId, long actingTeamId, long playerId) {
        DraftRow d = draft(draftId);
        lock.lock(d.leagueId());
        if (!"IN_PROGRESS".equals(d.status())) {
            throw ApiException.conflict("選秀未在進行中");
        }
        long onClock = currentTeam(d);
        if (onClock != actingTeamId) {
            throw ApiException.conflict("還沒輪到你");
        }
        String err = validatePick(d, onClock, playerId);
        if (err != null) {
            throw ApiException.badRequest(err);
        }
        record(d, playerId, false);
    }

    /** 逾時自動選取當前排名最高、且符合洋將上限與位置需求的可選球員。 */
    @Transactional
    public boolean autoPick(long draftId) {
        DraftRow d = draft(draftId);
        lock.lock(d.leagueId());
        if (!"IN_PROGRESS".equals(d.status())) {
            return false;
        }
        long team = currentTeam(d);
        Map<Long, PlayerRankingService.Ranked> ranks = ranking.rankings();
        List<Long> pool = available(d);
        pool.sort(Comparator.comparingInt(id -> ranks.containsKey(id) ? ranks.get(id).rank() : Integer.MAX_VALUE));
        for (Long pid : pool) {
            if (validatePick(d, team, pid) == null) {
                record(d, pid, true);
                return true;
            }
        }
        throw new IllegalStateException("找不到可自動選取的球員");
    }

    /** 已逾時、需自動選取的選秀。由排程每秒檢查，再透過 bean 呼叫 autoPick（確保交易邊界）。 */
    public List<Long> overdueDrafts() {
        return jdbc.sql("select id from draft where status = 'IN_PROGRESS' and current_pick_deadline <= ?")
                .param(Timestamp.from(clock.now())).query(Long.class).list();
    }

    public boolean inProgress(long draftId) {
        return "IN_PROGRESS".equals(draft(draftId).status());
    }

    private void record(DraftRow d, long playerId, boolean auto) {
        jdbc.sql("""
                update draft_pick set player_id = ?, is_auto = ?, picked_at = ? where draft_id = ? and pick_no = ?
                """).params(playerId, auto, Timestamp.from(clock.now()), d.id(), d.currentPickNo()).update();
        advance(d.id());
    }

    private void advance(long draftId) {
        DraftRow d = draft(draftId);
        Integer next = jdbc.sql("select min(pick_no) from draft_pick where draft_id = ? and player_id is null").param(draftId)
                .query(Integer.class).optional().orElse(null);
        if (next == null) {
            complete(d);
            return;
        }
        Instant deadline = clock.now().plus(Duration.ofSeconds(d.pickSeconds()));
        jdbc.sql("update draft set current_pick_no = ?, current_pick_deadline = ? where id = ?")
                .params(next, Timestamp.from(deadline), draftId).update();
    }

    private long currentTeam(DraftRow d) {
        return jdbc.sql("select team_id from draft_pick where draft_id = ? and pick_no = ?").params(d.id(), d.currentPickNo())
                .query(Long.class).single();
    }

    private List<Long> available(DraftRow d) {
        return new ArrayList<>(jdbc.sql("""
                select id from player where registration_status = 'REGISTERED' and first_team_status = 'ACTIVE'
                  and id not in (select player_id from draft_pick where draft_id = ? and player_id is not null)
                """).param(d.id()).query(Long.class).list());
    }

    /** 回傳錯誤訊息，或 null 表示可選。 */
    String validatePick(DraftRow d, long teamId, long playerId) {
        League league = leagues.get(d.leagueId());
        String[] st = jdbc.sql("select registration_status, first_team_status from player where id = ?").param(playerId)
                .query((rs, n) -> new String[]{rs.getString(1), rs.getString(2)}).optional().orElse(null);
        if (st == null) {
            return "球員不存在";
        }
        if (!"REGISTERED".equals(st[0]) || !"ACTIVE".equals(st[1])) {
            return "只有一軍登錄球員可被選取";
        }
        int taken = jdbc.sql("select count(*) from draft_pick where draft_id = ? and player_id = ?").params(d.id(), playerId)
                .query(Integer.class).single();
        if (taken > 0) {
            return "該球員已被選走";
        }
        List<Long> mine = new ArrayList<>(jdbc.sql("""
                select player_id from draft_pick where draft_id = ? and team_id = ? and player_id is not null order by pick_no
                """).params(d.id(), teamId).query(Long.class).list());
        mine.add(playerId);
        int foreign = jdbc.sql("select count(*) from player where id in (:ids) and is_foreign").param("ids", mine)
                .query(Integer.class).single();
        if (foreign > league.foreignPlayerLimit()) {
            return "洋將已達上限（" + league.foreignPlayerLimit() + " 人）";
        }
        int totalPicks = jdbc.sql("select count(*) from draft_pick where draft_id = ? and team_id = ?").params(d.id(), teamId)
                .query(Integer.class).single();
        int remaining = totalPicks - mine.size();
        LocalDate date = eligibilityDate(d);
        Map<Long, Set<Slot>> el = eligibility.eligibility(league, mine, date);
        List<SlotAssigner.Candidate> cands = mine.stream().map(id -> new SlotAssigner.Candidate(id, el.get(id))).toList();
        int unfilled = SlotAssigner.unfilled(cands, league.slotCounts());
        if (unfilled > remaining) {
            return "選擇此球員後將無法補滿先發位置（尚缺 " + unfilled + " 個、剩 " + remaining + " 輪）";
        }
        return null;
    }

    private LocalDate eligibilityDate(DraftRow d) {
        LocalDate today = clock.today();
        return today.isBefore(d.halfStart()) ? d.halfStart() : today;
    }

    // ------------------------------------------------------------------
    // 完成：建立名單
    // ------------------------------------------------------------------

    private void complete(DraftRow d) {
        League league = leagues.get(d.leagueId());
        LocalDate today = clock.today();
        LocalDate eff = today.plusDays(1).isAfter(d.halfStart()) ? today.plusDays(1) : d.halfStart();
        List<Long> teams = jdbc.sql("select id from fantasy_team where league_id = ?").param(d.leagueId()).query(Long.class).list();

        // 半季重新選秀：舊名單於生效日結束，waiver / 出價 / 交易清空，FAAB 重置
        for (Long t : teams) {
            for (RosterService.Entry e : roster.openEntries(t, today)) {
                roster.removeInternal(t, e.playerId(), eff);
            }
        }
        jdbc.sql("delete from waiver_player where league_id = ?").param(d.leagueId()).update();
        jdbc.sql("""
                update waiver_claim set status = 'CANCELLED', result_note = '半季重新選秀', processed_at = now()
                where league_id = ? and status = 'PENDING'
                """).param(d.leagueId()).update();
        trades.cancelOpen(d.leagueId(), "半季重新選秀");
        jdbc.sql("update fantasy_team set faab_budget = ?, lineup_lock_reason = null where league_id = ?")
                .params(league.faabBudgetPerHalf(), d.leagueId()).update();

        for (Long t : teams) {
            List<long[]> picks = jdbc.sql("""
                    select dp.player_id, case when p.first_team_status = 'MINORS' then 1 else 0 end
                    from draft_pick dp join player p on p.id = dp.player_id
                    where dp.draft_id = ? and dp.team_id = ? order by dp.pick_no
                    """).params(d.id(), t).query((rs, n) -> new long[]{rs.getLong(1), rs.getLong(2)}).list();
            List<Long> ids = picks.stream().map(p -> p[0]).toList();
            Map<Long, Set<Slot>> el = eligibility.eligibility(league, ids, eff);
            List<SlotAssigner.Candidate> cands = picks.stream().filter(p -> p[1] == 0)
                    .map(p -> new SlotAssigner.Candidate(p[0], el.get(p[0]))).toList();
            Map<Long, Slot> assigned = SlotAssigner.assign(cands, league.slotCounts());
            int na = 0;
            for (long[] p : picks) {
                Slot slot = assigned.get(p[0]);
                if (slot == null) {
                    slot = p[1] == 1 && na < league.slotsNa() ? Slot.NA : Slot.BN;
                    if (slot == Slot.NA) {
                        na++;
                    }
                }
                boolean keeper = jdbc.sql("select is_keeper from draft_pick where draft_id = ? and player_id = ?")
                        .params(d.id(), p[0]).query(Boolean.class).single();
                roster.addInternal(t, p[0], slot, eff, keeper ? "KEEPER" : "DRAFT", 0);
            }
        }
        jdbc.sql("update draft set status = 'COMPLETED', completed_at = ?, current_pick_deadline = null where id = ?")
                .params(Timestamp.from(clock.now()), d.id()).update();
        notifications.notifyLeague(d.leagueId(), "選秀完成，名單自 " + eff + " 起生效");
    }

    // ------------------------------------------------------------------
    // 查詢
    // ------------------------------------------------------------------

    public record PickView(int pickNo, int round, long teamId, String teamName, Long playerId, String playerName,
                           String playerTeam, boolean keeper, boolean auto) {
    }

    public record DraftView(long id, int halfNo, String status, int rounds, int pickSeconds, int currentPickNo,
                            Long currentTeamId, OffsetDateTime deadline, long secondsLeft, List<Long> order,
                            List<PickView> picks, List<KeeperView> myKeepers) {
    }

    public List<DraftView> list(long leagueId, Long viewerTeamId) {
        List<Long> ids = jdbc.sql("""
                select d.id from draft d join season_half h on h.id = d.season_half_id where d.league_id = ? order by h.half_no
                """).param(leagueId).query(Long.class).list();
        List<DraftView> out = new ArrayList<>();
        for (Long id : ids) {
            out.add(view(id, viewerTeamId));
        }
        return out;
    }

    public DraftView view(long draftId, Long viewerTeamId) {
        DraftRow d = draft(draftId);
        List<Long> order = jdbc.sql("select team_id from draft_slot where draft_id = ? order by draft_position").param(draftId)
                .query(Long.class).list();
        List<PickView> picks = jdbc.sql("""
                select dp.pick_no, dp.round, dp.team_id, t.name, dp.player_id, p.name, p.cpbl_team_code, dp.is_keeper, dp.is_auto
                from draft_pick dp join fantasy_team t on t.id = dp.team_id left join player p on p.id = dp.player_id
                where dp.draft_id = ? order by dp.pick_no
                """).param(draftId).query((rs, n) -> {
            return new PickView(rs.getInt(1), rs.getInt(2), rs.getLong(3), rs.getString(4), rs.getObject(5, Long.class),
                    rs.getString(6), rs.getString(7), rs.getBoolean(8), rs.getBoolean(9));
        }).list();
        Long current = "IN_PROGRESS".equals(d.status()) ? currentTeam(d) : null;
        long secondsLeft = d.deadline() == null ? 0 : Math.max(0, Duration.between(clock.now(), d.deadline()).toSeconds());
        List<KeeperView> keepers = viewerTeamId == null ? List.of() : jdbc.sql("""
                select k.player_id, p.name, k.round from keeper_selection k join player p on p.id = k.player_id
                where k.draft_id = ? and k.team_id = ? order by k.round
                """).params(draftId, viewerTeamId).query((rs, n) -> new KeeperView(rs.getLong(1), rs.getString(2), rs.getInt(3))).list();
        return new DraftView(d.id(), d.halfNo(), d.status(), d.rounds(), d.pickSeconds(), d.currentPickNo(), current,
                d.deadline() == null ? null : d.deadline().atZone(clock.zone()).toOffsetDateTime(), secondsLeft, order, picks,
                keepers);
    }

    public Long leagueOf(long draftId) {
        return draft(draftId).leagueId();
    }
}
