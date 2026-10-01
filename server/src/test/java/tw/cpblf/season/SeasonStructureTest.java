package tw.cpblf.season;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

class SeasonStructureTest {

    @Test
    void splitsHalfIntoBiweeklyPeriods() {
        List<LocalDate[]> p = SeasonService.split(LocalDate.of(2026, 3, 28), LocalDate.of(2026, 6, 7), 14);
        // 72 天 → 5 期，最後 2 天併入第 5 期
        assertThat(p).hasSize(5);
        assertThat(p.get(4)[1]).isEqualTo(LocalDate.of(2026, 6, 7));
        for (int i = 1; i < p.size(); i++) {
            assertThat(p.get(i)[0]).isEqualTo(p.get(i - 1)[1].plusDays(1));
        }
    }

    @Test
    void fiveTeamRoundRobinGivesEachTeamOneBye() {
        List<List<long[]>> rounds = SeasonService.roundRobin(List.of(1L, 2L, 3L, 4L, 5L));
        assertThat(rounds).hasSize(5);
        Map<Long, Integer> games = new HashMap<>();
        Set<String> pairs = new HashSet<>();
        for (List<long[]> r : rounds) {
            assertThat(r).hasSize(2);
            for (long[] m : r) {
                games.merge(m[0], 1, Integer::sum);
                games.merge(m[1], 1, Integer::sum);
                pairs.add(Math.min(m[0], m[1]) + "-" + Math.max(m[0], m[1]));
            }
        }
        assertThat(games.values()).allMatch(g -> g == 4);
        assertThat(pairs).hasSize(10);
    }
}
