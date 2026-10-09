package tw.cpblf.draft;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

/** 上半季順位抽籤：每種排列都有機會、每隊抽到第 1 順位的機率接近平均，而且不會因為「時間很接近」就重複。 */
class DraftLotteryTest {

    @Test
    void everyPermutationCanHappenAndFirstPickIsEven() {
        List<Long> teams = List.of(1L, 2L, 3L, 4L, 5L);
        Set<List<Long>> seen = new HashSet<>();
        Map<Long, Integer> first = new HashMap<>();
        int runs = 6000;
        for (int i = 0; i < runs; i++) {
            List<Long> order = DraftService.lotteryOrder(teams);
            assertThat(order).containsExactlyInAnyOrderElementsOf(teams);
            seen.add(order);
            first.merge(order.get(0), 1, Integer::sum);
        }
        // 5 隊共 120 種排列；6000 次裡漏掉任何一種的機率小到可以忽略
        assertThat(seen).hasSize(120);
        // 每隊第 1 順位平均 1200 次，容許很寬（±25%）避免偶發失敗
        assertThat(first.values()).allMatch(n -> n > 900 && n < 1500);
    }

    @Test
    void doesNotTouchTheInput() {
        List<Long> teams = List.of(1L, 2L, 3L);
        DraftService.lotteryOrder(teams);
        assertThat(teams).containsExactly(1L, 2L, 3L);
    }
}
