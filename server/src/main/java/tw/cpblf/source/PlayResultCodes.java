package tw.cpblf.source;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 逐打席結果代碼白名單（記分簿式的短代碼，例：一安、三振、右飛、犧短）。
 *
 * <p>只接受白名單內的代碼；比不到的整段丟棄，確保任何敘述文字都不會落地（見 docs/rulebook-amendments.md）。
 * 網站把同一位打者的多個結果連在一起（例：三振右飛投滾中飛），以最長比對切開。
 */
public final class PlayResultCodes {

    private PlayResultCodes() {
    }

    private static final Set<String> CODES = new HashSet<>(List.of(
            "一安", "二安", "三安", "全壘打", "全打", "內安", "三振", "不死三振", "四壞", "故四", "死球", "觸身",
            "犧短", "犧飛", "雙殺", "三殺", "野選", "妨礙", "失誤"));
    private static final int MAX_LEN;

    static {
        // 守位 + 打球結果，例：左飛、一滾、游失、三短、右界飛
        for (String pos : List.of("投", "捕", "一", "二", "三", "游", "左", "中", "右")) {
            for (String type : List.of("飛", "滾", "平", "界飛", "安", "失", "短")) {
                CODES.add(pos + type);
            }
        }
        MAX_LEN = CODES.stream().mapToInt(String::length).max().orElse(1);
    }

    /** 是否為單一個白名單代碼。 */
    public static boolean isCode(String s) {
        return s != null && CODES.contains(s.trim());
    }

    /** 把連在一起的代碼切開；任何一段比不到就回傳 empty（整段丟棄）。 */
    public static Optional<List<String>> split(String s) {
        if (s == null || s.isBlank()) {
            return Optional.empty();
        }
        String t = s.trim();
        List<String> out = new ArrayList<>();
        int i = 0;
        while (i < t.length()) {
            String hit = null;
            for (int len = Math.min(MAX_LEN, t.length() - i); len > 0; len--) {
                String part = t.substring(i, i + len);
                if (CODES.contains(part)) {
                    hit = part;
                    break;
                }
            }
            if (hit == null) {
                return Optional.empty();
            }
            out.add(hit);
            i += hit.length();
        }
        return Optional.of(out);
    }
}
