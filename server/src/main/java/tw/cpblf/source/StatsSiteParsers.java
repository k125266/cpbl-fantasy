package tw.cpblf.source;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.PitcherLine;
import tw.cpblf.source.SourceModels.SourceGame;
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
        Boolean foreign = originalName == null ? null : foreignByOriginalName(originalName);
        return new SourcePlayer(cpblPlayerId, name, team, normalizePosition(position), foreign, jersey, originalName);
    }

    // ------------------------------------------------------------------
    // sitemap.xml：網站提供的比賽網址（近期與即將進行的比賽）
    // ------------------------------------------------------------------

    private static final Pattern SITEMAP_GAME = Pattern.compile("/schedule/(\\d{4})-([A-Z])-(\\d+)<");

    /** sitemap 中指定年度與賽事類別的比賽編號（依編號排序、去重）。 */
    public static List<Integer> parseSitemapGames(String xml, int year, String kindCode) {
        java.util.TreeSet<Integer> out = new java.util.TreeSet<>();
        Matcher m = SITEMAP_GAME.matcher(xml);
        while (m.find()) {
            if (Integer.parseInt(m.group(1)) == year && m.group(2).equals(kindCode)) {
                out.add(Integer.parseInt(m.group(3)));
            }
        }
        return List.copyOf(out);
    }

    // ------------------------------------------------------------------
    // 單場比賽頁 /schedule/{year}-{kind}-{sno}
    // ------------------------------------------------------------------

    /** 一場比賽：賽程資訊與 box score（同一頁）。 */
    public record GamePage(SourceGame game, BoxScore box) {
    }

    private static final Pattern GAME_TITLE = Pattern.compile("^# (.+?) vs (.+?) 賽事詳情$");
    private static final Pattern GAME_DATE = Pattern.compile("^(\\d{4})/(\\d{1,2})/(\\d{1,2})");
    private static final Pattern SCORE = Pattern.compile("\\d{1,2}");
    private static final Pattern BATTER = Pattern.compile("^(\\d+\\.)?\\[(.+?)\\]\\(/players/(\\d{10})\\)$");
    private static final Pattern PITCHER = Pattern.compile("^\\|?\\s*\\[(.+?)\\]\\(/players/(\\d{10})\\)\\s*\\|(.*)$");
    private static final Pattern CARD_PLAYER = Pattern.compile("\\]\\(/players/(\\d{10})\\)");
    private static final java.util.Set<String> KIND_LABELS = java.util.Set.of(
            "一軍例行賽", "一軍季後挑戰賽", "一軍總冠軍賽", "二軍例行賽", "二軍總冠軍賽", "一軍熱身賽", "一軍明星賽");

    /**
     * 標題為「客隊 vs 主隊」，比分依同樣順序；打者表與投手表也是客隊在前。
     * 打者表沒有守備位置（positions 一律為空字串），也沒有打點、盜壘；投手表沒有中繼。
     * 勝投、救援成功取自頁首卡片。
     */
    public static GamePage parseGame(String md, int year, String kindCode, int sno) {
        int start = md.indexOf("賽事詳情");
        if (start < 0) {
            throw new SourceStructureException("比賽頁缺少「賽事詳情」標題：" + year + "-" + kindCode + "-" + sno);
        }
        int lineStart = md.lastIndexOf('\n', start) + 1;
        List<String> lines = textLines(md.substring(lineStart));
        // 不存在的編號：網站回 200，頁面寫「找不到賽事資料」
        if (lines.size() > 1 && lines.get(1).contains("找不到賽事資料")) {
            throw new SourceNotFoundException("比賽不存在：" + year + "-" + kindCode + "-" + sno);
        }
        Matcher title = GAME_TITLE.matcher(lines.get(0));
        if (!title.matches()) {
            throw new SourceStructureException("比賽頁標題格式不符：" + lines.get(0));
        }
        String away = title.group(1).trim();
        String home = title.group(2).trim();

        Integer awayScore = null, homeScore = null;
        String statusText = null;
        java.time.LocalDate date = null;
        String winId = null, saveId = null, pendingCard = null;
        int i = 1;
        for (; i < lines.size(); i++) {
            String l = lines.get(i);
            if (l.contains("打者") && l.contains("打席")) {
                break;
            }
            if (":".equals(l) && awayScore == null && i + 1 < lines.size()
                    && SCORE.matcher(lines.get(i - 1)).matches() && SCORE.matcher(lines.get(i + 1)).matches()) {
                awayScore = Integer.parseInt(lines.get(i - 1));
                homeScore = Integer.parseInt(lines.get(i + 1));
            } else if (KIND_LABELS.contains(l) && statusText == null && i + 1 < lines.size()) {
                statusText = lines.get(i + 1);
            } else if (date == null && GAME_DATE.matcher(l).find()) {
                Matcher d = GAME_DATE.matcher(l);
                d.find();
                date = java.time.LocalDate.of(Integer.parseInt(d.group(1)), Integer.parseInt(d.group(2)), Integer.parseInt(d.group(3)));
            } else if ("勝投".equals(l) || "救援成功".equals(l) || "敗投".equals(l) || "MVP".equals(l)) {
                pendingCard = l;
            } else if (pendingCard != null) {
                Matcher card = CARD_PLAYER.matcher(l);
                if (card.find()) {
                    if ("勝投".equals(pendingCard)) winId = card.group(1);
                    if ("救援成功".equals(pendingCard)) saveId = card.group(1);
                    pendingCard = null;
                }
            }
        }
        if (date == null || statusText == null) {
            throw new SourceStructureException("比賽頁缺少日期或狀態：" + year + "-" + kindCode + "-" + sno);
        }
        GameStatus status = gameStatus(statusText);

        java.util.Map<String, BatterLine> batters = new java.util.LinkedHashMap<>();
        List<PitcherLine> pitchers = new ArrayList<>();
        int batTables = 0, pitTables = 0;
        boolean inBatting = false;
        boolean battingHome = false, pitchingHome = false, firstPitcher = false;
        String[] pendingBatter = null;
        for (; i < lines.size(); i++) {
            String l = lines.get(i);
            if (l.contains("打者") && l.contains("打席")) {
                inBatting = true;
                battingHome = batTables++ == 1;
                continue;
            }
            if (l.contains("投手") && l.contains("局數")) {
                inBatting = false;
                pitchingHome = pitTables++ == 1;
                firstPitcher = true;
                continue;
            }
            if (l.startsWith("合計") || l.startsWith("| 合計") || l.startsWith("|---") || l.startsWith("| ---")) {
                continue;
            }
            if (inBatting) {
                Matcher b = BATTER.matcher(l);
                if (b.matches()) {
                    pendingBatter = new String[]{b.group(3), cleanName(b.group(2))};
                } else if (pendingBatter != null && l.startsWith("|")) {
                    int[] c = cells(l, 7);
                    // 打席、打數、安打、三振、保送、全壘打、得分
                    BatterLine line = new BatterLine(pendingBatter[0], pendingBatter[1], battingHome, "",
                            c[0], c[1], c[6], c[2], c[5], 0, 0, c[4]);
                    batters.merge(line.cpblPlayerId(), line, StatsSiteParsers::mergeBatter);
                    pendingBatter = null;
                }
            } else if (pitTables > 0) {
                Matcher p = PITCHER.matcher(l);
                if (p.matches()) {
                    String[] raw = p.group(3).split("\\|");
                    if (raw.length < 7) {
                        throw new SourceStructureException("投手列欄位不足：" + l);
                    }
                    // 局數、用球數、被安打、三振、保送、失分、責失分
                    int outs = IpConverter.outs(raw[0].trim());
                    String id = p.group(2);
                    pitchers.add(new PitcherLine(id, cleanName(p.group(1)), pitchingHome, firstPitcher, outs,
                            num(raw[2]), num(raw[4]), num(raw[6]), num(raw[3]),
                            id.equals(saveId) ? 1 : 0, 0, id.equals(winId) ? 1 : 0));
                    firstPitcher = false;
                }
            }
        }
        if (status == GameStatus.FINAL && (batTables != 2 || pitTables != 2)) {
            throw new SourceStructureException("已結束的比賽應有雙方打者與投手表，實得打者 " + batTables + "、投手 " + pitTables);
        }
        boolean hasScore = status == GameStatus.FINAL || status == GameStatus.IN_PROGRESS || status == GameStatus.SUSPENDED;
        SourceGame game = new SourceGame(year, kindCode, sno, date, null, home, away, status,
                status == GameStatus.FINAL ? homeScore : null, status == GameStatus.FINAL ? awayScore : null);
        BoxScore box = new BoxScore(status, status == GameStatus.IN_PROGRESS ? statusText : null,
                hasScore ? homeScore : null, hasScore ? awayScore : null, List.copyOf(batters.values()), pitchers);
        return new GamePage(game, box);
    }

    /** 已知狀態文字；其餘（比賽中的局數等）視為進行中，原文保留為 inningText。進行中的實際文字待實測。 */
    static GameStatus gameStatus(String text) {
        if (text.contains("結束")) return GameStatus.FINAL;
        if (text.contains("未開始") || text.contains("準備")) return GameStatus.SCHEDULED;
        if (text.contains("延賽")) return GameStatus.POSTPONED;
        if (text.contains("保留")) return GameStatus.SUSPENDED;
        if (text.contains("取消")) return GameStatus.CANCELLED;
        return GameStatus.IN_PROGRESS;
    }

    private static BatterLine mergeBatter(BatterLine a, BatterLine b) {
        return new BatterLine(a.cpblPlayerId(), a.name(), a.home(), "", a.pa() + b.pa(), a.ab() + b.ab(), a.r() + b.r(),
                a.h() + b.h(), a.hr() + b.hr(), 0, 0, a.bb() + b.bb());
    }

    /** 「| 5 | 4 | 0 | …」取前 n 個整數欄位。 */
    private static int[] cells(String row, int n) {
        String[] raw = row.replaceFirst("^\\|", "").split("\\|");
        if (raw.length < n) {
            throw new SourceStructureException("數據列欄位不足：" + row);
        }
        int[] out = new int[n];
        for (int k = 0; k < n; k++) {
            out[k] = num(raw[k]);
        }
        return out;
    }

    private static int num(String s) {
        String t = s.trim();
        if (t.isEmpty() || t.equals("-")) {
            return 0;
        }
        try {
            return Integer.parseInt(t);
        } catch (NumberFormatException e) {
            throw new SourceStructureException("數據欄位不是整數：" + s);
        }
    }

    /** 全大寫的拉丁字母單字（姓氏），例：Steven MOYA 的 MOYA、OTAKI Kouji 的 OTAKI。 */
    private static final Pattern UPPERCASE_SURNAME = Pattern.compile("\\b[A-Z]{2,}\\b");

    /** 中日文字、全形標點（例：Namoh．Iyang（朱祥麟）、瑪仕革斯．俄霸律尼）。 */
    private static final Pattern CJK_OR_FULLWIDTH = Pattern.compile("[\\u3000-\\u9fff\\uff00-\\uffef‧]");
    /** 台灣式拼音的連字號名字（例：Yu Cheng-Yi）。 */
    private static final Pattern HYPHENATED_GIVEN_NAME = Pattern.compile("\\b[A-Z][a-z]+-[A-Z]?[a-z]+\\b");

    /**
     * 依原名判斷是否為外籍，無法判斷時回傳 null。2026-10 實際比對 517 人得到的規則：
     * <ul>
     *   <li>有全大寫的姓氏（Mario SANCHEZ、SUZUKI Shunsuke、Tyler EPPLER/艾普勒）→ 外籍；
     *       例外：以本土身分登錄的外籍血統球員（John Peter CLARK）</li>
     *   <li>含中文或全形標點（Namoh．Iyang（朱祥麟））、中文名的連字號拼音（Yu Cheng-Yi）、純中文 → 本土</li>
     *   <li>其他一般大小寫的英文名 → 無法判斷：外籍（Quinton Martinez、Shota Iimura）與原住民族族名（Ma Yaw Ciru、Haro Ngayaw）
     *       格式相同，交給人工修正檔（PlayerOverrides）</li>
     * </ul>
     */
    static Boolean foreignByOriginalName(String originalName) {
        String s = originalName.trim();
        if (s.isEmpty()) {
            return null;
        }
        // 全大寫姓氏要先判斷：洋將的原名常接中文譯名（Tyler EPPLER/艾普勒/艾璞樂）
        if (UPPERCASE_SURNAME.matcher(s).find()) {
            return true;
        }
        if (CJK_OR_FULLWIDTH.matcher(s).find() || HYPHENATED_GIVEN_NAME.matcher(s).find()) {
            return false;
        }
        return null;
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
            if (l.isEmpty() || l.equals("|") || l.equals("[") || l.startsWith("![")) {
                continue;
            }
            out.add(l.startsWith("\\#") ? l.substring(1) : l);
        }
        return out;
    }
}
