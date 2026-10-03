package tw.cpblf.source;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import tw.cpblf.source.SourceModels.SourcePlayer;

/**
 * 中職進階數據網站（stats.cpbl.com.tw）公開頁面的白名單 parser（CPBLF-70）。
 *
 * <p>輸入是請求時帶 {@code Accept: text/markdown} 取得的 Markdown。只讀取明確列舉的欄位；
 * 圖片（球員照片、球隊 logo）、文章連結一律略過，不落地。格式與實測結論見 docs/m0-data-feasibility.md。
 */
public final class StatsSiteParsers {

    private StatsSiteParsers() {
    }

    /** 球員列表的一頁。teamName 已去除「二軍」字尾；二軍球員的 id 另列於 minorsIds。 */
    public record PlayerListPage(int totalCount, List<SourcePlayer> players, List<String> minorsIds) {
    }

    private static final Pattern TOTAL = Pattern.compile("共找到\\s*(\\d+)\\s*個結果");
    private static final Pattern PLAYER_LINK = Pattern.compile("\\]\\(/players/(\\d{10})\\)");
    private static final Pattern JERSEY = Pattern.compile("\\d{1,3}");
    /** 姓名前的身份標記（例：*尹柏淮、#王維中），意義網站未說明，只去除不使用。 */
    private static final Pattern NAME_MARKERS = Pattern.compile("^[*＊#＃◎✽]+");
    private static final String MINORS_SUFFIX = "二軍";

    /** /players?page=N */
    public static PlayerListPage parsePlayerList(String md) {
        Matcher total = TOTAL.matcher(md);
        if (!total.find()) {
            throw new SourceStructureException("球員列表缺少「共找到 N 個結果」，頁面結構可能已變動");
        }
        String body = md.substring(total.end());
        List<SourcePlayer> players = new ArrayList<>();
        List<String> minors = new ArrayList<>();
        Matcher link = PLAYER_LINK.matcher(body);
        int from = 0;
        while (link.find()) {
            List<String> fields = textLines(body.substring(from, link.start()));
            from = link.end();
            // 依序為：姓名、背號（可能沒有）、球隊、守位；以「|」分隔的兩個欄位固定在最後
            if (fields.size() < 3) {
                throw new SourceStructureException("球員列表項目欄位不足：" + fields);
            }
            String position = fields.get(fields.size() - 1);
            String team = fields.get(fields.size() - 2);
            String jersey = fields.size() >= 4 && JERSEY.matcher(fields.get(fields.size() - 3)).matches()
                    ? fields.get(fields.size() - 3) : null;
            String name = cleanName(fields.get(0));
            String id = link.group(1);
            boolean isMinors = team.endsWith(MINORS_SUFFIX);
            if (isMinors) {
                team = team.substring(0, team.length() - MINORS_SUFFIX.length()).trim();
                minors.add(id);
            }
            players.add(new SourcePlayer(id, name, team, normalizePosition(position), null, jersey));
        }
        return new PlayerListPage(Integer.parseInt(total.group(1)), players, minors);
    }

    private static final Pattern PROFILE_HEAD = Pattern.compile("^#\\s*(\\d{0,3})\\s*\\|\\s*(.+?)\\s*\\|\\s*(.+)$");

    /** /players/{id}：背號、球隊、守位；原名為英文拼音者視為洋將。 */
    public static SourcePlayer parsePlayerProfile(String md, String cpblPlayerId) {
        int start = md.indexOf("球員詳情");
        int end = md.indexOf("## 中職百分位排名");
        if (start < 0) {
            throw new SourceStructureException("球員頁缺少「球員詳情」標題：" + cpblPlayerId);
        }
        List<String> lines = textLines(md.substring(start, end > start ? end : md.length()));
        String name = null, jersey = null, team = null, position = null, originalName = null;
        for (int i = 0; i < lines.size(); i++) {
            String l = lines.get(i);
            if (l.startsWith("## ") && name == null) {
                name = cleanName(l.substring(3));
                continue;
            }
            Matcher m = PROFILE_HEAD.matcher(l);
            if (m.matches() && team == null) {
                jersey = m.group(1).isEmpty() ? null : m.group(1);
                team = m.group(2);
                position = m.group(3);
                continue;
            }
            if ("原名".equals(l) && i + 1 < lines.size()) {
                originalName = cleanName(lines.get(i + 1));
            }
        }
        if (name == null || team == null) {
            throw new SourceStructureException("球員頁缺少姓名或球隊：" + cpblPlayerId);
        }
        if (team.endsWith(MINORS_SUFFIX)) {
            team = team.substring(0, team.length() - MINORS_SUFFIX.length()).trim();
        }
        Boolean foreign = originalName == null ? null : isForeignOriginalName(originalName);
        return new SourcePlayer(cpblPlayerId, name, team, normalizePosition(position), foreign, jersey);
    }

    /** 全大寫的拉丁字母單字（姓氏），例：Steven MOYA 的 MOYA、OTAKI Kouji 的 OTAKI。 */
    private static final Pattern UPPERCASE_SURNAME = Pattern.compile("\\b[A-Z]{2,}\\b");

    /**
     * 外籍球員的原名以全大寫寫出姓氏（Mario SANCHEZ、SUZUKI Shunsuke）。
     * 原住民族球員的原名是族名拼音（Ma Yaw Ciru、Namoh．Iyang），本土球員也可能是中文名拼音（Yu Cheng-Yi），
     * 都沒有全大寫單字，所以不能只看「有沒有英文字母」。極少數例外（例：以本土身分登錄的外籍血統球員）需人工修正。
     */
    static boolean isForeignOriginalName(String originalName) {
        return UPPERCASE_SURNAME.matcher(originalName).find();
    }

    /** 網站守位（投手、捕手、一壘手…左外野手）轉為登錄位置 P / C / IF / OF。 */
    static String normalizePosition(String raw) {
        if (raw == null) return "UNKNOWN";
        if (raw.contains("投")) return "P";
        if (raw.contains("捕")) return "C";
        if (raw.contains("外野")) return "OF";
        if (raw.contains("壘") || raw.contains("游擊") || raw.contains("內野")) return "IF";
        return "UNKNOWN";
    }

    /** 去除 Markdown 跳脫（\* → *）與姓名前的身份標記。 */
    static String cleanName(String raw) {
        String s = raw.replaceAll("\\\\(.)", "$1").trim();
        return NAME_MARKERS.matcher(s).replaceFirst("").trim();
    }

    /** 非空、非圖片、非分隔符號的文字行（Markdown 跳脫保留給呼叫端處理）。 */
    private static List<String> textLines(String chunk) {
        List<String> out = new ArrayList<>();
        for (String raw : chunk.split("\\R")) {
            String l = raw.trim();
            if (l.isEmpty() || l.equals("|") || l.equals("[") || l.startsWith("![") || l.startsWith("](")) {
                continue;
            }
            out.add(l.startsWith("\\#") ? l.substring(1) : l);
        }
        return out;
    }
}
