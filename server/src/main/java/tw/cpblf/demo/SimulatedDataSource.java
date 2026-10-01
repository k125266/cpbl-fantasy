package tw.cpblf.demo;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import tw.cpblf.config.AppClock;
import tw.cpblf.source.CpblDataSource;
import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.PitcherLine;
import tw.cpblf.source.SourceModels.RegistrationSnapshot;
import tw.cpblf.source.SourceModels.SourceGame;
import tw.cpblf.source.SourceModels.SourcePlayer;

/**
 * 模擬賽季資料源（demo 模式）。完全確定性：同一 seed、同一時間點永遠回傳相同結果。
 *
 * <p>球員姓名為隨機組字之虛構人物，數據為模擬產生，與真實球員無關。
 * 模擬內容涵蓋規則書中需要被驗證的情境：延賽與跨半季補賽、和局、賽後數據修正、
 * 升降二軍（含洋將 15 日）、註銷、改名、8/31 大量註冊、一軍未出賽。
 */
public class SimulatedDataSource implements CpblDataSource {

    public static final String[] TEAM_NAMES = {"中信兄弟", "統一7-ELEVEn獅", "樂天桃猿", "富邦悍將", "味全龍", "台鋼雄鷹"};
    private static final Duration GAME_LENGTH = Duration.ofMinutes(200);
    private static final int GAME_DAYS = 120;
    private static final int HALF_GAME_DAYS = 60;

    private final AppClock clock;
    private final ZoneId zone;
    private final int year;
    private final long seed;

    private final List<SimPlayer> players = new ArrayList<>();
    private final Map<String, SimPlayer> byId = new HashMap<>();
    private final List<SimGame> games = new ArrayList<>();
    private final Map<Integer, SimGame> gamesBySno = new HashMap<>();
    /** 依日期排序的名單異動事件。 */
    private final List<RosterEvent> events = new ArrayList<>();
    private final Map<Integer, BoxScore> boxCache = new ConcurrentHashMap<>();
    private final LocalDate seasonStart;
    private LocalDate half1End;
    private LocalDate half2Start;
    private LocalDate seasonEnd;

    public SimulatedDataSource(AppClock clock, int year, long seed) {
        this.clock = clock;
        this.zone = clock.zone();
        this.year = year;
        this.seed = seed;
        this.seasonStart = LocalDate.of(year, 3, 28);
        buildPlayers();
        buildSchedule();
        buildEvents();
    }

    @Override
    public String name() {
        return "demo";
    }

    public LocalDate seasonStart() {
        return seasonStart;
    }

    public LocalDate half1End() {
        return half1End;
    }

    public LocalDate half2Start() {
        return half2Start;
    }

    public LocalDate seasonEnd() {
        return seasonEnd;
    }

    // ------------------------------------------------------------------
    // 球員
    // ------------------------------------------------------------------

    enum Role { SP, RP, C, IF, OF }

    static final class SimPlayer {
        final String id;
        String name;
        final int team;
        final Role role;
        final boolean foreign;
        final double contact, power, eye, speed;
        final double skill, kRate, stamina;
        LocalDate registeredOn;

        SimPlayer(String id, String name, int team, Role role, boolean foreign, Random r) {
            this.id = id;
            this.name = name;
            this.team = team;
            this.role = role;
            this.foreign = foreign;
            double catcherPenalty = role == Role.C ? 0.02 : 0;
            this.contact = 0.215 + r.nextDouble() * 0.11 - catcherPenalty + (foreign ? 0.02 : 0);
            this.power = 0.004 + Math.pow(r.nextDouble(), 2) * 0.05 + (foreign ? 0.015 : 0);
            this.eye = 0.05 + r.nextDouble() * 0.07;
            this.speed = Math.pow(r.nextDouble(), 2) * (role == Role.C ? 0.05 : 0.35);
            this.skill = Math.min(1, r.nextDouble() * 0.9 + (foreign ? 0.15 : 0));
            this.kRate = 0.17 + skill * 0.2;
            this.stamina = 14 + skill * 5 + (foreign ? 1.5 : 0);
        }

        boolean pitcher() {
            return role == Role.SP || role == Role.RP;
        }
    }

    private static final String SURNAMES = "陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾彭游詹胡施沈余趙盧梁顏柯翁魏孫戴范宋方鄧杜傅侯曹薛丁卓阮馬董温唐藍蔣石古紀姚連馮歐程湯黃田康姜汪白鄒尤巫鐘黎涂龔嚴韓袁金童陸夏柳凃邵錢伍倪溫于譚駱熊任甘秦顧毛章史官萬俞雷粘饒張闕凌崔尹孔辛易辜陶段龍韋葛池孟褚殷麥賀賈莫文管關向包丘梅華利裴樊房全佘左花";
    private static final String GIVEN = "冠宇宏志家豪承恩柏翰子軒俊傑建宏宗翰品睿彥廷育誠信宏致遠明哲哲瑋立偉凱文書豪浩然翊安少軒振宇冠廷宥辰柏宇子豪昱廷聖傑博文孟儒韋辰奕辰勝傑紹文泓毅耀中睿哲晉維家銘志明正平國華宇恆";
    private static final String[] FOREIGN_SYL = {"艾", "伯", "卡", "德", "費", "葛", "霍", "凱", "拉", "摩", "諾", "羅", "史", "泰", "范", "威", "布", "克", "斯", "托", "雷", "賓", "納", "奧", "里", "蒙", "坦", "迪"};

    private void buildPlayers() {
        Random r = new Random(seed);
        Set<String> usedNames = new HashSet<>();
        Role[] layout = {
                Role.SP, Role.SP, Role.SP, Role.SP, Role.SP, Role.SP, Role.SP,
                Role.RP, Role.RP, Role.RP, Role.RP, Role.RP, Role.RP, Role.RP, Role.RP, Role.RP,
                Role.C, Role.C, Role.C,
                Role.IF, Role.IF, Role.IF, Role.IF, Role.IF, Role.IF, Role.IF,
                Role.OF, Role.OF, Role.OF, Role.OF, Role.OF, Role.OF};
        for (int t = 0; t < 6; t++) {
            for (int i = 0; i < layout.length; i++) {
                // 每隊洋將：先發 0、1、6，後援 7；部分球隊另有洋砲
                boolean foreign = i == 0 || i == 1 || i == 6 || i == 7 || (t % 3 == 0 && i == 26);
                String id = String.format("9%d%04d", t + 1, i + 1);
                SimPlayer p = new SimPlayer(id, uniqueName(r, foreign, usedNames), t, layout[i], foreign, r);
                p.registeredOn = seasonStart.minusDays(30);
                players.add(p);
                byId.put(id, p);
            }
        }
    }

    private SimPlayer newPlayer(int team, Role role, boolean foreign, LocalDate registeredOn, Random r) {
        long count = players.stream().filter(p -> p.team == team).count();
        String id = String.format("9%d%04d", team + 1, count + 1);
        Set<String> used = new HashSet<>();
        players.forEach(p -> used.add(p.name));
        SimPlayer p = new SimPlayer(id, uniqueName(r, foreign, used), team, role, foreign, r);
        p.registeredOn = registeredOn;
        players.add(p);
        byId.put(id, p);
        return p;
    }

    private static String uniqueName(Random r, boolean foreign, Set<String> used) {
        while (true) {
            String name;
            if (foreign) {
                int len = 2 + r.nextInt(2);
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < len; i++) {
                    sb.append(FOREIGN_SYL[r.nextInt(FOREIGN_SYL.length)]);
                }
                name = sb.toString();
            } else {
                name = SURNAMES.charAt(r.nextInt(SURNAMES.length())) + ""
                        + GIVEN.charAt(r.nextInt(GIVEN.length())) + GIVEN.charAt(r.nextInt(GIVEN.length()));
            }
            if (used.add(name)) {
                return name;
            }
        }
    }

    // ------------------------------------------------------------------
    // 賽程
    // ------------------------------------------------------------------

    static final class SimGame {
        final int sno;
        final LocalDate originalDate;
        LocalDate playDate;
        final int home, away;
        final boolean postponed;
        final int gameDayIndex;

        SimGame(int sno, LocalDate date, int home, int away, boolean postponed, int gameDayIndex) {
            this.sno = sno;
            this.originalDate = date;
            this.playDate = date;
            this.home = home;
            this.away = away;
            this.postponed = postponed;
            this.gameDayIndex = gameDayIndex;
        }
    }

    private static final int[][][] ROUNDS = {
            {{0, 1}, {2, 3}, {4, 5}},
            {{0, 2}, {1, 4}, {3, 5}},
            {{0, 3}, {1, 5}, {2, 4}},
            {{0, 4}, {1, 3}, {2, 5}},
            {{0, 5}, {1, 2}, {3, 4}}};

    private void buildSchedule() {
        Random r = new Random(seed * 7 + 1);
        LocalDate d = seasonStart;
        int sno = 1;
        for (int day = 0; day < GAME_DAYS; day++) {
            while (d.getDayOfWeek() == DayOfWeek.MONDAY) {
                d = d.plusDays(1);
            }
            if (day == HALF_GAME_DAYS) {
                // 上下半季之間的休兵期（重新選秀用）
                half1End = d.minusDays(1);
                while (half1End.getDayOfWeek() == DayOfWeek.MONDAY) {
                    half1End = half1End.minusDays(1);
                }
                d = d.plusDays(4);
                while (d.getDayOfWeek() == DayOfWeek.MONDAY) {
                    d = d.plusDays(1);
                }
                half2Start = d;
            }
            int[][] round = ROUNDS[(day / 3) % 5];
            boolean flip = (day / 15) % 2 == 1;
            for (int[] pair : round) {
                boolean postponed = r.nextDouble() < 0.035;
                SimGame g = new SimGame(sno++, d, flip ? pair[1] : pair[0], flip ? pair[0] : pair[1], postponed, day);
                games.add(g);
                gamesBySno.put(g.sno, g);
            }
            d = d.plusDays(1);
        }
        seasonEnd = d.minusDays(1);
        // 延賽改至下一個週一補賽（可能跨越半季，規則書 6.3）
        Map<LocalDate, Set<Integer>> busy = new HashMap<>();
        for (SimGame g : games) {
            if (g.postponed) {
                LocalDate makeup = g.originalDate.plusDays(1);
                while (makeup.getDayOfWeek() != DayOfWeek.MONDAY
                        || busy.getOrDefault(makeup, Set.of()).contains(g.home)
                        || busy.getOrDefault(makeup, Set.of()).contains(g.away)) {
                    makeup = makeup.plusDays(1);
                }
                busy.computeIfAbsent(makeup, k -> new HashSet<>()).addAll(List.of(g.home, g.away));
                g.playDate = makeup;
            }
        }
    }

    private Instant startTime(LocalDate date) {
        DayOfWeek dow = date.getDayOfWeek();
        LocalTime t = dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY ? LocalTime.of(17, 5) : LocalTime.of(18, 35);
        return date.atTime(t).atZone(zone).toInstant();
    }

    @Override
    public List<SourceGame> fetchSchedule(int requestedYear, String kindCode) {
        if (requestedYear != year || !"A".equals(kindCode)) {
            return List.of();
        }
        Instant now = clock.now();
        LocalDate today = clock.today();
        List<SourceGame> out = new ArrayList<>();
        for (SimGame g : games) {
            LocalDate shownDate;
            GameStatus status;
            if (g.postponed && !today.isAfter(g.originalDate)) {
                shownDate = g.originalDate;
                status = today.isEqual(g.originalDate) && !now.isBefore(startTime(g.originalDate).minus(Duration.ofHours(3)))
                        ? GameStatus.POSTPONED : GameStatus.SCHEDULED;
            } else {
                shownDate = g.playDate;
                status = statusAt(g, now);
            }
            Integer hs = null;
            Integer as = null;
            if (status == GameStatus.FINAL) {
                BoxScore box = box(g);
                hs = box.homeScore();
                as = box.awayScore();
            }
            out.add(new SourceGame(year, "A", g.sno, shownDate, startTime(shownDate), TEAM_NAMES[g.home], TEAM_NAMES[g.away],
                    status, hs, as));
        }
        return out;
    }

    private GameStatus statusAt(SimGame g, Instant now) {
        Instant start = startTime(g.playDate);
        if (now.isBefore(start)) {
            return GameStatus.SCHEDULED;
        }
        return now.isBefore(start.plus(GAME_LENGTH)) ? GameStatus.IN_PROGRESS : GameStatus.FINAL;
    }

    @Override
    public BoxScore fetchBoxScore(int requestedYear, String kindCode, int gameSno) {
        SimGame g = gamesBySno.get(gameSno);
        if (g == null || requestedYear != year) {
            throw new IllegalArgumentException("unknown game " + gameSno);
        }
        Instant now = clock.now();
        GameStatus status = statusAt(g, now);
        if (status == GameStatus.SCHEDULED || (g.postponed && !clock.today().isAfter(g.originalDate))) {
            return new BoxScore(GameStatus.SCHEDULED, null, null, null, List.of(), List.of());
        }
        BoxScore full = box(g);
        if (status == GameStatus.IN_PROGRESS) {
            double frac = Duration.between(startTime(g.playDate), now).toSeconds() / (double) GAME_LENGTH.toSeconds();
            return partial(full, frac);
        }
        // 賽後次日起，部分場次出現記錄員修正（安打改判失誤）
        if (clock.today().isAfter(g.playDate) && Math.floorMod(g.sno * 2654435761L ^ seed, 12) == 0) {
            return corrected(full);
        }
        return full;
    }

    private BoxScore partial(BoxScore full, double frac) {
        int inning = Math.max(1, Math.min(9, (int) Math.ceil(frac * 9)));
        List<BatterLine> bs = full.batters().stream().map(b -> new BatterLine(b.cpblPlayerId(), b.name(), b.home(), b.positions(),
                f(b.pa(), frac), f(b.ab(), frac), f(b.r(), frac), f(b.h(), frac), f(b.hr(), frac), f(b.rbi(), frac),
                f(b.sb(), frac), f(b.bb(), frac))).filter(b -> b.pa() > 0).toList();
        int totalOuts = full.pitchers().stream().filter(PitcherLine::home).mapToInt(PitcherLine::outs).sum();
        List<PitcherLine> ps = new ArrayList<>();
        for (boolean home : new boolean[]{true, false}) {
            int budget = (int) Math.floor(frac * totalOuts);
            for (PitcherLine p : full.pitchers()) {
                if (p.home() != home || budget <= 0) {
                    continue;
                }
                int outs = Math.min(p.outs(), budget);
                budget -= outs;
                double pf = p.outs() == 0 ? 1 : outs / (double) p.outs();
                ps.add(new PitcherLine(p.cpblPlayerId(), p.name(), p.home(), p.started(), outs,
                        f(p.h(), pf), f(p.bb(), pf), f(p.er(), pf), f(p.k(), pf), 0, 0));
            }
        }
        int hs = bs.stream().filter(BatterLine::home).mapToInt(BatterLine::r).sum();
        int as = bs.stream().filter(b -> !b.home()).mapToInt(BatterLine::r).sum();
        return new BoxScore(GameStatus.IN_PROGRESS, inning + " 局", hs, as, bs, ps);
    }

    private static int f(int v, double frac) {
        return (int) Math.floor(v * Math.min(1, frac));
    }

    private BoxScore corrected(BoxScore full) {
        List<BatterLine> bs = new ArrayList<>(full.batters());
        for (int i = 0; i < bs.size(); i++) {
            BatterLine b = bs.get(i);
            if (b.h() > b.hr()) {
                bs.set(i, new BatterLine(b.cpblPlayerId(), b.name(), b.home(), b.positions(), b.pa(), b.ab(), b.r(), b.h() - 1,
                        b.hr(), b.rbi(), b.sb(), b.bb()));
                break;
            }
        }
        return new BoxScore(full.status(), null, full.homeScore(), full.awayScore(), bs, full.pitchers());
    }

    // ------------------------------------------------------------------
    // Box score 產生
    // ------------------------------------------------------------------

    private BoxScore box(SimGame g) {
        return boxCache.computeIfAbsent(g.sno, k -> generateBox(g));
    }

    private BoxScore generateBox(SimGame g) {
        Random r = new Random(seed ^ (g.sno * 1_000_003L));
        Map<String, Status> st = statusOn(g.playDate);
        int homeGameNo = teamGameNumber(g, g.home);
        int awayGameNo = teamGameNumber(g, g.away);

        List<SimPlayer> homeP = pitchingStaff(g.home, st, homeGameNo, r, g.playDate);
        List<SimPlayer> awayP = pitchingStaff(g.away, st, awayGameNo, r, g.playDate);

        List<BatterLine> homeBat = battingLines(g.home, true, st, awayP.get(0), r, g.playDate);
        List<BatterLine> awayBat = battingLines(g.away, false, st, homeP.get(0), r, g.playDate);
        int homeRuns = homeBat.stream().mapToInt(BatterLine::r).sum();
        int awayRuns = awayBat.stream().mapToInt(BatterLine::r).sum();

        // 主隊領先時九局下不打
        int homePitchOuts = 27;
        int awayPitchOuts = homeRuns > awayRuns ? 24 : 27;
        List<PitcherLine> pitchers = new ArrayList<>();
        pitchers.addAll(pitchingLines(homeP, true, homePitchOuts, awayBat, homeRuns - awayRuns, r, g.playDate));
        pitchers.addAll(pitchingLines(awayP, false, awayPitchOuts, homeBat, awayRuns - homeRuns, r, g.playDate));
        List<BatterLine> batters = new ArrayList<>(awayBat);
        batters.addAll(homeBat);
        return new BoxScore(GameStatus.FINAL, null, homeRuns, awayRuns, batters, pitchers);
    }

    private int teamGameNumber(SimGame target, int team) {
        int n = 0;
        for (SimGame g : games) {
            if ((g.home == team || g.away == team) && (g.playDate.isBefore(target.playDate)
                    || g.playDate.isEqual(target.playDate) && g.sno < target.sno)) {
                n++;
            }
        }
        return n;
    }

    private List<SimPlayer> active(int team, Map<String, Status> st, Role... roles) {
        Set<Role> rs = Set.of(roles);
        return players.stream()
                .filter(p -> p.team == team && rs.contains(p.role) && st.get(p.id) == Status.ACTIVE)
                .sorted(Comparator.comparing(p -> p.id))
                .toList();
    }

    private List<SimPlayer> pitchingStaff(int team, Map<String, Status> st, int gameNo, Random r, LocalDate date) {
        List<SimPlayer> sps = active(team, st, Role.SP);
        List<SimPlayer> rotation = sps.subList(0, Math.min(6, sps.size()));
        List<SimPlayer> staff = new ArrayList<>();
        SimPlayer starter = rotation.isEmpty() ? active(team, st, Role.RP).get(0) : rotation.get(gameNo % rotation.size());
        staff.add(starter);
        List<SimPlayer> pen = new ArrayList<>(active(team, st, Role.RP));
        pen.removeIf(p -> isIdle(p, date));
        java.util.Collections.shuffle(pen, r);
        int relievers = 2 + r.nextInt(3);
        staff.addAll(pen.subList(0, Math.min(relievers, pen.size())));
        return staff;
    }

    private static final String[] IF_POS = {"1B", "2B", "3B", "SS"};
    private static final String[] OF_POS = {"LF", "CF", "RF"};

    private List<BatterLine> battingLines(int team, boolean home, Map<String, Status> st, SimPlayer oppStarter, Random r,
                                          LocalDate date) {
        List<SimPlayer> catchers = new ArrayList<>(active(team, st, Role.C));
        List<SimPlayer> infield = new ArrayList<>(active(team, st, Role.IF));
        List<SimPlayer> outfield = new ArrayList<>(active(team, st, Role.OF));
        catchers.removeIf(p -> isIdle(p, date));
        infield.removeIf(p -> isIdle(p, date));
        outfield.removeIf(p -> isIdle(p, date));

        List<SimPlayer> order = new ArrayList<>();
        Map<SimPlayer, String> pos = new HashMap<>();
        Set<SimPlayer> bench = new LinkedHashSet<>();
        pick(catchers, 1, order, pos, new String[]{"C"}, r, bench);
        pick(infield, 4, order, pos, IF_POS, r, bench);
        pick(outfield, 3, order, pos, OF_POS, r, bench);
        // 外野缺人或輪休時由內野工具人補位（讓工具人取得外野資格）
        if (order.stream().filter(p -> OF_POS[0].equals(pos.get(p)) || "CF".equals(pos.get(p)) || "RF".equals(pos.get(p))).count() < 3) {
            bench.stream().filter(p -> p.role == Role.IF).findFirst().ifPresent(p -> {
                order.add(p);
                pos.put(p, "LF");
                bench.remove(p);
            });
        }
        bench.stream().max(Comparator.comparingDouble(p -> p.contact + p.power)).ifPresent(dh -> {
            order.add(dh);
            pos.put(dh, "DH");
            bench.remove(dh);
        });
        double suppress = 1.12 - 0.24 * oppStarter.skill;

        List<int[]> lines = new ArrayList<>();
        int teamH = 0, teamBB = 0, teamHR = 0;
        for (int i = 0; i < order.size(); i++) {
            SimPlayer p = order.get(i);
            int pa = (i < 4 ? 4 + (r.nextDouble() < 0.55 ? 1 : 0) : (r.nextDouble() < 0.75 ? 4 : 3));
            int[] l = plateAppearances(p, pa, suppress, r);
            lines.add(l);
            teamH += l[2];
            teamBB += l[5];
            teamHR += l[3];
        }
        // 代打
        if (!bench.isEmpty() && r.nextDouble() < 0.35) {
            SimPlayer ph = bench.iterator().next();
            order.add(ph);
            pos.put(ph, "");
            int[] l = plateAppearances(ph, 1, suppress, r);
            lines.add(l);
            teamH += l[2];
            teamBB += l[5];
            teamHR += l[3];
        }
        int runs = (int) Math.round(0.36 * teamH + 0.22 * teamBB + 0.75 * teamHR + r.nextGaussian());
        runs = Math.max(teamHR, Math.min(teamH + teamBB, runs));
        distribute(lines, runs, 4, l -> l[2] + l[5], l -> l[3], r);
        int rbi = Math.max(teamHR, (int) Math.round(runs * 0.92));
        distribute(lines, rbi, 6, l -> l[2] + (l[5] > 0 ? 1 : 0), l -> l[3], r);
        List<BatterLine> out = new ArrayList<>();
        for (int i = 0; i < order.size(); i++) {
            SimPlayer p = order.get(i);
            int[] l = lines.get(i);
            int onBase = l[2] - l[3] + l[5];
            int sb = 0;
            for (int k = 0; k < onBase; k++) {
                if (r.nextDouble() < p.speed) {
                    sb++;
                }
            }
            out.add(new BatterLine(p.id, nameOn(p, date), home, pos.get(p), l[0], l[1], l[4], l[2], l[3], l[6], sb, l[5]));
        }
        return out;
    }

    private static void pick(List<SimPlayer> pool, int n, List<SimPlayer> order, Map<SimPlayer, String> pos, String[] positions,
                             Random r, Set<SimPlayer> bench) {
        List<SimPlayer> sorted = new ArrayList<>(pool);
        sorted.sort(Comparator.comparingDouble((SimPlayer p) -> -(p.contact + p.power * 2)));
        List<SimPlayer> starters = new ArrayList<>(sorted.subList(0, Math.min(n, sorted.size())));
        List<SimPlayer> reserves = new ArrayList<>(sorted.subList(Math.min(n, sorted.size()), sorted.size()));
        for (int i = 0; i < starters.size(); i++) {
            if (!reserves.isEmpty() && r.nextDouble() < 0.07) {
                bench.add(starters.get(i));
                starters.set(i, reserves.remove(0));
            }
        }
        for (int i = 0; i < starters.size(); i++) {
            order.add(starters.get(i));
            pos.put(starters.get(i), positions[i % positions.length]);
        }
        bench.addAll(reserves);
    }

    /** 回傳 [PA, AB, H, HR, R, BB, RBI]。 */
    private static int[] plateAppearances(SimPlayer p, int pa, double suppress, Random r) {
        int ab = 0, h = 0, hr = 0, bb = 0;
        for (int i = 0; i < pa; i++) {
            if (r.nextDouble() < p.eye) {
                bb++;
                continue;
            }
            ab++;
            if (r.nextDouble() < p.contact * suppress) {
                h++;
                if (r.nextDouble() < p.power / p.contact) {
                    hr++;
                }
            }
        }
        return new int[]{pa, ab, h, hr, 0, bb, 0};
    }

    private static void distribute(List<int[]> lines, int total, int idx, java.util.function.ToIntFunction<int[]> weight,
                                   java.util.function.ToIntFunction<int[]> guaranteed, Random r) {
        int remaining = total;
        for (int[] l : lines) {
            int g = Math.min(guaranteed.applyAsInt(l), remaining);
            l[idx] += g;
            remaining -= g;
        }
        int guard = 0;
        while (remaining > 0 && guard++ < 500) {
            int sum = lines.stream().mapToInt(weight).sum();
            if (sum == 0) {
                lines.get(r.nextInt(lines.size()))[idx]++;
                remaining--;
                continue;
            }
            int target = r.nextInt(sum);
            for (int[] l : lines) {
                target -= weight.applyAsInt(l);
                if (target < 0) {
                    if (idx != 4 || l[idx] < l[2] + l[5]) {
                        l[idx]++;
                        remaining--;
                    }
                    break;
                }
            }
        }
    }

    private List<PitcherLine> pitchingLines(List<SimPlayer> staff, boolean home, int totalOuts, List<BatterLine> oppBatting,
                                            int lead, Random r, LocalDate date) {
        int hits = oppBatting.stream().mapToInt(BatterLine::h).sum();
        int walks = oppBatting.stream().mapToInt(BatterLine::bb).sum();
        int runs = oppBatting.stream().mapToInt(BatterLine::r).sum();

        SimPlayer sp = staff.get(0);
        int spOuts = (int) Math.round(sp.stamina + r.nextGaussian() * 3);
        spOuts = Math.max(6, Math.min(totalOuts - 3, spOuts));
        int spRuns = (int) Math.round(runs * Math.min(1, spOuts / (double) totalOuts * (0.8 + 0.4 * r.nextDouble())));
        if (spRuns >= 5) {
            spOuts = Math.min(spOuts, 12 + r.nextInt(4));
        }
        List<SimPlayer> pen = staff.subList(1, staff.size());
        int[] outs = new int[staff.size()];
        outs[0] = spOuts;
        int left = totalOuts - spOuts;
        for (int i = 1; i < staff.size(); i++) {
            int remainingPitchers = staff.size() - i;
            int o = i == staff.size() - 1 ? left : Math.max(1, Math.min(left - (remainingPitchers - 1), 2 + r.nextInt(4)));
            outs[i] = o;
            left -= o;
        }
        if (pen.isEmpty()) {
            outs[0] = totalOuts;
        }
        int[] runsBy = new int[staff.size()];
        runsBy[0] = Math.min(runs, spRuns);
        int rem = runs - runsBy[0];
        while (rem > 0) {
            int i = staff.size() == 1 ? 0 : 1 + r.nextInt(staff.size() - 1);
            runsBy[i]++;
            rem--;
        }
        List<PitcherLine> out = new ArrayList<>();
        int hLeft = hits, bbLeft = walks;
        boolean winning = lead > 0;
        for (int i = 0; i < staff.size(); i++) {
            SimPlayer p = staff.get(i);
            boolean last = i == staff.size() - 1;
            int h = last ? hLeft : Math.min(hLeft, (int) Math.round(hits * outs[i] / (double) totalOuts));
            int bb = last ? bbLeft : Math.min(bbLeft, (int) Math.round(walks * outs[i] / (double) totalOuts));
            hLeft -= h;
            bbLeft -= bb;
            int er = runsBy[i] - (runsBy[i] > 0 && r.nextDouble() < 0.12 ? 1 : 0);
            int k = 0;
            for (int j = 0; j < outs[i]; j++) {
                if (r.nextDouble() < p.kRate) {
                    k++;
                }
            }
            int sv = 0, hld = 0;
            if (i > 0 && winning) {
                if (last && lead <= 3 && outs[i] >= 3) {
                    sv = 1;
                } else if (!last && outs[i] >= 1 && r.nextDouble() < 0.7) {
                    hld = 1;
                }
            } else if (i > 0 && !last && lead > -3 && r.nextDouble() < 0.12) {
                hld = 1;
            }
            out.add(new PitcherLine(p.id, nameOn(p, date), home, i == 0, outs[i], h, bb, er, k, sv, hld));
        }
        return out;
    }

    // ------------------------------------------------------------------
    // 名單異動
    // ------------------------------------------------------------------

    enum Status { ACTIVE, MINORS, DELISTED, UNREGISTERED }

    record RosterEvent(LocalDate date, String playerId, Status to) {
    }

    private record NameChange(String playerId, LocalDate date, String newName) {
    }

    private final List<NameChange> nameChanges = new ArrayList<>();
    private final Map<String, int[]> idleWindows = new HashMap<>();

    private void buildEvents() {
        Random r = new Random(seed * 13 + 5);
        LocalDate preseason = seasonStart.minusDays(30);
        // 開季名單：每隊 4 人在二軍
        for (int t = 0; t < 6; t++) {
            for (SimPlayer p : players) {
                if (p.team != t) {
                    continue;
                }
                int idx = Integer.parseInt(p.id.substring(2)) - 1;
                boolean minors = idx == 6 || idx == 15 || idx == 18 || idx == 25;
                events.add(new RosterEvent(preseason, p.id, minors ? Status.MINORS : Status.ACTIVE));
            }
        }
        Map<String, Status> state = new HashMap<>();
        Map<String, LocalDate> since = new HashMap<>();
        for (RosterEvent e : events) {
            state.put(e.playerId(), e.to());
            since.put(e.playerId(), e.date());
        }
        LocalDate aug31 = LocalDate.of(year, 8, 31);
        for (LocalDate d = seasonStart.minusDays(3); !d.isAfter(seasonEnd); d = d.plusDays(1)) {
            long dayNo = d.toEpochDay() - seasonStart.toEpochDay();
            if (d.isEqual(aug31)) {
                // 註冊截止日：各隊大量補登錄新人（列二軍）
                for (int t = 0; t < 6; t++) {
                    for (int k = 0; k < 3; k++) {
                        Role role = k == 0 ? Role.RP : (k == 1 ? Role.IF : Role.OF);
                        SimPlayer np = newPlayer(t, role, false, d, r);
                        add(new RosterEvent(d, np.id, Status.MINORS), state, since);
                    }
                }
            }
            if (dayNo == 35) {
                // 富邦二軍洋投註銷，並註冊新洋投
                SimPlayer delisted = byId.get("940007");
                if (state.get(delisted.id) == Status.MINORS) {
                    add(new RosterEvent(d, delisted.id, Status.DELISTED), state, since);
                    SimPlayer np = newPlayer(3, Role.SP, true, d, r);
                    add(new RosterEvent(d, np.id, Status.MINORS), state, since);
                }
            }
            if (dayNo == 20) {
                // 統一一軍洋投下二軍（洋將 15 日後才能回歸）
                swap(1, byId.get("920002"), d, state, since, r);
                continue;
            }
            if (dayNo == 50) {
                SimPlayer p = byId.get("950020");
                nameChanges.add(new NameChange(p.id, d, p.name.charAt(0) + "子" + p.name.charAt(2)));
            }
            if (dayNo < 0 || d.getDayOfWeek() == DayOfWeek.MONDAY || r.nextDouble() > 0.35) {
                continue;
            }
            int team = r.nextInt(6);
            List<SimPlayer> candidates = players.stream()
                    .filter(p -> p.team == team && state.get(p.id) == Status.ACTIVE)
                    .filter(p -> !p.id.endsWith("0001") && !p.id.endsWith("0002"))
                    .toList();
            if (!candidates.isEmpty()) {
                swap(team, candidates.get(r.nextInt(candidates.size())), d, state, since, r);
            }
        }
        // 一軍未出賽：每隊一名主力野手、一名後援在一軍名單上但連續多日未上場
        for (int t = 0; t < 6; t++) {
            idleWindows.put(String.format("9%d%04d", t + 1, 21), new int[]{40 + t, 48 + t});
            idleWindows.put(String.format("9%d%04d", t + 1, 12), new int[]{70, 83});
        }
        events.sort(Comparator.comparing(RosterEvent::date));
    }

    private void swap(int team, SimPlayer down, LocalDate d, Map<String, Status> state, Map<String, LocalDate> since, Random r) {
        boolean pitcher = down.pitcher();
        List<SimPlayer> up = players.stream()
                .filter(p -> p.team == team && p.pitcher() == pitcher && state.get(p.id) == Status.MINORS)
                .filter(p -> !since.get(p.id).plusDays(p.foreign ? 15 : 10).isAfter(d))
                .filter(p -> !p.foreign || activeForeign(team, state) < 3 || down.foreign)
                .toList();
        if (up.isEmpty()) {
            return;
        }
        SimPlayer promoted = up.get(r.nextInt(up.size()));
        add(new RosterEvent(d, down.id, Status.MINORS), state, since);
        add(new RosterEvent(d, promoted.id, Status.ACTIVE), state, since);
    }

    private long activeForeign(int team, Map<String, Status> state) {
        return players.stream().filter(p -> p.team == team && p.foreign && state.get(p.id) == Status.ACTIVE).count();
    }

    private void add(RosterEvent e, Map<String, Status> state, Map<String, LocalDate> since) {
        events.add(e);
        state.put(e.playerId(), e.to());
        since.put(e.playerId(), e.date());
    }

    private Map<String, Status> statusOn(LocalDate date) {
        Map<String, Status> st = new HashMap<>();
        players.forEach(p -> st.put(p.id, Status.UNREGISTERED));
        for (RosterEvent e : events) {
            if (e.date().isAfter(date)) {
                break;
            }
            st.put(e.playerId(), e.to());
        }
        return st;
    }

    private boolean isIdle(SimPlayer p, LocalDate date) {
        int[] w = idleWindows.get(p.id);
        if (w == null) {
            return false;
        }
        long dayNo = date.toEpochDay() - seasonStart.toEpochDay();
        return dayNo >= w[0] && dayNo <= w[1];
    }

    private String nameOn(SimPlayer p, LocalDate date) {
        LocalDate d = date == null ? clock.today() : date;
        String name = p.name;
        for (NameChange c : nameChanges) {
            if (c.playerId().equals(p.id) && !c.date().isAfter(d)) {
                name = c.newName();
            }
        }
        return name;
    }

    @Override
    public RegistrationSnapshot fetchRegistration() {
        LocalDate today = clock.today();
        Map<String, Status> st = statusOn(today);
        List<SourcePlayer> registered = new ArrayList<>();
        Set<String> firstTeam = new HashSet<>();
        for (SimPlayer p : players) {
            Status s = st.get(p.id);
            if (s == Status.ACTIVE || s == Status.MINORS) {
                registered.add(new SourcePlayer(p.id, nameOn(p, today), TEAM_NAMES[p.team], listed(p), p.foreign));
                if (s == Status.ACTIVE) {
                    firstTeam.add(p.id);
                }
            }
        }
        return new RegistrationSnapshot(registered, firstTeam);
    }

    @Override
    public SourcePlayer fetchPlayerProfile(String cpblPlayerId) {
        SimPlayer p = byId.get(cpblPlayerId);
        return p == null ? null : new SourcePlayer(p.id, nameOn(p, clock.today()), TEAM_NAMES[p.team], listed(p), p.foreign);
    }

    private static String listed(SimPlayer p) {
        return switch (p.role) {
            case SP, RP -> "P";
            case C -> "C";
            case IF -> "IF";
            case OF -> "OF";
        };
    }
}
