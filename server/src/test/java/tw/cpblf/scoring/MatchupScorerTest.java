package tw.cpblf.scoring;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;

import org.junit.jupiter.api.Test;

class MatchupScorerTest {

    static StatTotals hit(long ab, long h, long r, long hr, long bb) {
        return new StatTotals(ab, h, r, hr, bb, 0, 0, 0, 0, 0, 0, 0, 0);
    }

    static StatTotals both(StatTotals bat, long outs, long er, long ph, long pbb, long k, long sv, long w, long qs) {
        return new StatTotals(bat.ab(), bat.h(), bat.r(), bat.hr(), bat.bb(), outs, er, ph, pbb, k, sv, w, qs);
    }

    @Test
    void ratiosUseSummedNumeratorsAndDenominators() {
        // 3/10 + 1/1 = 4/11 = .364，而非 (.300 + 1.000) / 2
        StatTotals t = hit(10, 3, 0, 0, 0).plus(hit(1, 1, 0, 0, 0));
        assertThat(t.value(Category.AVG)).isEqualTo(4.0 / 11);
        StatTotals p = new StatTotals(0, 0, 0, 0, 0, 19, 2, 5, 1, 0, 0, 0, 0);
        assertThat(p.value(Category.ERA)).isEqualTo(2 * 27.0 / 19);
        assertThat(p.value(Category.WHIP)).isEqualTo(6 * 3.0 / 19);
    }

    @Test
    void zeroDenominatorIsNoDataNotZero() {
        assertThat(StatTotals.ZERO.value(Category.AVG)).isNull();
        assertThat(StatTotals.ZERO.value(Category.ERA)).isNull();
        assertThat(StatTotals.ZERO.value(Category.WHIP)).isNull();
        assertThat(StatTotals.ZERO.value(Category.HR)).isEqualTo(0.0);
    }

    @Test
    void noDataIsNotALossBothGetHalf() {
        StatTotals a = hit(40, 12, 5, 1, 4);              // 沒有投手數據
        StatTotals b = both(hit(40, 10, 5, 1, 4), 54, 30, 40, 20, 30, 0, 0, 0); // 投很爛
        MatchupScorer.Score s = MatchupScorer.score(a, b);
        var era = s.categories().stream().filter(c -> c.category().equals("ERA")).findFirst().orElseThrow();
        assertThat(era.winner()).isEqualTo(MatchupScorer.Outcome.NO_DATA);
        assertThat(s.scoreA().add(s.scoreB())).isEqualByComparingTo("10");
    }

    @Test
    void equalCategoryValuesSplitPoints() {
        // AVG .250 = .250：打數不同，交叉相乘精確判定平手
        assertThat(hit(40, 10, 0, 0, 0).compare(Category.AVG, hit(20, 5, 0, 0, 0))).isZero();
        // H 也是類別，所以整場平手需要安打數相同
        StatTotals a = hit(40, 10, 5, 1, 4);
        StatTotals b = hit(40, 10, 5, 1, 4);
        MatchupScorer.Score s = MatchupScorer.score(a, b);
        assertThat(s.scoreA()).isEqualByComparingTo(new BigDecimal("5.0"));
        assertThat(s.scoreB()).isEqualByComparingTo(new BigDecimal("5.0"));
        assertThat(s.result()).isEqualTo(MatchupScorer.Result.TIE);
    }

    @Test
    void lowerIsBetterForEraAndWhip() {
        StatTotals a = both(hit(1, 0, 0, 0, 0), 27, 1, 5, 1, 9, 1, 0, 1);
        StatTotals b = both(hit(1, 0, 0, 0, 0), 27, 5, 9, 3, 5, 0, 0, 0);
        MatchupScorer.Score s = MatchupScorer.score(a, b);
        assertThat(s.categories().stream().filter(c -> c.category().equals("ERA")).findFirst().orElseThrow().winner())
                .isEqualTo(MatchupScorer.Outcome.A);
        assertThat(s.categories().stream().filter(c -> c.category().equals("WHIP")).findFirst().orElseThrow().winner())
                .isEqualTo(MatchupScorer.Outcome.A);
        assertThat(s.result()).isEqualTo(MatchupScorer.Result.A_WIN);
    }

    @Test
    void winsAndSavesAreCombined() {
        // 1 SV + 2 W = 3 SV + 0 W
        StatTotals a = new StatTotals(0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 2, 0);
        StatTotals b = new StatTotals(0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, 0);
        assertThat(a.compare(Category.WSV, b)).isZero();
        assertThat(a.value(Category.WSV)).isEqualTo(3.0);
    }

    @Test
    void hitsAndWalksAreCountingCategories() {
        StatTotals a = hit(30, 9, 0, 0, 2);
        StatTotals b = hit(20, 7, 0, 0, 5);
        assertThat(a.compare(Category.H, b)).isPositive();
        assertThat(a.compare(Category.BB, b)).isNegative();
    }
}
