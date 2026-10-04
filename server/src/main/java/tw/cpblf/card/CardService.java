package tw.cpblf.card;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import tw.cpblf.api.PlayerViews;
import tw.cpblf.common.ApiException;
import tw.cpblf.config.AppClock;
import tw.cpblf.draft.PlayerRankingService;
import tw.cpblf.league.League;
import tw.cpblf.roster.Slot;
import tw.cpblf.scoring.Category;
import tw.cpblf.scoring.ScoringService;
import tw.cpblf.scoring.StatTotals;

/**
 * 收藏卡資料（球員卡規範 1a、1b）：卡面數據、卡片履歷與成就印章。
 *
 * <p>履歷與印章都是本聯盟、本季的紀錄，所以同一位球員在不同聯盟會有不同的故事。純展示，不影響計分。
 */
@Service
public class CardService {

    /** 卡背履歷最多幾筆（卡面空間）。 */
    static final int MAX_HIST = 4;

    public record Stat(String k, String v) {
    }

    /** tone：team（取得或轉隊，teamId 給前端上隊伍色）、gold（MVP、高光、升級）、muted（釋出）。 */
    public record Hist(LocalDate date, String label, String tone, Long teamId) {
    }

    /** date 為首次達成日；未達成為 null。 */
    public record Stamp(String label, LocalDate date) {
    }

    public record Card(long playerId, String name, String jerseyNumber, String cpblTeam, String pos, boolean pitcher,
                       Integer rank, int totalRanked, long seed, String line, List<Stat> stats, List<Hist> hist,
                       List<Stamp> stamps) {
    }

    /** 單場數據（印章、高光用）。 */
    record GameLine(LocalDate date, int h, int hr, int bb, boolean pitched, boolean started, int outs, int er, int k) {
        boolean qs() {
            return pitched && outs >= 18 && er <= 3;
        }
    }

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final PlayerViews views;
    private final PlayerRankingService ranking;
    private final ScoringService scoring;
    private final WeeklyMvpService mvp;

    public CardService(JdbcClient jdbc, AppClock clock, PlayerViews views, PlayerRankingService ranking, ScoringService scoring,
                       WeeklyMvpService mvp) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.views = views;
        this.ranking = ranking;
        this.scoring = scoring;
        this.mvp = mvp;
    }

    public Card card(League league, long playerId) {
        PlayerViews.Basic b = views.basics(List.of(playerId)).get(playerId);
        if (b == null) {
            throw ApiException.notFound("球員不存在");
        }
        boolean pitcher = "P".equals(b.listedPosition());
        Set<Slot> elig = views.eligibility(league, List.of(playerId)).getOrDefault(playerId, Set.of());
        List<String> shown = views.sortedSlots(elig).stream().filter(s -> !s.equals("UTIL") && !s.equals("BN") && !s.equals("NA")).toList();
        String pos = shown.isEmpty() ? b.listedPosition() : String.join("/", shown);

        var ranks = ranking.rankings();
        var r = ranks.get(playerId);
        LocalDate today = clock.today();
        StatTotals t = scoring.playerTotals(playerId, LocalDate.of(league.seasonYear(), 1, 1), today);
        List<Stat> stats;
        String line;
        if (pitcher) {
            stats = List.of(stat(t, Category.ERA), stat(t, Category.WHIP), stat(t, Category.K), stat(t, Category.QS), stat(t, Category.WSV));
            boolean reliever = elig.contains(Slot.RP) && !elig.contains(Slot.SP);
            line = t.display(Category.ERA) + " ERA · " + (reliever ? t.display(Category.WSV) + " W+SV" : t.display(Category.K) + " K");
        } else {
            stats = List.of(stat(t, Category.AVG), stat(t, Category.HR), stat(t, Category.H), stat(t, Category.BB), stat(t, Category.R));
            line = t.display(Category.AVG) + " · " + t.display(Category.HR) + " HR";
        }

        List<GameLine> games = games(league, playerId);
        List<WeeklyMvpService.Mvp> mvps = mvp.forPlayer(league.id(), playerId).stream()
                .filter(m -> m.kind().equals(pitcher ? "P" : "H")).toList();
        return new Card(playerId, b.name(), b.jerseyNumber(), b.team(), pos, pitcher, r == null ? null : r.rank(), ranks.size(),
                playerId, line, stats, hist(league, playerId, games, mvps, pitcher), stamps(games, mvps, pitcher));
    }

    private static Stat stat(StatTotals t, Category c) {
        return new Stat(c.label, t.display(c));
    }

    List<GameLine> games(League league, long playerId) {
        return jdbc.sql("""
                select g.play_date, gs.h, gs.hr, gs.bb, gs.pitched, gs.started, gs.outs, gs.p_er, gs.p_k
                from game_stat gs join game g on g.id = gs.game_id
                where gs.player_id = ? and g.status = 'FINAL' and g.season_year = ?
                order by g.play_date, g.game_sno
                """).params(playerId, league.seasonYear())
                .query((rs, i) -> new GameLine(rs.getObject(1, LocalDate.class), rs.getInt(2), rs.getInt(3), rs.getInt(4),
                        rs.getBoolean(5), rs.getBoolean(6), rs.getInt(7), rs.getInt(8), rs.getInt(9)))
                .list();
    }

    // ------------------------------------------------------------------
    // 成就印章
    // ------------------------------------------------------------------

    /**
     * 打者：猛打賞（單場 3 安）、雙響砲（單場 2 轟）、選球眼（單場 3 保送）、週 MVP。
     * 投手：雙十K（單場 10 K）、QS×5（第 5 次 QS）、七局無失分（單場 ≥ 7 局且 0 責失分）、週 MVP。
     */
    static List<Stamp> stamps(List<GameLine> games, List<WeeklyMvpService.Mvp> mvps, boolean pitcher) {
        LocalDate mvpDate = mvps.isEmpty() ? null : mvps.get(0).weekStart().plusDays(6);
        if (pitcher) {
            LocalDate fifthQs = null;
            int qs = 0;
            for (GameLine g : games) {
                if (g.qs() && ++qs == 5) {
                    fifthQs = g.date();
                }
            }
            return List.of(
                    new Stamp("雙十K", first(games, g -> g.pitched() && g.k() >= 10)),
                    new Stamp("QS×5", fifthQs),
                    new Stamp("七局無失分", first(games, g -> g.pitched() && g.outs() >= 21 && g.er() == 0)),
                    new Stamp("週MVP", mvpDate));
        }
        return List.of(
                new Stamp("猛打賞", first(games, g -> g.h() >= 3)),
                new Stamp("雙響砲", first(games, g -> g.hr() >= 2)),
                new Stamp("選球眼", first(games, g -> g.bb() >= 3)),
                new Stamp("週MVP", mvpDate));
    }

    private static LocalDate first(List<GameLine> games, java.util.function.Predicate<GameLine> p) {
        return games.stream().filter(p).map(GameLine::date).findFirst().orElse(null);
    }

    // ------------------------------------------------------------------
    // 卡片履歷
    // ------------------------------------------------------------------

    record Entry(long teamId, String teamName, LocalDate from, LocalDate to, String via) {
    }

    List<Hist> hist(League league, long playerId, List<GameLine> games, List<WeeklyMvpService.Mvp> mvps, boolean pitcher) {
        List<Hist> events = new ArrayList<>(rosterEvents(league, playerId));
        for (WeeklyMvpService.Mvp m : mvps) {
            events.add(new Hist(m.weekStart().plusDays(6), "第 " + m.weekNo() + " 週" + (pitcher ? "投手" : "打者") + " MVP", "gold", null));
        }
        Hist best = highlight(games, pitcher);
        if (best != null) {
            events.add(best);
        }
        events.sort(Comparator.comparing(Hist::date));
        return trim(events);
    }

    /** 最多 MAX_HIST 筆：保留最早一筆（通常是怎麼來的），其餘取最近的，依時間排序。 */
    static List<Hist> trim(List<Hist> sorted) {
        if (sorted.size() <= MAX_HIST) {
            return sorted;
        }
        List<Hist> out = new ArrayList<>();
        out.add(sorted.get(0));
        out.addAll(sorted.subList(sorted.size() - (MAX_HIST - 1), sorted.size()));
        return out;
    }

    /** 取得、轉隊與釋出。同隊的位置異動（MOVE）合併為一段。 */
    List<Hist> rosterEvents(League league, long playerId) {
        List<Entry> entries = jdbc.sql("""
                select re.team_id, t.name, re.valid_from, re.valid_to, re.acquired_via
                from roster_entry re join fantasy_team t on t.id = re.team_id
                where t.league_id = ? and re.player_id = ?
                order by re.valid_from, re.id
                """).params(league.id(), playerId)
                .query((rs, i) -> new Entry(rs.getLong(1), rs.getString(2), rs.getObject(3, LocalDate.class),
                        rs.getObject(4, LocalDate.class), rs.getString(5)))
                .list();
        // 合併成「在某隊的一段期間」
        List<Entry> stints = new ArrayList<>();
        for (Entry e : entries) {
            Entry last = stints.isEmpty() ? null : stints.get(stints.size() - 1);
            if (last != null && last.teamId() == e.teamId() && e.from().equals(last.to())) {
                stints.set(stints.size() - 1, new Entry(last.teamId(), last.teamName(), last.from(), e.to(), last.via()));
            } else {
                stints.add(e);
            }
        }
        Map<Long, String> picks = draftPicks(league, playerId);
        List<Hist> out = new ArrayList<>();
        for (int i = 0; i < stints.size(); i++) {
            Entry s = stints.get(i);
            String label = switch (s.via()) {
                case "DRAFT" -> picks.containsKey(s.teamId())
                        ? "選秀 " + picks.get(s.teamId()) + " · " + s.teamName() : "選秀 · " + s.teamName();
                case "KEEPER" -> "Keeper · " + s.teamName();
                case "WAIVER" -> "Waiver → " + s.teamName();
                case "FA" -> "自由球員 → " + s.teamName();
                case "TRADE" -> "交易 → " + s.teamName();
                default -> "加入 " + s.teamName();
            };
            out.add(new Hist(s.from(), label, "team", s.teamId()));
            boolean tradedAway = i + 1 < stints.size() && "TRADE".equals(stints.get(i + 1).via())
                    && stints.get(i + 1).from().equals(s.to());
            if (s.to() != null && !tradedAway) {
                out.add(new Hist(s.to(), "釋出 → 自由球員", "muted", null));
            }
        }
        return out;
    }

    /** 本聯盟選秀的「輪.順位」，例：第 3 輪第 3 順位 → 3.03。 */
    Map<Long, String> draftPicks(League league, long playerId) {
        int teams = jdbc.sql("select count(*) from fantasy_team where league_id = ?").param(league.id()).query(Integer.class).single();
        Map<Long, String> out = new HashMap<>();
        jdbc.sql("""
                select dp.team_id, dp.round, dp.pick_no from draft_pick dp join draft d on d.id = dp.draft_id
                where d.league_id = ? and dp.player_id = ? order by dp.picked_at
                """).params(league.id(), playerId)
                .query((rs, i) -> {
                    int inRound = teams == 0 ? rs.getInt(3) : (rs.getInt(3) - 1) % teams + 1;
                    out.put(rs.getLong(1), rs.getInt(2) + "." + String.format("%02d", inRound));
                    return null;
                }).list();
        return out;
    }

    /** 本季最佳單場（只取一筆）。 */
    static Hist highlight(List<GameLine> games, boolean pitcher) {
        GameLine best = null;
        String label = null;
        int bestScore = 0;
        for (GameLine g : games) {
            int score;
            String l;
            if (pitcher) {
                if (!g.pitched()) continue;
                if (g.k() >= 10) { score = 100 + g.k(); l = "單場 " + g.k() + " K"; }
                else if (g.outs() >= 21 && g.er() == 0) { score = 90 + g.outs(); l = (g.outs() / 3) + " 局無失分"; }
                else continue;
            } else {
                if (g.hr() >= 2) { score = 100 + g.hr() * 10 + g.h(); l = "單場 " + g.hr() + " 轟"; }
                else if (g.h() >= 4) { score = 80 + g.h(); l = "單場 " + g.h() + " 安"; }
                else continue;
            }
            if (score > bestScore) {
                bestScore = score;
                best = g;
                label = l;
            }
        }
        return best == null ? null : new Hist(best.date(), label, "gold", null);
    }
}
