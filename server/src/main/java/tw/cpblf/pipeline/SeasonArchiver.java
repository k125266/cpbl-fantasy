package tw.cpblf.pipeline;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.stereotype.Service;

import tw.cpblf.config.AppProperties;
import tw.cpblf.source.SourceArchive;
import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.PitcherLine;
import tw.cpblf.source.SourceModels.RegistrationSnapshot;
import tw.cpblf.source.SourceModels.SourcePlayer;
import tw.cpblf.source.SourceNotFoundException;
import tw.cpblf.source.StatsSiteDataSource;
import tw.cpblf.source.StatsSiteParsers;

/**
 * E12：把一整季的比賽與球員封存到 source_archive，供重播模式使用。
 *
 * <p>網站的 sitemap 只列近期比賽，所以比賽依編號從 1 依序抓（使用者已同意這個偏離，見 docs/m0-data-feasibility.md），
 * 連續 {@value #STOP_AFTER_MISSES} 個編號不存在就停止。已封存且已結束的場次不再抓，中斷後可續抓。
 * 頻率限制、退避與速率限制停止由 PoliteHttpClient 負責。
 */
@Service
public class SeasonArchiver {

    public static final String JOB = "season-archive";
    static final int STOP_AFTER_MISSES = 5;
    /** 防呆上限（一季約 360 場）。 */
    static final int MAX_SNO = 2000;

    /** 封存需要的來源。正式環境為進階數據網站，測試用假資料。 */
    interface Source {
        StatsSiteParsers.GamePage game(int year, String kindCode, int sno);

        RegistrationSnapshot registration();

        SourcePlayer profile(String cpblPlayerId);
    }

    public record Result(int gamesFetched, int gamesSkipped, int lastSno, int playersAdded) {
    }

    private final SourceArchive archive;
    private final AppProperties props;

    public SeasonArchiver(SourceArchive archive, AppProperties props) {
        this.archive = archive;
        this.props = props;
    }

    public Result run(JobRunner.JobContext ctx) {
        StatsSiteDataSource site = new StatsSiteDataSource(props);
        Source src = new Source() {
            public StatsSiteParsers.GamePage game(int year, String kindCode, int sno) {
                return site.fetchGamePage(year, kindCode, sno);
            }

            public RegistrationSnapshot registration() {
                return site.fetchRegistration();
            }

            public SourcePlayer profile(String id) {
                return site.fetchPlayerProfile(id);
            }
        };
        return archive(src, props.seasonYear(), props.kindCode(), ctx);
    }

    Result archive(Source src, int year, String kindCode, JobRunner.JobContext ctx) {
        int fetched = 0, skipped = 0, misses = 0, last = 0;
        for (int sno = 1; sno <= MAX_SNO && misses < STOP_AFTER_MISSES; sno++) {
            if (archive.hasFinalGame(SourceArchive.gameKey(year, kindCode, sno))) {
                skipped++;
                misses = 0;
                last = sno;
                continue;
            }
            try {
                archive.putGame(src.game(year, kindCode, sno));
                fetched++;
                misses = 0;
                last = sno;
                if (ctx != null) ctx.item();
            } catch (SourceNotFoundException e) {
                misses++;
            }
        }

        // 球員：列表上的人，加上 box score 裡出現但已不在列表上的人（季中離隊等），否則重播結算會遇到未知球員
        Map<String, SourcePlayer> players = new LinkedHashMap<>();
        src.registration().registered().forEach(p -> players.put(p.cpblPlayerId(), p));
        for (StatsSiteParsers.GamePage page : archive.games()) {
            String home = page.game().homeTeamName(), away = page.game().awayTeamName();
            for (BatterLine b : page.box().batters()) {
                players.putIfAbsent(b.cpblPlayerId(), new SourcePlayer(b.cpblPlayerId(), b.name(), b.home() ? home : away, null, null, null));
            }
            for (PitcherLine p : page.box().pitchers()) {
                players.putIfAbsent(p.cpblPlayerId(), new SourcePlayer(p.cpblPlayerId(), p.name(), p.home() ? home : away, "P", null, null));
            }
        }
        int added = 0;
        for (SourcePlayer p : players.values()) {
            if (archive.hasPlayer(p.cpblPlayerId())) {
                continue;
            }
            SourcePlayer profile = src.profile(p.cpblPlayerId());
            archive.putPlayer(merge(p, profile));
            added++;
        }
        if (ctx != null) {
            ctx.note("比賽：新抓 " + fetched + "、已封存略過 " + skipped + "（最後編號 " + last + "）；球員新增 " + added
                    + "，共 " + archive.count("player"));
        }
        return new Result(fetched, skipped, last, added);
    }

    /** 以個人頁為主（洋將、守位、背號），缺的欄位用列表或 box score 的資料補。 */
    static SourcePlayer merge(SourcePlayer base, SourcePlayer profile) {
        if (profile == null) {
            return base;
        }
        return new SourcePlayer(base.cpblPlayerId(),
                base.name(),
                base.teamName() != null ? base.teamName() : profile.teamName(),
                profile.listedPosition() != null && !"UNKNOWN".equals(profile.listedPosition()) ? profile.listedPosition() : base.listedPosition(),
                profile.foreign(),
                profile.jerseyNumber() != null ? profile.jerseyNumber() : base.jerseyNumber());
    }
}
