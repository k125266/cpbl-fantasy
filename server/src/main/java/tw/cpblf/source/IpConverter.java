package tw.cpblf.source;

/**
 * 投球局數轉換。官網以「整數局 + 1/3 局數」表示，或以 6.1 / 6.2 字串表示；一律轉為整數 outs（CPBLF-2）。
 */
public final class IpConverter {

    private IpConverter() {
    }

    public static int outs(int wholeInnings, int thirds) {
        if (wholeInnings < 0 || thirds < 0 || thirds > 2) {
            throw new IllegalArgumentException("局數格式錯誤：" + wholeInnings + " + " + thirds + "/3");
        }
        return wholeInnings * 3 + thirds;
    }

    /** "6.1" → 19，"6.2" → 20，"7" → 21。 */
    public static int outs(String notation) {
        if (notation == null || notation.isBlank()) {
            return 0;
        }
        String s = notation.trim();
        int dot = s.indexOf('.');
        if (dot < 0) {
            return outs(Integer.parseInt(s), 0);
        }
        int whole = Integer.parseInt(s.substring(0, dot));
        String frac = s.substring(dot + 1);
        int thirds = frac.isEmpty() ? 0 : Integer.parseInt(frac);
        return outs(whole, thirds);
    }

    public static String format(int outs) {
        return (outs / 3) + "." + (outs % 3);
    }
}
