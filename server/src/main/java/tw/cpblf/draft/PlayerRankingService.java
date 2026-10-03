package tw.cpblf.draft;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.ToDoubleFunction;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import tw.cpblf.config.AppProperties;

/**
 * 球員排名（選秀自動選取、FA 頁排序用）。
 *
 * <p>規則書 6.5：2026 起壘包加大、投球計時等改動預期顯著提升盜壘產量，因此排名只採用當季資料，
 * 不沿用 2025 年以前的數據。季初尚無數據時，所有球員分數為 0，依姓名排序。
 *
 * <p>計算：十個類別各自轉為 z-score 後加總。比率類別以「相對聯盟平均的貢獻量」計算（例如 AVG 用 H − lgAVG × AB），
 * 讓打數少的球員不會因為小樣本而虛高。
 */
@Service
public class PlayerRankingService {

    private final JdbcClient jdbc;
    private final AppProperties props;

    public PlayerRankingService(JdbcClient jdbc, AppProperties props) {
        this.jdbc = jdbc;
        this.props = props;
    }

    record Line(long id, String name, String listed, long ab, long h, long r, long hr, long bb, long outs, long er,
                long ph, long pbb, long k, long wsv, long qs) {
    }

    public record Ranked(long playerId, double score, int rank) {
    }

    public Map<Long, Ranked> rankings() {
        List<Line> lines = jdbc.sql("""
                select p.id, p.name, p.listed_position,
                       coalesce(sum(gs.ab),0), coalesce(sum(gs.h),0), coalesce(sum(gs.r),0), coalesce(sum(gs.hr),0),
                       coalesce(sum(gs.bb),0), coalesce(sum(gs.outs),0), coalesce(sum(gs.p_er),0),
                       coalesce(sum(gs.p_h),0), coalesce(sum(gs.p_bb),0), coalesce(sum(gs.p_k),0),
                       coalesce(sum(gs.w + gs.sv),0),
                       coalesce(sum(case when gs.outs >= 18 and gs.p_er <= 3 then 1 else 0 end),0)
                from player p
                left join game_stat gs on gs.player_id = p.id
                     and gs.game_id in (select id from game where season_year = ? and status = 'FINAL')
                group by p.id, p.name, p.listed_position
                """).param(props.seasonYear())
                .query((rs, n) -> new Line(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getLong(5),
                        rs.getLong(6), rs.getLong(7), rs.getLong(8), rs.getLong(9), rs.getLong(10), rs.getLong(11),
                        rs.getLong(12), rs.getLong(13), rs.getLong(14), rs.getLong(15)))
                .list();

        List<Line> hitters = lines.stream().filter(l -> l.ab() > 0).toList();
        List<Line> pitchers = lines.stream().filter(l -> l.outs() > 0).toList();
        double lgAvg = ratio(hitters, Line::h, Line::ab);
        double lgEraPerOut = ratio(pitchers, Line::er, Line::outs);
        double lgWhipPerOut = ratio(pitchers, l -> l.ph() + l.pbb(), Line::outs);

        Map<Long, Double> score = new HashMap<>();
        addZ(score, hitters, l -> l.r());
        addZ(score, hitters, l -> l.hr());
        addZ(score, hitters, l -> l.h());
        addZ(score, hitters, l -> l.bb());
        addZ(score, hitters, l -> l.h() - lgAvg * l.ab());
        addZ(score, pitchers, l -> l.qs());
        addZ(score, pitchers, l -> l.k());
        addZ(score, pitchers, l -> l.wsv());
        addZ(score, pitchers, l -> lgEraPerOut * l.outs() - l.er());
        addZ(score, pitchers, l -> lgWhipPerOut * l.outs() - (l.ph() + l.pbb()));

        List<Line> sorted = new ArrayList<>(lines);
        sorted.sort(Comparator.comparingDouble((Line l) -> -score.getOrDefault(l.id(), 0.0))
                .thenComparing(l -> score.containsKey(l.id()) ? 0 : 1)
                .thenComparing(Line::name));
        Map<Long, Ranked> out = new HashMap<>();
        for (int i = 0; i < sorted.size(); i++) {
            Line l = sorted.get(i);
            out.put(l.id(), new Ranked(l.id(), Math.round(score.getOrDefault(l.id(), 0.0) * 100) / 100.0, i + 1));
        }
        return out;
    }

    private static double ratio(List<Line> ls, ToDoubleFunction<Line> num, ToDoubleFunction<Line> den) {
        double n = ls.stream().mapToDouble(num).sum();
        double d = ls.stream().mapToDouble(den).sum();
        return d == 0 ? 0 : n / d;
    }

    private static void addZ(Map<Long, Double> score, List<Line> pool, ToDoubleFunction<Line> f) {
        if (pool.size() < 2) {
            return;
        }
        double mean = pool.stream().mapToDouble(f).average().orElse(0);
        double sd = Math.sqrt(pool.stream().mapToDouble(l -> Math.pow(f.applyAsDouble(l) - mean, 2)).sum() / pool.size());
        if (sd == 0) {
            return;
        }
        for (Line l : pool) {
            score.merge(l.id(), (f.applyAsDouble(l) - mean) / sd, Double::sum);
        }
    }
}
