package tw.cpblf.source;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import tw.cpblf.config.AppProperties;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.RegistrationSnapshot;
import tw.cpblf.source.SourceModels.SourceGame;
import tw.cpblf.source.SourceModels.SourcePlayer;

/**
 * 中職進階數據網站（stats.cpbl.com.tw）資料源。
 *
 * <p>只讀 robots.txt 允許的公開頁面，請求時帶 {@code Accept: text/markdown} 取得網站提供的 Markdown；
 * 不呼叫網站自用的 {@code /api/}。頻率限制、退避與速率限制停止由 {@link PoliteHttpClient} 負責。
 */
public class StatsSiteDataSource implements CpblDataSource {

    private static final Map<String, String> MARKDOWN = Map.of("Accept", "text/markdown");
    /** 防呆：網站分頁異常時不無限翻頁（目前約 65 頁）。 */
    static final int MAX_LIST_PAGES = 200;
    /** 收集到的人數低於「共找到 N 個結果」的此比例時，視為來源結構異常。 */
    static final double MIN_LIST_COVERAGE = 0.95;

    private final String baseUrl;
    private final PoliteHttpClient http;
    private final boolean liveDetail;

    public StatsSiteDataSource(AppProperties props) {
        this(props, new PoliteHttpClient(props.crawler()));
    }

    StatsSiteDataSource(AppProperties props, PoliteHttpClient http) {
        this.baseUrl = props.crawler().statsBaseUrl();
        this.http = http;
        this.liveDetail = props.crawler().liveDetailEnabled();
    }

    @Override
    public String name() {
        return "stats";
    }

    /**
     * 比賽網址取自網站提供的 sitemap（只含近期與即將進行的比賽，符合 llms.txt「網址由 sitemap 取得」的要求），
     * 再逐場讀比賽頁。比賽頁沒有開賽時間，另讀一次賽程列表頁（/schedule）取得尚未開打比賽的時間；
     * 列表上沒有的（進行中、已結束）startTime 為 null，由 SchedulePoller 沿用已知值或預設時間。
     */
    @Override
    public List<SourceGame> fetchSchedule(int year, String kindCode) {
        String sitemap = http.get(baseUrl + "/sitemap.xml");
        Map<String, java.time.Instant> times = StatsSiteParsers.parseScheduleTimes(markdown("/schedule"));
        List<SourceGame> out = new java.util.ArrayList<>();
        for (int sno : StatsSiteParsers.parseSitemapGames(sitemap, year, kindCode)) {
            SourceGame g = gamePage(year, kindCode, sno).game();
            java.time.Instant start = times.get(year + "-" + kindCode + "-" + sno);
            out.add(new SourceGame(g.year(), g.kindCode(), g.gameSno(), g.date(), start, g.homeTeamName(), g.awayTeamName(),
                    g.status(), g.homeScore(), g.awayScore()));
        }
        return out;
    }

    @Override
    public BoxScore fetchBoxScore(int year, String kindCode, int gameSno) {
        return gamePage(year, kindCode, gameSno).box();
    }

    private StatsSiteParsers.GamePage gamePage(int year, String kindCode, int sno) {
        return StatsSiteParsers.parseGame(markdown("/schedule/" + year + "-" + kindCode + "-" + sno), year, kindCode, sno,
                liveDetail);
    }

    /** 單場比賽頁（賽程資訊＋box score）。編號不存在時丟 {@link SourceNotFoundException}。整季封存用。 */
    public StatsSiteParsers.GamePage fetchGamePage(int year, String kindCode, int sno) {
        return gamePage(year, kindCode, sno);
    }

    /** 翻完球員列表（/players?page=N）。球隊名以「二軍」結尾者不在一軍名單中。 */
    @Override
    public RegistrationSnapshot fetchRegistration() {
        Map<String, SourcePlayer> players = new LinkedHashMap<>();
        Set<String> minors = new HashSet<>();
        int total = -1;
        for (int page = 1; page <= MAX_LIST_PAGES; page++) {
            StatsSiteParsers.PlayerListPage p = StatsSiteParsers.parsePlayerList(markdown("/players?page=" + page));
            total = p.totalCount();
            if (p.players().isEmpty()) {
                break;
            }
            p.players().forEach(sp -> players.putIfAbsent(sp.cpblPlayerId(), sp));
            minors.addAll(p.minorsIds());
            if (players.size() >= total) {
                break;
            }
        }
        if (players.size() < total * MIN_LIST_COVERAGE) {
            throw new SourceStructureException("球員列表只取得 " + players.size() + "/" + total + " 人，分頁結構可能已變動");
        }
        Set<String> firstTeam = new HashSet<>(players.keySet());
        firstTeam.removeAll(minors);
        if (firstTeam.isEmpty()) {
            // 寧可中斷也不要把所有人誤判為下二軍
            throw new SourceStructureException("球員列表中沒有任何一軍球員，頁面結構可能已變動，中止名單同步");
        }
        return new RegistrationSnapshot(List.copyOf(players.values()), firstTeam);
    }

    /** /players/{id}：補國籍（原名為英文拼音者為洋將）。查無時回傳 null。 */
    @Override
    public SourcePlayer fetchPlayerProfile(String cpblPlayerId) {
        try {
            return StatsSiteParsers.parsePlayerProfile(markdown("/players/" + cpblPlayerId), cpblPlayerId);
        } catch (SourceStructureException e) {
            return null;
        }
    }

    private String markdown(String path) {
        return http.get(baseUrl + path, MARKDOWN);
    }
}
