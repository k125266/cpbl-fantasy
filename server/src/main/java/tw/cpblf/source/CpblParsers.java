package tw.cpblf.source;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.fasterxml.jackson.databind.JsonNode;

import tw.cpblf.common.Json;
import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.PitcherLine;
import tw.cpblf.source.SourceModels.SourceGame;

/**
 * cpbl.com.tw XHR 回應的白名單 parser（CPBLF-70）。
 *
 * <p>每個 parser 以明確列舉的欄位名讀取值，不保留原始 JSON、不做整頁擷取再篩選。
 * 欄位名來源與驗證狀態見 docs/m0-data-feasibility.md。
 */
public final class CpblParsers {

    private CpblParsers() {
    }

    /** /schedule/getgamedatas 讀取的欄位（已由 mcp-cpbl-statistics 原始碼佐證）。 */
    public static final Set<String> SCHEDULE_FIELDS = Set.of(
            "GameSno", "KindCode", "GameDate", "PreExeDate", "HomeTeamName", "VisitingTeamName",
            "IsGameStop", "PresentStatus", "HomeScore", "VisitingScore");

    /** /box/getlive 打擊列讀取的欄位（未驗證，需 CPBLF-1 確認）。 */
    public static final Set<String> BATTING_FIELDS = Set.of(
            "HitterAcnt", "HitterName", "VisitingHomeType", "DefendStation", "PlateAppearances",
            "HitCnt", "HittingCnt", "HomeRunCnt", "RunBattedINCnt", "ScoreCnt", "StealBaseOKCnt", "BasesONBallsCnt");

    /** /box/getlive 投球列讀取的欄位（未驗證，需 CPBLF-1 確認）。 */
    public static final Set<String> PITCHING_FIELDS = Set.of(
            "PitcherAcnt", "PitcherName", "VisitingHomeType", "InningPitchedCnt", "InningPitchedDiv3Cnt",
            "HittingCnt", "BasesONBallsCnt", "EarnedRunCnt", "StrikeOutCnt", "SaveOK", "ReliefPointCnt");

    public static List<SourceGame> parseSchedule(String body, ZoneId zone) {
        JsonNode root = Json.tree(body);
        JsonNode datas = root.get("GameDatas");
        if (datas == null) {
            throw new SourceStructureException("schedule 回應缺少 GameDatas");
        }
        JsonNode games = datas.isTextual() ? Json.tree(datas.asText("[]")) : datas;
        List<SourceGame> out = new ArrayList<>();
        for (JsonNode g : games) {
            requireFields(g, Set.of("GameSno", "GameDate", "HomeTeamName", "VisitingTeamName"), "schedule");
            LocalDate date = LocalDate.parse(text(g, "GameDate").substring(0, 10));
            String pre = text(g, "PreExeDate");
            Instant start = pre == null || pre.length() < 16 ? null
                    : LocalDateTime.parse(pre.substring(0, 19)).atZone(zone).toInstant();
            GameStatus status;
            if ("1".equals(text(g, "IsGameStop"))) {
                status = GameStatus.POSTPONED;
            } else if (g.path("PresentStatus").asInt(0) == 1) {
                status = GameStatus.FINAL;
            } else {
                status = GameStatus.SCHEDULED;
            }
            boolean fin = status == GameStatus.FINAL;
            out.add(new SourceGame(
                    date.getYear(),
                    text(g, "KindCode"),
                    g.get("GameSno").asInt(),
                    date,
                    start,
                    text(g, "HomeTeamName"),
                    text(g, "VisitingTeamName"),
                    status,
                    fin ? intOrNull(g, "HomeScore") : null,
                    fin ? intOrNull(g, "VisitingScore") : null));
        }
        return out;
    }

    public static BoxScore parseBoxScore(String body, GameStatus status) {
        JsonNode root = Json.tree(body);
        JsonNode batting = embedded(root, "BattingJson");
        JsonNode pitching = embedded(root, "PitchingJson");

        Map<String, BatterLine> batters = new java.util.LinkedHashMap<>();
        for (JsonNode b : batting) {
            requireFields(b, Set.of("HitterAcnt", "VisitingHomeType"), "batting");
            String id = text(b, "HitterAcnt");
            BatterLine line = new BatterLine(
                    id,
                    text(b, "HitterName"),
                    "2".equals(text(b, "VisitingHomeType")),
                    positions(text(b, "DefendStation")),
                    num(b, "PlateAppearances"), num(b, "HitCnt"), num(b, "ScoreCnt"), num(b, "HittingCnt"),
                    num(b, "HomeRunCnt"), num(b, "RunBattedINCnt"), num(b, "StealBaseOKCnt"), num(b, "BasesONBallsCnt"));
            // 同一球員換守位時官網可能分列，合併
            batters.merge(id, line, CpblParsers::mergeBatter);
        }

        List<PitcherLine> pitchers = new ArrayList<>();
        Set<Boolean> sidesWithStarter = new java.util.HashSet<>();
        for (JsonNode p : pitching) {
            requireFields(p, Set.of("PitcherAcnt", "VisitingHomeType", "InningPitchedCnt"), "pitching");
            boolean home = "2".equals(text(p, "VisitingHomeType"));
            // 各隊投球列的第一位即先發投手
            boolean started = sidesWithStarter.add(home);
            pitchers.add(new PitcherLine(
                    text(p, "PitcherAcnt"),
                    text(p, "PitcherName"),
                    home,
                    started,
                    IpConverter.outs(num(p, "InningPitchedCnt"), num(p, "InningPitchedDiv3Cnt")),
                    num(p, "HittingCnt"), num(p, "BasesONBallsCnt"), num(p, "EarnedRunCnt"), num(p, "StrikeOutCnt"),
                    num(p, "SaveOK") > 0 ? 1 : 0,
                    num(p, "ReliefPointCnt") > 0 ? 1 : 0));
        }
        int homeRuns = batters.values().stream().filter(BatterLine::home).mapToInt(BatterLine::r).sum();
        int awayRuns = batters.values().stream().filter(b -> !b.home()).mapToInt(BatterLine::r).sum();
        return new BoxScore(status, null, homeRuns, awayRuns, List.copyOf(batters.values()), pitchers);
    }

    private static BatterLine mergeBatter(BatterLine a, BatterLine b) {
        Set<String> pos = new LinkedHashSet<>();
        if (a.positions() != null && !a.positions().isEmpty()) pos.addAll(List.of(a.positions().split(",")));
        if (b.positions() != null && !b.positions().isEmpty()) pos.addAll(List.of(b.positions().split(",")));
        return new BatterLine(a.cpblPlayerId(), a.name(), a.home(), String.join(",", pos),
                a.pa() + b.pa(), a.ab() + b.ab(), a.r() + b.r(), a.h() + b.h(), a.hr() + b.hr(), a.rbi() + b.rbi(),
                a.sb() + b.sb(), a.bb() + b.bb());
    }

    private static final Map<Character, String> ZH_POSITIONS = new HashMap<>(Map.of(
            '投', "P", '捕', "C", '一', "1B", '二', "2B", '三', "3B",
            '游', "SS", '左', "LF", '中', "CF", '右', "RF", '指', "DH"));

    /** 守位字串轉為標準代碼。接受中文單字（「游」「左」）或英文代碼（"SS","LF"）；代打/代跑等不計守位。 */
    public static String positions(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        Set<String> out = new LinkedHashSet<>();
        String s = raw.trim().toUpperCase();
        for (String token : s.split("[,/、\\s]+")) {
            if (token.matches("1B|2B|3B|SS|LF|CF|RF|C|P|DH")) {
                out.add(token);
                continue;
            }
            if (token.startsWith("代")) {
                continue;
            }
            for (char c : token.toCharArray()) {
                String p = ZH_POSITIONS.get(c);
                if (p != null) {
                    out.add(p);
                }
            }
        }
        return String.join(",", out);
    }

    private static JsonNode embedded(JsonNode root, String field) {
        JsonNode n = root.get(field);
        if (n == null || n.isNull()) {
            throw new SourceStructureException("box score 回應缺少 " + field);
        }
        return n.isTextual() ? Json.tree(n.asText("[]")) : n;
    }

    private static void requireFields(JsonNode n, Set<String> fields, String ctx) {
        for (String f : fields) {
            if (!n.has(f)) {
                throw new SourceStructureException(ctx + " 列缺少欄位 " + f);
            }
        }
    }

    private static String text(JsonNode n, String f) {
        JsonNode v = n.get(f);
        return v == null || v.isNull() ? null : v.asText();
    }

    private static int num(JsonNode n, String f) {
        JsonNode v = n.get(f);
        return v == null || v.isNull() ? 0 : v.asInt(0);
    }

    private static Integer intOrNull(JsonNode n, String f) {
        JsonNode v = n.get(f);
        return v == null || v.isNull() ? null : v.asInt();
    }
}
