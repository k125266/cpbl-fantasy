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
    private final tw.cpblf.config.AppClock clock;

    public PlayerRankingService(JdbcClient jdbc, AppProperties props, tw.cpblf.config.AppClock clock) {
        this.jdbc = jdbc;
        this.props = props;
        this.clock = clock;
    }

    /**
     * 一位球員的累計數據。打者：gBat 出賽、pa、ab、h、r、hr、bb；投手：gPit 出賽、gs 先發、outs、er、ph 被安打、pbb 四壞、
     * k、w、sv、qs。官網沒有打點、盜壘、中繼。
     */
    public record Line(long id, String name, String listed, long gBat, long pa, long ab, long h, long r, long hr, long bb,
                long gPit, long gs, long outs, long er, long ph, long pbb, long k, long w, long sv, long qs) {

        /** 計分類別 W+SV */
        public long wsv() {
            return w + sv;
        }
    }

    /** 選秀室的數據期間：上一季全季（參考季）、本季、近 14 天。 */
    public enum Period { REF, SEASON, LAST14 }

    /** 某段期間每位球員的數據（只算例行賽；季後賽不結算，見 docs/decisions.md「賽季結構」）。 */
    public Map<Long, Line> lines(Period p) {
        List<Line> ls = switch (p) {
            case REF -> referenceLines(props.seasonYear() - 1);
            case SEASON -> currentLines(null);
            case LAST14 -> currentLines(clock.today().minusDays(13));
        };
        Map<Long, Line> byId = new HashMap<>();
        ls.forEach(l -> byId.put(l.id(), l));
        return byId;
    }

    /** 這段期間有沒有數據：參考季要有封存，本季要有已結算的比賽，近 14 天要有這期間的比賽。 */
    public boolean available(Period p) {
        return switch (p) {
            case REF -> jdbc.sql("select count(*) from reference_stat where season_year = ?").param(props.seasonYear() - 1)
                    .query(Integer.class).single() > 0;
            case SEASON -> playedSince(null);
            case LAST14 -> playedSince(clock.today().minusDays(13));
        };
    }

    private boolean playedSince(java.time.LocalDate from) {
        return jdbc.sql("""
                select count(*) from game_stat gs join game g on g.id = gs.game_id
                where g.season_year = ? and g.kind_code = ? and g.status = 'FINAL' and (cast(? as date) is null or g.play_date >= ?)
                """).params(props.seasonYear(), props.kindCode(), from, from).query(Integer.class).single() > 0;
    }

    public record Ranked(long playerId, double score, int rank) {
    }

    /** 季中排名：只用當季數據（規則書 6.5）。 */
    public Map<Long, Ranked> rankings() {
        return rank(currentLines(null));
    }

    /**
     * 選秀用的排名與數據來源：上半季選秀用參考季（上一季，有封存時），下半季用當季。
     * 只用於選秀室（排名、數據欄、推薦、自動選、成績單），不影響計分（docs/rulebook-amendments.md「6.5 選秀參考數據」）。
     */
    public record DraftBasis(String label, Map<Long, Line> lines, Map<Long, Ranked> ranks) {
    }

    public DraftBasis draftBasis(int halfNo) {
        int refYear = props.seasonYear() - 1;
        boolean reference = halfNo == 1 && jdbc.sql("select count(*) from reference_stat where season_year = ?")
                .param(refYear).query(Integer.class).single() > 0;
        List<Line> lines = reference ? referenceLines(refYear) : currentLines(null);
        Map<Long, Line> byId = new HashMap<>();
        lines.forEach(l -> byId.put(l.id(), l));
        return new DraftBasis(reference ? String.valueOf(refYear) : "本季", byId, rank(lines));
    }

    /** 本季例行賽已結算的數據；from 不為 null 時只算這天起的比賽（近 14 天）。 */
    private List<Line> currentLines(java.time.LocalDate from) {
        return jdbc.sql("""
                select p.id, p.name, p.listed_position,
                       count(gs.game_id) filter (where gs.batted), coalesce(sum(gs.pa),0),
                       coalesce(sum(gs.ab),0), coalesce(sum(gs.h),0), coalesce(sum(gs.r),0), coalesce(sum(gs.hr),0),
                       coalesce(sum(gs.bb),0),
                       count(gs.game_id) filter (where gs.pitched), count(gs.game_id) filter (where gs.started),
                       coalesce(sum(gs.outs),0), coalesce(sum(gs.p_er),0),
                       coalesce(sum(gs.p_h),0), coalesce(sum(gs.p_bb),0), coalesce(sum(gs.p_k),0),
                       coalesce(sum(gs.w),0), coalesce(sum(gs.sv),0),
                       coalesce(sum(case when gs.started and gs.outs >= 18 and gs.p_er <= 3 then 1 else 0 end),0)
                from player p
                left join game_stat gs on gs.player_id = p.id
                     and gs.game_id in (select id from game where season_year = ? and kind_code = ? and status = 'FINAL'
                                        and (cast(? as date) is null or play_date >= ?))
                group by p.id, p.name, p.listed_position
                """).params(props.seasonYear(), props.kindCode(), from, from).query(PlayerRankingService::line).list();
    }

    private List<Line> referenceLines(int year) {
        return jdbc.sql("""
                select p.id, p.name, p.listed_position,
                       coalesce(rs.g_bat,0), coalesce(rs.pa,0),
                       coalesce(rs.ab,0), coalesce(rs.h,0), coalesce(rs.r,0), coalesce(rs.hr,0), coalesce(rs.bb,0),
                       coalesce(rs.g_pit,0), coalesce(rs.gs,0),
                       coalesce(rs.outs,0), coalesce(rs.p_er,0), coalesce(rs.p_h,0), coalesce(rs.p_bb,0), coalesce(rs.p_k,0),
                       coalesce(rs.w,0), coalesce(rs.sv,0), coalesce(rs.qs,0)
                from player p left join reference_stat rs on rs.player_id = p.id and rs.season_year = ?
                """).param(year).query(PlayerRankingService::line).list();
    }

    private static Line line(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        return new Line(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getLong(5),
                rs.getLong(6), rs.getLong(7), rs.getLong(8), rs.getLong(9), rs.getLong(10), rs.getLong(11),
                rs.getLong(12), rs.getLong(13), rs.getLong(14), rs.getLong(15), rs.getLong(16), rs.getLong(17),
                rs.getLong(18), rs.getLong(19), rs.getLong(20));
    }

    /** 十個類別各自轉為 z-score 後加總；沒有數據的球員排在後面，依姓名。 */
    private Map<Long, Ranked> rank(List<Line> lines) {
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
        // 有數據的排前面（沒上場的不會排在表現差但有上場的人前面），再依分數、姓名
        sorted.sort(Comparator.comparing((Line l) -> score.containsKey(l.id()) ? 0 : 1)
                .thenComparingDouble(l -> -score.getOrDefault(l.id(), 0.0))
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
