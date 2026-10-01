package tw.cpblf.roster;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 以二分圖最大匹配將球員分配到先發 slot。依清單順序優先（排前面的球員不會被後面的人擠掉）。
 * 用於選秀中的位置可行性驗證與選秀後自動排定先發。
 */
public final class SlotAssigner {

    private SlotAssigner() {
    }

    public record Candidate(long playerId, Set<Slot> eligible) {
    }

    public static Map<Long, Slot> assign(List<Candidate> players, Map<Slot, Integer> counts) {
        List<Slot> seats = new ArrayList<>();
        for (Slot s : Slot.STARTING) {
            for (int i = 0; i < counts.getOrDefault(s, 0); i++) {
                seats.add(s);
            }
        }
        int[] owner = new int[seats.size()];
        java.util.Arrays.fill(owner, -1);
        for (int p = 0; p < players.size(); p++) {
            augment(p, players, seats, owner, new boolean[seats.size()]);
        }
        Map<Long, Slot> out = new HashMap<>();
        for (int s = 0; s < seats.size(); s++) {
            if (owner[s] >= 0) {
                out.put(players.get(owner[s]).playerId(), seats.get(s));
            }
        }
        return out;
    }

    private static boolean augment(int p, List<Candidate> players, List<Slot> seats, int[] owner, boolean[] seen) {
        for (int s = 0; s < seats.size(); s++) {
            if (seen[s] || !players.get(p).eligible().contains(seats.get(s))) {
                continue;
            }
            seen[s] = true;
            if (owner[s] < 0 || augment(owner[s], players, seats, owner, seen)) {
                owner[s] = p;
                return true;
            }
        }
        return false;
    }

    /** 尚無法填滿的先發 slot 數。 */
    public static int unfilled(List<Candidate> players, Map<Slot, Integer> counts) {
        int total = 0;
        for (Slot s : Slot.STARTING) {
            total += counts.getOrDefault(s, 0);
        }
        return total - assign(players, counts).size();
    }
}
