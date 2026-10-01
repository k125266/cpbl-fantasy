package tw.cpblf.source;

import java.time.ZoneId;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import tw.cpblf.config.AppProperties;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.RegistrationSnapshot;
import tw.cpblf.source.SourceModels.SourceGame;
import tw.cpblf.source.SourceModels.SourcePlayer;

/**
 * cpbl.com.tw 資料源。
 *
 * <p>官網為 ASP.NET MVC：先 GET 頁面取得 session cookie 與 RequestVerificationToken，再 POST 至 XHR endpoint。
 * 已佐證 / 未驗證項目見 docs/m0-data-feasibility.md。
 */
public class CpblWebDataSource implements CpblDataSource {

    private static final Pattern CSRF = Pattern.compile("RequestVerificationToken:\\s*['\"]([^'\"]+)['\"]");
    private static final Pattern ACNT = Pattern.compile("acnt=(\\d+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern NAME_PREFIX = Pattern.compile("^([*＊＃◎#✽]+)");

    /** 官網球員列表姓名前綴標記中代表「一軍登錄」者。未驗證（CPBLF-4），見文件。 */
    static final Set<String> FIRST_TEAM_MARKERS = Set.of("◎");

    private final String baseUrl;
    private final ZoneId zone;
    private final PoliteHttpClient http;

    public CpblWebDataSource(AppProperties props) {
        this(props, new PoliteHttpClient(props.crawler()));
    }

    CpblWebDataSource(AppProperties props, PoliteHttpClient http) {
        this.baseUrl = props.crawler().baseUrl();
        this.zone = props.zoneId();
        this.http = http;
    }

    @Override
    public String name() {
        return "web";
    }

    @Override
    public List<SourceGame> fetchSchedule(int year, String kindCode) {
        String page = baseUrl + "/schedule";
        String token = csrf(http.get(page));
        String body = http.postForm(baseUrl + "/schedule/getgamedatas",
                Map.of("calendar", year + "/01/01", "location", "", "kindCode", kindCode),
                xhrHeaders(token, page));
        return CpblParsers.parseSchedule(body, zone);
    }

    @Override
    public BoxScore fetchBoxScore(int year, String kindCode, int gameSno) {
        String page = baseUrl + "/box/index?year=" + year + "&kindCode=" + kindCode + "&gameSno=" + gameSno;
        String token = csrf(http.get(page));
        Map<String, String> form = new LinkedHashMap<>();
        form.put("GameSno", String.valueOf(gameSno));
        form.put("KindCode", kindCode);
        form.put("Year", String.valueOf(year));
        form.put("PrevOrNext", "");
        form.put("PresentStatus", "");
        String body = http.postForm(baseUrl + "/box/getlive", form, xhrHeaders(token, page));
        // 比賽狀態以賽程為準（由呼叫端決定），此處只解析數據
        return CpblParsers.parseBoxScore(body, GameStatus.IN_PROGRESS);
    }

    @Override
    public RegistrationSnapshot fetchRegistration() {
        Document doc = Jsoup.parse(http.get(baseUrl + "/player"));
        List<SourcePlayer> players = new java.util.ArrayList<>();
        Set<String> firstTeam = new HashSet<>();
        for (Element list : doc.select("div.PlayersList")) {
            Element dt = list.selectFirst("dl > dt");
            String team = dt == null ? "" : dt.text().trim();
            for (Element a : list.select("dl > dd a")) {
                Matcher m = ACNT.matcher(a.attr("href"));
                if (!m.find()) {
                    continue;
                }
                String raw = a.text().trim();
                Matcher pm = NAME_PREFIX.matcher(raw);
                String markers = pm.find() ? pm.group(1) : "";
                String name = raw.substring(markers.length()).trim();
                players.add(new SourcePlayer(m.group(1), name, team, null, null, null));
                if (FIRST_TEAM_MARKERS.stream().anyMatch(markers::contains)) {
                    firstTeam.add(m.group(1));
                }
            }
        }
        if (players.isEmpty()) {
            throw new SourceStructureException("球員列表頁未解析出任何球員，頁面結構可能已變動");
        }
        if (firstTeam.isEmpty()) {
            // 寧可中斷也不要把所有人誤判為下二軍
            throw new SourceStructureException("無法從球員列表辨識一軍登錄標記（CPBLF-4 未驗證），中止名單同步");
        }
        return new RegistrationSnapshot(players, firstTeam);
    }

    @Override
    public SourcePlayer fetchPlayerProfile(String cpblPlayerId) {
        Document doc = Jsoup.parse(http.get(baseUrl + "/team/person?acnt=" + cpblPlayerId));
        Element nameDiv = doc.selectFirst("div.name");
        if (nameDiv == null) {
            return null;
        }
        Element number = nameDiv.selectFirst("span.number");
        String jersey = number == null ? null : number.text().replaceAll("[^0-9]", "");
        if (number != null) {
            number.remove();
        }
        Element team = doc.selectFirst("div.team");
        String pos = ddDesc(doc, "pos");
        String nationality = ddDesc(doc, "nationality");
        return new SourcePlayer(cpblPlayerId, nameDiv.text().trim(), team == null ? null : team.text().trim(),
                normalizePosition(pos), nationality == null || nationality.isBlank() ? null : !nationality.contains("中華民國"),
                jersey == null || jersey.isEmpty() ? null : jersey);
    }

    static String normalizePosition(String raw) {
        if (raw == null) {
            return "UNKNOWN";
        }
        if (raw.contains("投")) return "P";
        if (raw.contains("捕")) return "C";
        if (raw.contains("內野")) return "IF";
        if (raw.contains("外野")) return "OF";
        return "UNKNOWN";
    }

    private static String ddDesc(Document doc, String cls) {
        Element desc = doc.selectFirst("dd." + cls + " div.desc");
        return desc == null ? null : desc.text().trim();
    }

    private static String csrf(String html) {
        Matcher m = CSRF.matcher(html);
        if (!m.find()) {
            throw new SourceStructureException("頁面中找不到 RequestVerificationToken");
        }
        return m.group(1);
    }

    private static Map<String, String> xhrHeaders(String token, String referer) {
        return Map.of("RequestVerificationToken", token, "X-Requested-With", "XMLHttpRequest", "Referer", referer);
    }
}
