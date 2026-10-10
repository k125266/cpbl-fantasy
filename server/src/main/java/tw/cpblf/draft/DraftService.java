package tw.cpblf.draft;

import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
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

    /** Keeper 在選秀時間前這麼久截止（同時是順位揭曉的時間點）。 */
    public static final Duration KEEPER_LOCK_BEFORE = Duration.ofMinutes(10);

    record DraftRow(long id, long leagueId, long halfId, int halfNo, LocalDate halfStart, String status, int rounds,
                    int pickSeconds, int currentPickNo, Instant deadline, boolean snake, Instant scheduledAt,
                    Instant revealedAt) {

        /** keeper 截止時間：選秀時間前 10 分鐘；沒有設定選秀時間時為 null（揭曉時才鎖定）。 */
        Instant keeperDeadline() {
            return scheduledAt == null ? null : scheduledAt.minus(KEEPER_LOCK_BEFORE);
        }
    }

    private static Instant instant(java.sql.Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    DraftRow draft(long draftId) {
        return jdbc.sql("""
                select d.id, d.league_id, d.season_half_id, h.half_no, h.start_date, d.status, d.rounds, d.pick_seconds,
                       d.current_pick_no, d.current_pick_deadline, d.snake, d.scheduled_at, d.revealed_at
                from draft d join season_half h on h.id = d.season_half_id where d.id = ?
                """).param(draftId).query((rs, n) -> new DraftRow(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getInt(4),
                rs.getObject(5, LocalDate.class), rs.getString(6), rs.getInt(7), rs.getInt(8), rs.getInt(9),
                instant(rs.getTimestamp(10)), rs.getBoolean(11), instant(rs.getTimestamp(12)), instant(rs.getTimestamp(13))))
                .optional().orElseThrow(() -> ApiException.notFound("選秀不存在"));
    }

    // ------------------------------------------------------------------
    // 建立、keeper、揭曉、開始（E14：docs/rulebook-amendments.md「選秀與 keeper」）
    // ------------------------------------------------------------------

    public long create(long leagueId, int halfNo, List<Long> order) {
        return create(leagueId, halfNo, order, null);
    }

    /**
     * 選秀自動進入「準備中」（使用者決定：不預設選秀時間，管理員要開始就按開始，玩家自己討論時間）：
     * 上半季在賽程產生後（至少 2 隊）、下半季在上半季選秀完成後，沒有選秀就建立一場。已有的不動，所以可以重複呼叫。
     */
    @Transactional
    public void ensureDrafts(long leagueId) {
        List<SeasonService.Half> halves = season.halves(leagueId);
        if (halves.isEmpty()) {
            return;
        }
        lock.lock(leagueId);
        for (SeasonService.Half h : halves.stream().sorted(Comparator.comparingInt(SeasonService.Half::halfNo)).toList()) {
            Long existing = jdbc.sql("select id from draft where season_half_id = ?").param(h.id()).query(Long.class)
                    .optional().orElse(null);
            if (existing == null) {
                int teams = jdbc.sql("select count(*) from fantasy_team where league_id = ?").param(leagueId)
                        .query(Integer.class).single();
                if (teams >= 2) {
                    create(leagueId, h.halfNo(), null, null);
                }
                return;
            }
            if (!"COMPLETED".equals(draft(existing).status())) {
                return; // 這半季還沒選完，下半季先不出現
            }
        }
    }

    /**
     * 聯盟管理員按「開始選秀」：keeper 鎖定、馬上揭曉順位，動畫播完（{@link #REVEAL_SECONDS} 秒）後由排程自動開始第一手。
     * 每手秒數可以順便設定。
     */
    @Transactional
    public void begin(long draftId, Integer pickSeconds) {
        DraftRow d = draft(draftId);
        lock.lock(d.leagueId());
        if (!"SETUP".equals(d.status()) && !"KEEPERS".equals(d.status())) {
            throw ApiException.conflict("選秀已開始");
        }
        if (d.revealedAt() != null) {
            throw ApiException.conflict("已經按過開始選秀");
        }
        if (pickSeconds != null) {
            if (pickSeconds < 15) {
                throw ApiException.badRequest("每手至少 15 秒");
            }
            jdbc.sql("update draft set pick_seconds = ? where id = ?").params(pickSeconds, draftId).update();
        }
        revealInternal(draft(draftId));
    }

    /**
     * 上半季：蛇形 draft_rounds 輪，順位在揭曉時隨機抽出（或使用指定順序）。
     * 下半季：補強選秀，每輪同一順序 second_half_rounds 輪，順位在揭曉時依上半季戰績由差到好；建立後進入 keeper 選擇期。
     */
    @Transactional
    public long create(long leagueId, int halfNo, List<Long> order, Instant scheduledAt) {
        League league = leagues.get(leagueId);
        lock.lock(leagueId);
        SeasonService.Half half = season.halves(leagueId).stream().filter(h -> h.halfNo() == halfNo).findFirst()
                .orElseThrow(() -> ApiException.badRequest("請先產生賽程"));
        Long existing = jdbc.sql("select id from draft where season_half_id = ?").param(half.id()).query(Long.class)
                .optional().orElse(null);
        if (existing != null) {
            String st = draft(existing).status();
            if ("IN_PROGRESS".equals(st) || "PAUSED".equals(st) || "COMPLETED".equals(st)) {
                throw ApiException.conflict("此半季選秀已開始或已完成");
            }
            jdbc.sql("delete from keeper_selection where draft_id = ?").param(existing).update();
            jdbc.sql("delete from draft_queue where draft_id = ?").param(existing).update();
            jdbc.sql("delete from draft_slot where draft_id = ?").param(existing).update();
            jdbc.sql("delete from draft where id = ?").param(existing).update();
        }
        List<Long> teams = jdbc.sql("select id from fantasy_team where league_id = ? order by id").param(leagueId)
                .query(Long.class).list();
        if (teams.size() < 2) {
            throw ApiException.badRequest("至少需要 2 隊");
        }
        boolean second = halfNo == 2;
        int rounds = second ? league.secondHalfRounds() : league.draftRounds();
        boolean keepers = second && league.keeperLimit() > 0;
        if ((keepers ? league.keeperLimit() : 0) + rounds > league.rosterSize() + league.slotsNa()) {
            throw ApiException.badRequest("選秀輪數（加上 keeper）超過名單容量");
        }
        if (order != null && !order.isEmpty()
                && (!new HashSet<>(order).equals(new HashSet<>(teams)) || order.size() != teams.size())) {
            throw ApiException.badRequest("選秀順序需包含所有隊伍各一次");
        }
        long id = jdbc.sql("""
                insert into draft (league_id, season_half_id, status, rounds, pick_seconds, snake, scheduled_at)
                values (?, ?, ?, ?, ?, ?, ?) returning id
                """).params(leagueId, half.id(), keepers ? "KEEPERS" : "SETUP", rounds, league.draftPickSeconds(), !second,
                scheduledAt == null ? null : Timestamp.from(scheduledAt)).query(Long.class).single();
        // 指定順序（管理員手動）先存起來；揭曉前不公開
        if (order != null && !order.isEmpty()) {
            for (int i = 0; i < order.size(); i++) {
                jdbc.sql("insert into draft_slot (draft_id, team_id, draft_position) values (?, ?, ?)").params(id, order.get(i), i + 1).update();
            }
        }
        String when = scheduledAt == null ? "" : "（" + scheduledAt.atZone(clock.zone()).toLocalDateTime().toString().replace('T', ' ') + "）";
        notifications.notifyLeague(leagueId, second
                ? "下半季補強選秀已建立" + when + "，" + rounds + " 輪"
                + (keepers ? "；請在選秀前 10 分鐘以前選定至多 " + league.keeperLimit() + " 名 keeper" : "")
                : "上半季選秀已建立" + when + "，蛇形 " + rounds + " 輪；順位在選秀前抽籤");
        return id;
    }

    public record KeeperView(long playerId, String name) {
    }

    /**
     * Keeper 畫面的一位候選（自己目前名單上的人）。
     *
     * @param rank     本季排名（下半季選 keeper 時即上半季排名）；沒有數據為 null
     * @param via      取得方式，例：選秀第 3 輪、Keeper、交易、Waiver、自由球員
     * @param delisted 已註銷，不能保留
     * @param stats    本季數據（下半季選 keeper 時即上半季），與排名同一個來源
     * @param eligible 可擔任的先發位置（IF、OF、UTIL、SP、RP），前端用來算保留後的先發缺位
     */
    public record KeeperCandidate(long playerId, String name, String jerseyNumber, String cpblTeam, String position,
                                  boolean pitcher, Integer rank, String via, boolean delisted, DraftBoardService.Stats stats,
                                  List<String> eligible) {
    }

    /** 目前的自由球員（Keeper 頁第三欄）：一軍登錄、不在本聯盟任何隊的名單上。 */
    public record PoolPlayer(long playerId, String name, String jerseyNumber, String cpblTeam, String position,
                             boolean pitcher, Integer rank, List<String> eligible, DraftBoardService.Stats stats) {
    }

    /** 自由球員依排名（沒有數據排最後）取前 limit 位。別隊 keeper 揭曉前保密，所以這裡看不到。 */
    public List<PoolPlayer> keeperPool(long draftId, int limit) {
        DraftRow d = draft(draftId);
        League league = leagues.get(d.leagueId());
        Map<Long, PlayerRankingService.Ranked> ranks = ranking.rankings();
        Map<Long, PlayerRankingService.Line> lines = ranking.lines(PlayerRankingService.Period.SEASON);
        LocalDate today = clock.today();
        List<Long> ids = new ArrayList<>(jdbc.sql("""
                select p.id from player p
                where p.registration_status = 'REGISTERED' and p.first_team_status = 'ACTIVE'
                  and not exists (select 1 from roster_entry re join fantasy_team t on t.id = re.team_id
                                  where t.league_id = ? and re.player_id = p.id and re.valid_from <= ?
                                    and (re.valid_to is null or re.valid_to > ?))
                """).params(d.leagueId(), today, today).query(Long.class).list());
        ids.sort(Comparator.comparingInt(id -> ranks.containsKey(id) ? ranks.get(id).rank() : Integer.MAX_VALUE));
        List<Long> top = ids.subList(0, Math.min(ids.size(), limit));
        Map<Long, Set<Slot>> el = eligibility.eligibility(league, top, eligibilityDate(d));
        List<PoolPlayer> out = new ArrayList<>();
        for (Long id : top) {
            out.add(jdbc.sql("select name, jersey_number, cpbl_team_code, listed_position from player where id = ?").param(id)
                    .query((rs, n) -> new PoolPlayer(id, rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                            "P".equals(rs.getString(4)), ranks.containsKey(id) ? ranks.get(id).rank() : null,
                            slotNames(el.get(id)), DraftBoardService.Stats.of(lines.get(id)))).single());
        }
        return out;
    }

    /** 先發位置依 IF、OF、UTIL、SP、RP 的順序轉成名稱。 */
    static List<String> slotNames(Set<Slot> slots) {
        if (slots == null) {
            return List.of();
        }
        return java.util.Arrays.stream(Slot.STARTING).filter(slots::contains).map(Slot::name).toList();
    }

    public List<KeeperCandidate> keeperCandidates(long draftId, long teamId) {
        DraftRow d = draft(draftId);
        Map<Long, PlayerRankingService.Ranked> ranks = ranking.rankings();
        Map<Long, PlayerRankingService.Line> lines = ranking.lines(PlayerRankingService.Period.SEASON);
        LocalDate today = clock.today();
        List<KeeperCandidate> out = new ArrayList<>();
        List<RosterService.Entry> entries = roster.openEntries(teamId, today);
        Map<Long, Set<Slot>> el = eligibility.eligibility(leagues.get(d.leagueId()),
                entries.stream().map(RosterService.Entry::playerId).toList(), eligibilityDate(d));
        for (RosterService.Entry e : entries) {
            out.add(jdbc.sql("""
                    select p.name, p.jersey_number, p.cpbl_team_code, p.listed_position, p.registration_status,
                           (select re.acquired_via from roster_entry re where re.team_id = ? and re.player_id = p.id
                              and re.acquired_via <> 'MOVE' order by re.valid_from desc limit 1) as via,
                           (select dp.round from draft_pick dp join draft x on x.id = dp.draft_id
                              where x.league_id = ? and x.id <> ? and dp.team_id = ? and dp.player_id = p.id
                              order by x.id desc limit 1) as round
                    from player p where p.id = ?
                    """).params(teamId, d.leagueId(), d.id(), teamId, e.playerId()).query((rs, n) -> {
                String via = rs.getString("via");
                Integer round = (Integer) rs.getObject("round");
                String text = via == null ? "—" : switch (via) {
                    case "DRAFT" -> round == null ? "選秀" : "選秀第 " + round + " 輪";
                    case "KEEPER" -> "Keeper";
                    case "TRADE" -> "交易";
                    case "WAIVER" -> "Waiver";
                    case "FA" -> "自由球員";
                    default -> via;
                };
                PlayerRankingService.Ranked r = ranks.get(e.playerId());
                String pos = rs.getString("listed_position");
                return new KeeperCandidate(e.playerId(), rs.getString("name"), rs.getString("jersey_number"),
                        rs.getString("cpbl_team_code"), pos, "P".equals(pos), r == null ? null : r.rank(), text,
                        "DELISTED".equals(rs.getString("registration_status")), DraftBoardService.Stats.of(lines.get(e.playerId())),
                        slotNames(el.get(e.playerId())));
            }).single());
        }
        out.sort(Comparator.comparing((KeeperCandidate c) -> c.rank() == null ? Integer.MAX_VALUE : c.rank()));
        return out;
    }

    @Transactional
    public List<KeeperView> setKeepers(long draftId, long teamId, List<Long> playerIds) {
        DraftRow d = draft(draftId);
        League league = leagues.get(d.leagueId());
        lock.lock(d.leagueId());
        if (!"KEEPERS".equals(d.status()) || d.revealedAt() != null) {
            throw ApiException.conflict("目前不是 keeper 選擇期");
        }
        if (d.keeperDeadline() != null && !clock.now().isBefore(d.keeperDeadline())) {
            throw ApiException.conflict("keeper 已截止（選秀前 10 分鐘）");
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
        // Keeper 不佔輪次；揭曉前只有自己看得到
        List<KeeperView> out = new ArrayList<>();
        for (Long p : playerIds) {
            jdbc.sql("insert into keeper_selection (draft_id, team_id, player_id) values (?, ?, ?)").params(draftId, teamId, p).update();
            out.add(new KeeperView(p, roster.playerName(p)));
        }
        return out;
    }

    /**
     * 揭曉順位（同時鎖定並公開 keeper）。上半季隨機抽籤（或管理員指定的順序），下半季依上半季戰績由差到好。
     * 各裝置依 revealed_at 同步播放揭曉動畫。
     */
    @Transactional
    public void reveal(long draftId) {
        DraftRow d = draft(draftId);
        lock.lock(d.leagueId());
        if (d.revealedAt() != null) {
            throw ApiException.conflict("順位已揭曉");
        }
        if (!"SETUP".equals(d.status()) && !"KEEPERS".equals(d.status())) {
            throw ApiException.conflict("選秀已開始");
        }
        revealInternal(d);
    }

    private static final SecureRandom LOTTERY = new SecureRandom();

    /**
     * 上半季的順位抽籤。用 SecureRandom：以前用「時間毫秒」當種子，兩次抽籤的時間很接近時結果會一樣，
     * 玩家覺得「每次都一樣」。
     */
    static List<Long> lotteryOrder(List<Long> teams) {
        List<Long> out = new ArrayList<>(teams);
        Collections.shuffle(out, LOTTERY);
        return out;
    }

    private void revealInternal(DraftRow d) {
        List<Long> preset = jdbc.sql("select team_id from draft_slot where draft_id = ? order by draft_position").param(d.id())
                .query(Long.class).list();
        if (preset.isEmpty()) {
            List<Long> order;
            if (d.halfNo() == 2) {
                // 上半季戰績由差到好（戰績表名次倒序；同名次沿用戰績表的排序）
                List<SeasonService.StandingRow> st = new ArrayList<>(season.standings(d.leagueId(), 1));
                Collections.reverse(st);
                order = new ArrayList<>(st.stream().map(SeasonService.StandingRow::teamId).toList());
            } else {
                order = new ArrayList<>(jdbc.sql("select id from fantasy_team where league_id = ? order by id").param(d.leagueId())
                        .query(Long.class).list());
                order = lotteryOrder(order);
            }
            for (int i = 0; i < order.size(); i++) {
                jdbc.sql("insert into draft_slot (draft_id, team_id, draft_position) values (?, ?, ?)").params(d.id(), order.get(i), i + 1).update();
            }
        }
        Instant now = clock.now();
        jdbc.sql("update draft set revealed_at = ?, status = 'SETUP' where id = ?").params(Timestamp.from(now), d.id()).update();
        notifications.notifyLeague(d.leagueId(), (d.halfNo() == 2 ? "補強選秀順位揭曉，各隊 keeper 已公開" : "選秀順位抽籤揭曉"));
    }

    /** 揭曉動畫的長度（前端每 1.7 秒翻一張，5 隊約 9 秒），播完才能開始選秀。 */
    static final int REVEAL_SECONDS = 10;

    /** 排程每秒問一次：管理員已按開始（已揭曉）、而且揭曉動畫已播完的選秀，該自動開始第一手了。 */
    public List<Long> dueStarts() {
        return jdbc.sql("""
                select id from draft
                where status in ('SETUP', 'KEEPERS') and revealed_at is not null
                  and revealed_at + make_interval(secs => :anim) <= :now
                """).param("anim", REVEAL_SECONDS).param("now", Timestamp.from(clock.now())).query(Long.class).list();
    }

    /**
     * 從 API 開始選秀前的檢查：一定要先揭曉順位，而且揭曉動畫播完（使用者決定：不能跳過揭曉）。
     * {@link #start} 本身沒揭曉時仍會自動揭曉，只供測試與 demo 種子使用。
     */
    public void requireRevealShown(long draftId) {
        DraftRow d = draft(draftId);
        if (d.revealedAt() == null) {
            throw ApiException.conflict("請先揭曉順位，再開始選秀");
        }
        if (clock.now().isBefore(d.revealedAt().plusSeconds(REVEAL_SECONDS))) {
            throw ApiException.conflict("順位揭曉中，動畫播完再開始選秀");
        }
    }

    @Transactional
    public void start(long draftId) {
        DraftRow d = draft(draftId);
        lock.lock(d.leagueId());
        if (!"SETUP".equals(d.status()) && !"KEEPERS".equals(d.status())) {
            throw ApiException.conflict("選秀已開始");
        }
        if (d.revealedAt() == null) {
            revealInternal(d);
        }
        List<Long> order = jdbc.sql("select team_id from draft_slot where draft_id = ? order by draft_position").param(draftId)
                .query(Long.class).list();
        int n = order.size();
        int pickNo = 1;
        for (int r = 1; r <= d.rounds(); r++) {
            for (int i = 0; i < n; i++) {
                // 蛇形：雙數輪反向；補強選秀每輪同一順序
                long team = !d.snake() || r % 2 == 1 ? order.get(i) : order.get(n - 1 - i);
                jdbc.sql("insert into draft_pick (draft_id, pick_no, round, team_id) values (?, ?, ?, ?)")
                        .params(draftId, pickNo, r, team).update();
                pickNo++;
            }
        }
        Instant now = clock.now();
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

    /**
     * 逾時（或剩餘全部自動選取）時代選：候選清單第一個能選的 → 能補先發缺位、選秀排名最高的 → 選秀排名最高的。
     * 都要通過洋將上限與位置檢查（{@link #validatePick}）。選秀排名上半季用參考季（{@link PlayerRankingService#draftBasis}）。
     */
    @Transactional
    public boolean autoPick(long draftId) {
        DraftRow d = draft(draftId);
        lock.lock(d.leagueId());
        if (!"IN_PROGRESS".equals(d.status())) {
            return false;
        }
        long team = currentTeam(d);
        for (Long pid : queue(draftId, team)) {
            if (validatePick(d, team, pid) == null) {
                record(d, pid, true);
                return true;
            }
        }
        Map<Long, PlayerRankingService.Ranked> ranks = ranking.draftBasis(d.halfNo()).ranks();
        List<Long> pool = available(d);
        pool.sort(Comparator.comparingInt(id -> ranks.containsKey(id) ? ranks.get(id).rank() : Integer.MAX_VALUE));
        Set<Long> fills = fillsNeed(d, team, pool.subList(0, Math.min(pool.size(), NEED_LOOKAHEAD)));
        for (Long pid : pool) {
            if (fills.contains(pid) && validatePick(d, team, pid) == null) {
                record(d, pid, true);
                return true;
            }
        }
        for (Long pid : pool) {
            if (validatePick(d, team, pid) == null) {
                record(d, pid, true);
                return true;
            }
        }
        throw new IllegalStateException("找不到可自動選取的球員");
    }

    /** 補缺位只看排名前這麼多人（避免對整個球員池逐一計算）。 */
    static final int NEED_LOOKAHEAD = 60;

    /** 候選中能讓這隊的先發缺位變少的人。 */
    Set<Long> fillsNeed(DraftRow d, long teamId, List<Long> candidates) {
        League league = leagues.get(d.leagueId());
        List<Long> mine = teamPlayers(d, teamId);
        List<Long> all = new ArrayList<>(mine);
        all.addAll(candidates);
        Map<Long, Set<Slot>> el = eligibility.eligibility(league, all, eligibilityDate(d));
        List<SlotAssigner.Candidate> base = mine.stream().map(id -> new SlotAssigner.Candidate(id, el.get(id))).toList();
        int before = SlotAssigner.unfilled(base, league.slotCounts());
        Set<Long> out = new HashSet<>();
        for (Long c : candidates) {
            List<SlotAssigner.Candidate> with = new ArrayList<>(base);
            with.add(new SlotAssigner.Candidate(c, el.get(c)));
            if (SlotAssigner.unfilled(with, league.slotCounts()) < before) {
                out.add(c);
            }
        }
        return out;
    }

    // ------------------------------------------------------------------
    // 候選清單（預排清單）：網頁與手機同步；被選走的自動移除；逾時先從這裡選
    // ------------------------------------------------------------------

    /** 這隊的候選清單（依順序），只含還能選的人。 */
    public List<Long> queue(long draftId, long teamId) {
        return jdbc.sql("""
                select q.player_id from draft_queue q
                where q.draft_id = ? and q.team_id = ?
                  and q.player_id not in (select player_id from draft_pick where draft_id = q.draft_id and player_id is not null)
                  and q.player_id not in (select player_id from keeper_selection where draft_id = q.draft_id)
                order by q.position
                """).params(draftId, teamId).query(Long.class).list();
    }

    @Transactional
    public List<Long> setQueue(long draftId, long teamId, List<Long> playerIds) {
        DraftRow d = draft(draftId);
        if ("COMPLETED".equals(d.status())) {
            throw ApiException.conflict("選秀已完成");
        }
        jdbc.sql("delete from draft_queue where draft_id = ? and team_id = ?").params(draftId, teamId).update();
        int pos = 0;
        for (Long p : new java.util.LinkedHashSet<>(playerIds)) {
            jdbc.sql("insert into draft_queue (draft_id, team_id, player_id, position) values (?, ?, ?, ?)")
                    .params(draftId, teamId, p, pos++).update();
        }
        return queue(draftId, teamId);
    }

    /** 已逾時、需自動選取的選秀。由排程每秒檢查，再透過 bean 呼叫 autoPick（確保交易邊界）。 */
    /** 託管隊伍輪到後幾秒自動選（E18）。 */
    static final int AUTOPILOT_SECONDS = 3;

    /** 該自動選的選秀：時間到了，或輪到託管隊伍且這一手已開始 AUTOPILOT_SECONDS 秒。 */
    public List<Long> overdueDrafts() {
        return jdbc.sql("""
                select d.id from draft d
                left join draft_pick p on p.draft_id = d.id and p.pick_no = d.current_pick_no
                left join fantasy_team t on t.id = p.team_id
                where d.status = 'IN_PROGRESS'
                  and (d.current_pick_deadline <= :now
                       or (t.draft_autopilot
                           and d.current_pick_deadline - make_interval(secs => d.pick_seconds - :auto) <= :now))
                """).param("now", Timestamp.from(clock.now())).param("auto", AUTOPILOT_SECONDS).query(Long.class).list();
    }

    /** 設定一隊的託管（隊伍屬於這場選秀的聯盟）。 */
    public void setAutopilot(long draftId, long teamId, boolean on) {
        int n = jdbc.sql("update fantasy_team set draft_autopilot = ? where id = ? and league_id = (select league_id from draft where id = ?)")
                .params(on, teamId, draftId).update();
        if (n == 0) {
            throw ApiException.notFound("隊伍不在這場選秀的聯盟");
        }
    }

    public boolean inProgress(long draftId) {
        return "IN_PROGRESS".equals(draft(draftId).status());
    }

    // ------------------------------------------------------------------
    // 聯盟管理員：選秀中暫停／繼續、調整每手秒數
    // ------------------------------------------------------------------

    /** 暫停：記下這一手剩下的時間；暫停中不能選人，逾時與託管也不動作。 */
    @Transactional
    public void pause(long draftId) {
        DraftRow d = draft(draftId);
        lock.lock(d.leagueId());
        if (!"IN_PROGRESS".equals(d.status())) {
            throw ApiException.conflict("選秀沒有在進行中");
        }
        long remaining = d.deadline() == null ? d.pickSeconds() * 1000L
                : Math.max(0, Duration.between(clock.now(), d.deadline()).toMillis());
        jdbc.sql("update draft set status = 'PAUSED', paused_remaining_ms = ? where id = ?").params(remaining, draftId).update();
        notifications.notifyLeague(d.leagueId(), "選秀已暫停");
    }

    /** 繼續：這一手從暫停時剩下的時間接著倒數。 */
    @Transactional
    public void resume(long draftId) {
        DraftRow d = draft(draftId);
        lock.lock(d.leagueId());
        if (!"PAUSED".equals(d.status())) {
            throw ApiException.conflict("選秀沒有暫停");
        }
        Integer remaining = jdbc.sql("select paused_remaining_ms from draft where id = ?").param(draftId).query(Integer.class).single();
        Instant deadline = clock.now().plusMillis(remaining == null ? d.pickSeconds() * 1000L : remaining);
        jdbc.sql("update draft set status = 'IN_PROGRESS', current_pick_deadline = ?, paused_remaining_ms = null where id = ?")
                .params(Timestamp.from(deadline), draftId).update();
        notifications.notifyLeague(d.leagueId(), "選秀繼續");
    }

    /** 調整每手秒數（至少 15 秒）：從下一手開始生效，這一手照原本的倒數。 */
    @Transactional
    public void setPickSeconds(long draftId, int seconds) {
        DraftRow d = draft(draftId);
        lock.lock(d.leagueId());
        if (seconds < 15) {
            throw ApiException.badRequest("每手至少 15 秒");
        }
        if ("COMPLETED".equals(d.status())) {
            throw ApiException.conflict("選秀已完成");
        }
        jdbc.sql("update draft set pick_seconds = ? where id = ?").params(seconds, draftId).update();
    }

    private void record(DraftRow d, long playerId, boolean auto) {
        jdbc.sql("""
                update draft_pick set player_id = ?, is_auto = ?, picked_at = ? where draft_id = ? and pick_no = ?
                """).params(playerId, auto, Timestamp.from(clock.now()), d.id(), d.currentPickNo()).update();
        // 被選走的從每一隊的候選清單移除
        jdbc.sql("delete from draft_queue where draft_id = ? and player_id = ?").params(d.id(), playerId).update();
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

    /** 可選球員：一軍登錄、尚未被選、也不是任何一隊的 keeper。 */
    List<Long> available(DraftRow d) {
        return new ArrayList<>(jdbc.sql("""
                select id from player where registration_status = 'REGISTERED' and first_team_status = 'ACTIVE'
                  and id not in (select player_id from draft_pick where draft_id = ? and player_id is not null)
                  and id not in (select player_id from keeper_selection where draft_id = ?)
                """).params(d.id(), d.id()).query(Long.class).list());
    }

    /** 這隊已確定的球員：keeper（不佔輪次）＋已選的人。 */
    List<Long> teamPlayers(DraftRow d, long teamId) {
        List<Long> out = new ArrayList<>(jdbc.sql("select player_id from keeper_selection where draft_id = ? and team_id = ?")
                .params(d.id(), teamId).query(Long.class).list());
        out.addAll(jdbc.sql("""
                select player_id from draft_pick where draft_id = ? and team_id = ? and player_id is not null order by pick_no
                """).params(d.id(), teamId).query(Long.class).list());
        return out;
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
        int kept = jdbc.sql("select count(*) from keeper_selection where draft_id = ? and player_id = ?").params(d.id(), playerId)
                .query(Integer.class).single();
        if (kept > 0) {
            return "該球員是 keeper";
        }
        // keeper 也算進洋將上限與先發缺位，但不佔輪次
        List<Long> mine = teamPlayers(d, teamId);
        mine.add(playerId);
        int foreign = jdbc.sql("select count(*) from player where id in (:ids) and is_foreign").param("ids", mine)
                .query(Integer.class).single();
        if (foreign > league.foreignPlayerLimit()) {
            return "洋將已達上限（" + league.foreignPlayerLimit() + " 人）";
        }
        // 補強選秀（非蛇形）不要求用剩下的輪次補滿先發：空位選秀後從自由球員補（E14）
        if (!d.snake()) {
            return null;
        }
        int totalPicks = jdbc.sql("select count(*) from draft_pick where draft_id = ? and team_id = ?").params(d.id(), teamId)
                .query(Integer.class).single();
        int picked = jdbc.sql("select count(*) from draft_pick where draft_id = ? and team_id = ? and player_id is not null")
                .params(d.id(), teamId).query(Integer.class).single();
        int remaining = totalPicks - picked - 1;
        LocalDate date = eligibilityDate(d);
        Map<Long, Set<Slot>> el = eligibility.eligibility(league, mine, date);
        List<SlotAssigner.Candidate> cands = mine.stream().map(id -> new SlotAssigner.Candidate(id, el.get(id))).toList();
        int unfilled = SlotAssigner.unfilled(cands, league.slotCounts());
        if (unfilled > remaining) {
            return "選擇此球員後將無法補滿先發位置（尚缺 " + unfilled + " 個、剩 " + remaining + " 輪）";
        }
        return null;
    }

    LocalDate eligibilityDate(DraftRow d) {
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
            // 名單 = keeper（不佔輪次）＋ 選秀；空位選秀後從自由球員補
            List<long[]> picks = jdbc.sql("""
                    select x.player_id, case when p.first_team_status = 'MINORS' then 1 else 0 end, x.keeper
                    from (select player_id, 0 as ord, true as keeper from keeper_selection where draft_id = :d and team_id = :t
                          union all
                          select player_id, pick_no, false from draft_pick where draft_id = :d and team_id = :t and player_id is not null) x
                    join player p on p.id = x.player_id
                    order by x.ord
                    """).param("d", d.id()).param("t", t)
                    .query((rs, n) -> new long[]{rs.getLong(1), rs.getLong(2), rs.getBoolean(3) ? 1 : 0}).list();
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
                roster.addInternal(t, p[0], slot, eff, p[2] == 1 ? "KEEPER" : "DRAFT", 0);
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
                           String playerTeam, boolean keeper, boolean auto, String playerPosition, String playerJersey) {
    }

    /** 一隊公開的 keeper（揭曉後才有）。 */
    public record TeamKeepers(long teamId, List<KeeperView> players) {
    }

    /**
     * @param order          順位；揭曉前為空（保密）
     * @param scheduledAt    選秀時間；沒有設定為 null
     * @param keeperDeadline keeper 截止（選秀前 10 分鐘）
     * @param revealedAt     順位揭曉時間，各裝置依此同步播放揭曉動畫
     * @param snake          蛇形（上半季）；補強選秀每輪同一順序
     * @param myKeepers      自己的 keeper（任何時候都看得到）
     * @param keepers        各隊 keeper，揭曉後才公開
     * @param autopilotTeams 開啟託管的隊伍（E18）
     * @param phase          流程階段：PREPARING 準備中（排候選、選 keeper，等管理員按開始）、REVEALED 已揭曉（動畫播完
     *                       自動開始）、IN_PROGRESS、PAUSED、COMPLETED。選秀時間（scheduledAt）已不使用，永遠是 null
     */
    public record DraftView(long id, int halfNo, String status, int rounds, int pickSeconds, int currentPickNo,
                            Long currentTeamId, OffsetDateTime deadline, long secondsLeft, List<Long> order,
                            List<PickView> picks, List<KeeperView> myKeepers, OffsetDateTime scheduledAt,
                            OffsetDateTime keeperDeadline, OffsetDateTime revealedAt, boolean snake, List<TeamKeepers> keepers,
                            List<Long> autopilotTeams, String phase) {
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
        boolean revealed = d.revealedAt() != null;
        List<Long> order = !revealed ? List.of() : jdbc.sql("select team_id from draft_slot where draft_id = ? order by draft_position")
                .param(draftId).query(Long.class).list();
        List<PickView> picks = jdbc.sql("""
                select dp.pick_no, dp.round, dp.team_id, t.name, dp.player_id, p.name, p.cpbl_team_code, dp.is_keeper, dp.is_auto,
                       p.listed_position, p.jersey_number
                from draft_pick dp join fantasy_team t on t.id = dp.team_id left join player p on p.id = dp.player_id
                where dp.draft_id = ? order by dp.pick_no
                """).param(draftId).query((rs, n) -> {
            return new PickView(rs.getInt(1), rs.getInt(2), rs.getLong(3), rs.getString(4), rs.getObject(5, Long.class),
                    rs.getString(6), rs.getString(7), rs.getBoolean(8), rs.getBoolean(9), rs.getString(10), rs.getString(11));
        }).list();
        boolean paused = "PAUSED".equals(d.status());
        Long current = "IN_PROGRESS".equals(d.status()) || paused ? currentTeam(d) : null;
        // 暫停中倒數停住：顯示暫停時剩下的秒數
        Integer pausedMs = paused ? jdbc.sql("select paused_remaining_ms from draft where id = ?").param(draftId)
                .query(Integer.class).single() : null;
        long secondsLeft = paused ? (pausedMs == null ? d.pickSeconds() : (pausedMs + 999) / 1000)
                : d.deadline() == null ? 0 : Math.max(0, Duration.between(clock.now(), d.deadline()).toSeconds());
        List<KeeperView> mine = viewerTeamId == null ? List.of() : jdbc.sql("""
                select k.player_id, p.name from keeper_selection k join player p on p.id = k.player_id
                where k.draft_id = ? and k.team_id = ? order by p.name
                """).params(draftId, viewerTeamId).query((rs, n) -> new KeeperView(rs.getLong(1), rs.getString(2))).list();
        // 各隊 keeper 只在揭曉後公開
        List<TeamKeepers> all = new ArrayList<>();
        if (revealed) {
            Map<Long, List<KeeperView>> byTeam = new java.util.LinkedHashMap<>();
            order.forEach(t -> byTeam.put(t, new ArrayList<>()));
            jdbc.sql("""
                    select k.team_id, k.player_id, p.name from keeper_selection k join player p on p.id = k.player_id
                    where k.draft_id = ? order by p.name
                    """).param(draftId).query(rs -> {
                byTeam.computeIfAbsent(rs.getLong(1), x -> new ArrayList<>()).add(new KeeperView(rs.getLong(2), rs.getString(3)));
            });
            byTeam.forEach((t, ks) -> all.add(new TeamKeepers(t, ks)));
        }
        List<Long> autopilot = jdbc.sql("select id from fantasy_team where league_id = ? and draft_autopilot order by id")
                .param(d.leagueId()).query(Long.class).list();
        return new DraftView(d.id(), d.halfNo(), d.status(), d.rounds(), d.pickSeconds(), d.currentPickNo(), current,
                paused ? null : odt(d.deadline()), secondsLeft, order, picks, mine, odt(d.scheduledAt()), odt(d.keeperDeadline()),
                odt(d.revealedAt()), d.snake(), all, autopilot, phase(d));
    }

    /** 流程階段（見 DraftView）：已開始後看狀態，開始前看管理員是否已按開始（已揭曉）。 */
    private String phase(DraftRow d) {
        return switch (d.status()) {
            case "IN_PROGRESS", "PAUSED", "COMPLETED" -> d.status();
            default -> d.revealedAt() != null ? "REVEALED" : "PREPARING";
        };
    }

    private OffsetDateTime odt(Instant i) {
        return i == null ? null : i.atZone(clock.zone()).toOffsetDateTime();
    }

    public Long leagueOf(long draftId) {
        return draft(draftId).leagueId();
    }
}
