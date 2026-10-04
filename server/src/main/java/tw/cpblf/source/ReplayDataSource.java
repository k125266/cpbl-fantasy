package tw.cpblf.source;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import tw.cpblf.config.AppClock;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.RegistrationSnapshot;
import tw.cpblf.source.SourceModels.SourceGame;
import tw.cpblf.source.SourceModels.SourcePlayer;

/**
 * E12 重播：讀 source_archive 的整季封存，依 AppClock 決定「現在」看得到什麼，不會提前洩漏結果。
 * 做法與 demo 的 SimulatedDataSource 相同，只是數據是真實的 2026 球季。
 *
 * <p>近似處理（docs/m0-data-feasibility.md）：
 * <ul>
 *   <li>開賽時間：網站沒有提供，固定為平日 18:35、週六日 17:05</li>
 *   <li>比賽中沒有逐局資料：開賽後 {@link #GAME_LENGTH} 內只有「進行中」狀態，之後才有完整 box score</li>
 *   <li>延賽不重現：比賽排在實際開打日；封存時仍未開打的比賽，時間過了就當作延賽</li>
 *   <li>一軍／二軍：過去 {@link #ACTIVE_WINDOW_DAYS} 天在一軍出賽過即為一軍；開季頭兩週改看開季後的同樣天數</li>
 *   <li>重播期間沒有註銷：封存的球員都算已註冊</li>
 * </ul>
 */
public class ReplayDataSource implements CpblDataSource {

    static final Duration GAME_LENGTH = Duration.ofMinutes(210);
    static final int ACTIVE_WINDOW_DAYS = 14;
    static final LocalTime WEEKDAY_START = LocalTime.of(18, 35);
    static final LocalTime WEEKEND_START = LocalTime.of(17, 5);

    private final SourceArchive archive;
    private final AppClock clock;
    private List<StatsSiteParsers.GamePage> games = List.of();

    public ReplayDataSource(SourceArchive archive, AppClock clock) {
        this.archive = archive;
        this.clock = clock;
    }

    @Override
    public String name() {
        return "replay";
    }

    /** 封存可能在啟動後才完成，數量變了就重新載入。 */
    private synchronized List<StatsSiteParsers.GamePage> games() {
        if (games.size() != archive.count("game")) {
            games = archive.games();
        }
        return games;
    }

    Instant startTime(LocalDate date) {
        DayOfWeek d = date.getDayOfWeek();
        LocalTime t = d == DayOfWeek.SATURDAY || d == DayOfWeek.SUNDAY ? WEEKEND_START : WEEKDAY_START;
        return date.atTime(t).atZone(clock.zone()).toInstant();
    }

    /** 依目前時鐘看到的狀態。 */
    GameStatus visibleStatus(SourceGame g) {
        Instant now = clock.now();
        Instant start = startTime(g.date());
        if (now.isBefore(start)) {
            return GameStatus.SCHEDULED;
        }
        if (now.isBefore(start.plus(GAME_LENGTH))) {
            return g.status() == GameStatus.FINAL ? GameStatus.IN_PROGRESS : g.status();
        }
        // 封存時仍未開打（延賽後尚未補賽）：時間過了視為延賽
        return g.status() == GameStatus.SCHEDULED || g.status() == GameStatus.IN_PROGRESS ? GameStatus.POSTPONED : g.status();
    }

    @Override
    public List<SourceGame> fetchSchedule(int year, String kindCode) {
        return games().stream()
                .map(StatsSiteParsers.GamePage::game)
                .filter(g -> g.year() == year && g.kindCode().equals(kindCode))
                .map(g -> {
                    GameStatus st = visibleStatus(g);
                    boolean fin = st == GameStatus.FINAL;
                    return new SourceGame(g.year(), g.kindCode(), g.gameSno(), g.date(), startTime(g.date()), g.homeTeamName(),
                            g.awayTeamName(), st, fin ? g.homeScore() : null, fin ? g.awayScore() : null);
                })
                .toList();
    }

    @Override
    public BoxScore fetchBoxScore(int year, String kindCode, int gameSno) {
        StatsSiteParsers.GamePage page = games().stream()
                .filter(p -> p.game().year() == year && p.game().kindCode().equals(kindCode) && p.game().gameSno() == gameSno)
                .findFirst()
                .orElseThrow(() -> new SourceNotFoundException("封存中沒有這場比賽：" + SourceArchive.gameKey(year, kindCode, gameSno)));
        GameStatus st = visibleStatus(page.game());
        if (st == GameStatus.FINAL) {
            return page.box();
        }
        return new BoxScore(st, null, null, null, List.of(), List.of());
    }

    /** 封存的球員都算已註冊；一軍依最近的一軍出賽推斷（只看已經發生的比賽，開季頭兩週除外）。 */
    @Override
    public RegistrationSnapshot fetchRegistration() {
        List<SourcePlayer> players = archive.players();
        LocalDate today = clock.today();
        LocalDate opening = games().stream().map(p -> p.game().date()).min(LocalDate::compareTo).orElse(today);
        LocalDate from, to;
        if (today.isBefore(opening.plusDays(ACTIVE_WINDOW_DAYS))) {
            // 開季前與開季頭兩週：視為開季名單已知
            from = opening;
            to = opening.plusDays(ACTIVE_WINDOW_DAYS - 1);
        } else {
            from = today.minusDays(ACTIVE_WINDOW_DAYS - 1);
            to = today;
        }
        Set<String> active = new HashSet<>();
        for (StatsSiteParsers.GamePage p : games()) {
            LocalDate d = p.game().date();
            if (p.game().status() != GameStatus.FINAL || d.isBefore(from) || d.isAfter(to)) {
                continue;
            }
            p.box().batters().forEach(b -> active.add(b.cpblPlayerId()));
            p.box().pitchers().forEach(x -> active.add(x.cpblPlayerId()));
        }
        return new RegistrationSnapshot(players, active);
    }

    @Override
    public SourcePlayer fetchPlayerProfile(String cpblPlayerId) {
        return archive.players().stream().filter(p -> p.cpblPlayerId().equals(cpblPlayerId)).findFirst().orElse(null);
    }
}
