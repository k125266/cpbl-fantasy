package tw.cpblf.scoring;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * 對戰勝負判定（規則書 5.5）。純函式，無資料庫相依。
 *
 * <ul>
 *   <li>每個類別 1 分，數值相同各得 0.5 分</li>
 *   <li>任一方該類別無數據（分母為零）：不判任何一方為敗，雙方各得 0.5 分</li>
 *   <li>總分 5:5 為和局</li>
 * </ul>
 */
public final class MatchupScorer {

    private MatchupScorer() {
    }

    public enum Outcome { A, B, TIE, NO_DATA }

    public record CategoryResult(String category, String label, String a, String b, Outcome winner) {
    }

    public enum Result { A_WIN, B_WIN, TIE }

    public record Score(List<CategoryResult> categories, BigDecimal scoreA, BigDecimal scoreB, Result result) {
    }

    private static final BigDecimal ONE = BigDecimal.ONE;
    private static final BigDecimal HALF = new BigDecimal("0.5");

    public static Score score(StatTotals a, StatTotals b) {
        List<CategoryResult> cats = new ArrayList<>();
        BigDecimal sa = BigDecimal.ZERO.setScale(1);
        BigDecimal sb = BigDecimal.ZERO.setScale(1);
        for (Category c : Category.values()) {
            Outcome o;
            if (!a.hasData(c) || !b.hasData(c)) {
                o = Outcome.NO_DATA;
            } else {
                int cmp = a.compare(c, b);
                o = cmp > 0 ? Outcome.A : cmp < 0 ? Outcome.B : Outcome.TIE;
            }
            switch (o) {
                case A -> sa = sa.add(ONE);
                case B -> sb = sb.add(ONE);
                default -> {
                    sa = sa.add(HALF);
                    sb = sb.add(HALF);
                }
            }
            cats.add(new CategoryResult(c.label, c.zhLabel, a.display(c), b.display(c), o));
        }
        int cmp = sa.compareTo(sb);
        Result r = cmp > 0 ? Result.A_WIN : cmp < 0 ? Result.B_WIN : Result.TIE;
        return new Score(cats, sa, sb, r);
    }
}
