package tw.cpblf.season;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.ArrayList;
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
    void fiveTeamsPlayBothNeighboursEveryPeriodWithoutByes() {
        List<List<long[]>> rounds = SeasonService.ringRounds(List.of(1L, 2L, 3L, 4L, 5L));
        // 步距 1、2 交替，每兩期一個循環
        assertThat(rounds).hasSize(2);
        Set<String> pairs = new HashSet<>();
        for (List<long[]> r : rounds) {
            assertThat(r).hasSize(5);
            Map<Long, Integer> games = new HashMap<>();
            Set<String> inRound = new HashSet<>();
            for (long[] m : r) {
                assertThat(m[0]).isNotEqualTo(m[1]);
                games.merge(m[0], 1, Integer::sum);
                games.merge(m[1], 1, Integer::sum);
                inRound.add(pairKey(m));
                pairs.add(pairKey(m));
            }
            assertThat(games).hasSize(5);
            assertThat(games.values()).allMatch(g -> g == 2);
            assertThat(inRound).hasSize(5);
        }
        assertThat(pairs).hasSize(10);
    }

    @Test
    void smallerLeaguesStillMeetEveryOpponent() {
        for (int n = 2; n <= 4; n++) {
            List<Long> teams = new ArrayList<>();
            for (long t = 1; t <= n; t++) {
                teams.add(t);
            }
            Set<String> pairs = new HashSet<>();
            for (List<long[]> r : SeasonService.ringRounds(teams)) {
                Map<Long, Integer> games = new HashMap<>();
                for (long[] m : r) {
                    assertThat(m[0]).isNotEqualTo(m[1]);
                    games.merge(m[0], 1, Integer::sum);
                    games.merge(m[1], 1, Integer::sum);
                    pairs.add(pairKey(m));
                }
                assertThat(games.values()).allMatch(g -> g <= 2);
            }
            assertThat(pairs).as("%d 隊", n).hasSize(n * (n - 1) / 2);
        }
    }

    private static String pairKey(long[] m) {
        return Math.min(m[0], m[1]) + "-" + Math.max(m[0], m[1]);
    }
}
