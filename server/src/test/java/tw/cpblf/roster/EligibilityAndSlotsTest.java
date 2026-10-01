package tw.cpblf.roster;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import tw.cpblf.league.League;

class EligibilityAndSlotsTest {

    static League league() {
        return new League(1, "t", 2026, "X", 1, 5, 4, 5, 3, 21, 100, 4, 3, 1, 4, 2, 6, 2, 10, 15, 5, 10, 2, 3, 24, 48, 5, 2,
                20, 90, false, null, null);
    }

    @Test
    void hittersEarnPositionAfterFiveGames() {
        var four = new EligibilityService.Usage(0, 4, 4, 0, 0);
        var five = new EligibilityService.Usage(0, 5, 5, 0, 0);
        assertThat(EligibilityService.compute("IF", four, league(), false)).containsExactlyInAnyOrder(Slot.IF, Slot.UTIL);
        assertThat(EligibilityService.compute("IF", five, league(), false)).containsExactlyInAnyOrder(Slot.IF, Slot.OF, Slot.UTIL);
        // 捕手不設 C slot：只有 UTIL
        assertThat(EligibilityService.compute("C", EligibilityService.Usage.NONE, league(), false)).containsExactly(Slot.UTIL);
    }

    @Test
    void pitcherSpNeedsThreeStartsAndCanAlsoBeRp() {
        var twoStarts = new EligibilityService.Usage(0, 0, 0, 2, 0);
        var threeStarts = new EligibilityService.Usage(0, 0, 0, 3, 0);
        var mixed = new EligibilityService.Usage(0, 0, 0, 3, 4);
        assertThat(EligibilityService.compute("P", twoStarts, league(), false)).containsExactly(Slot.RP);
        assertThat(EligibilityService.compute("P", threeStarts, league(), false)).containsExactly(Slot.SP);
        assertThat(EligibilityService.compute("P", mixed, league(), false)).containsExactlyInAnyOrder(Slot.SP, Slot.RP);
        // 半季初寬限期：投手 SP/RP 皆可
        assertThat(EligibilityService.compute("P", EligibilityService.Usage.NONE, league(), true))
                .containsExactlyInAnyOrder(Slot.SP, Slot.RP);
    }

    @Test
    void slotAssignerFindsMaximumMatchingRespectingPriority() {
        Map<Slot, Integer> counts = new EnumMap<>(Slot.class);
        counts.put(Slot.IF, 1);
        counts.put(Slot.UTIL, 1);
        // A 只能 UTIL，B 可 IF/UTIL：貪婪會把 B 放 UTIL 而讓 A 落空，最大匹配應兩者都上
        var a = new SlotAssigner.Candidate(1, Set.of(Slot.UTIL));
        var b = new SlotAssigner.Candidate(2, Set.of(Slot.IF, Slot.UTIL));
        Map<Long, Slot> out = SlotAssigner.assign(List.of(b, a), counts);
        assertThat(out).containsEntry(1L, Slot.UTIL).containsEntry(2L, Slot.IF);
        assertThat(SlotAssigner.unfilled(List.of(a), counts)).isEqualTo(1);
    }
}
