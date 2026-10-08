package tw.cpblf.live;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import tw.cpblf.config.AppClock;
import tw.cpblf.config.AppProperties;
import tw.cpblf.live.LiveService.LiveGame;
import tw.cpblf.live.LiveService.LiveLine;

/**
 * 季後賽專區（設計稿「台灣大賽專區」）：季後挑戰賽、台灣大賽的系列戰比分與每場數據。
 *
 * <p>季後賽只做觀賽，不結算、不計入 fantasy（docs/decisions.md「賽季結構」）；數據取自即時快照
 * （live_game_stat），比賽結束後仍保留。排行與最佳球員由前端用 {@code lines} 計算。
 */
@Service
public class PostseasonService {

    public static final String NOTICE = "季後賽不計入 fantasy 計分，這裡的數據只供觀賽；即時數據每 60 秒更新，非最終數據。";

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final AppProperties props;
    private final LiveService live;

    public PostseasonService(JdbcClient jdbc, AppClock clock, AppProperties props, LiveService live) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.props = props;
        this.live = live;
    }

    /**
     * 一個系列戰。
     *
     * @param teams         兩隊代碼，依第一場的客隊、主隊排列
     * @param wins          各隊已拿的勝場（含保送的 1 勝）
     * @param advantageTeam 保送 1 勝的球隊；沒有時為 null
     * @param winner        已先拿到 winsNeeded 勝的球隊；系列戰還沒結束時為 null
     * @param games         這個系列的所有比賽，依開賽時間排序
     * @param lines         這個系列各場的球員數據（即時快照）；fantasyTeamId 依今天的名單
     */
    public record SeriesView(String kind, String name, int winsNeeded, String advantageTeam, List<String> teams,
                             Map<String, Integer> wins, String winner, List<LiveGame> games, List<LiveLine> lines) {
    }

    public record PostseasonView(String notice, LocalDate today, Long myTeamId, List<SeriesView> series) {
    }

    public PostseasonView view(long leagueId, long userId) {
        LocalDate today = clock.today();
        Long myTeam = jdbc.sql("select id from fantasy_team where league_id = ? and user_id = ?").params(leagueId, userId)
                .query(Long.class).optional().orElse(null);
        // trackedKindCodes 第一個是例行賽，其餘才是季後賽
        List<String> kinds = props.trackedKindCodes().stream().filter(k -> !k.equals(props.kindCode())).toList();
        if (kinds.isEmpty()) {
            return new PostseasonView(NOTICE, today, myTeam, List.of());
        }
        String where = "g.season_year = :year and g.kind_code in (:kinds)";
        Map<String, Object> params = Map.of("year", props.seasonYear(), "kinds", kinds);
        List<LiveGame> games = live.games(where, params);
        List<LiveLine> lines = live.lines(leagueId, where, params, today);

        Map<String, List<LiveGame>> byKind = new LinkedHashMap<>();
        for (String kind : kinds) {
            List<LiveGame> g = games.stream().filter(x -> x.kindCode().equals(kind)).toList();
            if (!g.isEmpty()) byKind.put(kind, g);
        }
        List<SeriesView> series = new ArrayList<>();
        byKind.forEach((kind, g) -> {
            Set<Long> ids = new LinkedHashSet<>();
            g.forEach(x -> ids.add(x.id()));
            series.add(series(kind, g, lines.stream().filter(l -> ids.contains(l.gameId())).toList()));
        });
        series.sort(Comparator.comparing(s -> s.games().get(0).scheduledDate()));
        return new PostseasonView(NOTICE, today, myTeam, series);
    }

    SeriesView series(String kind, List<LiveGame> games, List<LiveLine> lines) {
        AppProperties.Series format = props.series(kind);
        LiveGame first = games.get(0);
        List<String> teams = List.of(first.awayTeam(), first.homeTeam());
        Map<String, Integer> wins = new LinkedHashMap<>();
        teams.forEach(t -> wins.put(t, 0));
        if (format.advantageTeam() != null && wins.containsKey(format.advantageTeam())) {
            wins.merge(format.advantageTeam(), 1, Integer::sum);
        }
        for (LiveGame g : games) {
            // 平手（和局）不算勝場；比分只在結束後才算數
            if (!"FINAL".equals(g.status()) || g.homeScore() == null || g.awayScore() == null) continue;
            int c = Integer.compare(g.homeScore(), g.awayScore());
            if (c != 0) wins.merge(c > 0 ? g.homeTeam() : g.awayTeam(), 1, Integer::sum);
        }
        String winner = wins.entrySet().stream().filter(e -> e.getValue() >= format.winsNeeded()).map(Map.Entry::getKey)
                .findFirst().orElse(null);
        return new SeriesView(kind, format.name(), format.winsNeeded(), format.advantageTeam(), teams, wins, winner, games,
                lines);
    }
}
