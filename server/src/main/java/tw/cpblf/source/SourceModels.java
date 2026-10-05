package tw.cpblf.source;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * 外部資料源的白名單資料結構（CPBLF-70）。
 * Parser 只能產出這些 record；任何不在此處的欄位（新聞、文字轉播、圖片…）沒有落地的路徑。
 */
public final class SourceModels {

    private SourceModels() {
    }

    public enum GameStatus { SCHEDULED, IN_PROGRESS, FINAL, POSTPONED, SUSPENDED, CANCELLED }

    public record SourceGame(
            int year,
            String kindCode,
            int gameSno,
            LocalDate date,
            Instant startTime,
            String homeTeamName,
            String awayTeamName,
            GameStatus status,
            Integer homeScore,
            Integer awayScore) {
    }

    /**
     * @param lineupSlot 棒次 1～9；資料源沒有時為 null
     * @param sub        替補（代打、代跑、守備替補），棒次沿用被替換的人
     */
    public record BatterLine(
            String cpblPlayerId,
            String name,
            boolean home,
            String positions,
            int pa, int ab, int r, int h, int hr, int rbi, int sb, int bb,
            Integer lineupSlot,
            boolean sub) {

        public BatterLine(String cpblPlayerId, String name, boolean home, String positions,
                          int pa, int ab, int r, int h, int hr, int rbi, int sb, int bb) {
            this(cpblPlayerId, name, home, positions, pa, ab, r, h, hr, rbi, sb, bb, null, false);
        }
    }

    public record PitcherLine(
            String cpblPlayerId,
            String name,
            boolean home,
            boolean started,
            int outs, int h, int bb, int er, int k, int sv, int hld, int w) {
    }

    /** @param detail 比賽頁的賽況細節；資料源沒有時為 null */
    public record BoxScore(
            GameStatus status,
            String inningText,
            Integer homeScore,
            Integer awayScore,
            List<BatterLine> batters,
            List<PitcherLine> pitchers,
            GameDetail detail) {

        public BoxScore(GameStatus status, String inningText, Integer homeScore, Integer awayScore,
                        List<BatterLine> batters, List<PitcherLine> pitchers) {
            this(status, inningText, homeScore, awayScore, batters, pitchers, null);
        }
    }

    /**
     * 比賽狀態細節（只取比賽狀態與逐打席結果代碼，不取文字轉播的敘述內容，見 docs/rulebook-amendments.md）。
     *
     * @param lineScore     逐局比分；頁面沒有時為 null
     * @param batterId      目前打者（進行中才有）
     * @param pitcherId     目前投手（進行中才有）
     * @param pitchCount    目前投手用球數
     * @param batterResults 目前打者本場已完成打席的結果代碼，例：[三振, 右飛]
     * @param halfInning    本半局已完成的打席（依順序），最後一位若正在打擊則 result 為 null
     */
    public record GameDetail(
            LineScore lineScore,
            String batterId,
            String pitcherId,
            Integer pitchCount,
            List<String> batterResults,
            List<PlateAppearance> halfInning) {
    }

    /** 逐局比分。未進行的局為 null；rhe 為得分、安打、失誤。 */
    public record LineScore(List<Integer> away, List<Integer> home, List<Integer> awayRhe, List<Integer> homeRhe) {
    }

    /** 半局中的一個打席：打者（背號、姓名，頁面上沒有連結）與結果代碼；正在打擊時 result 為 null。 */
    public record PlateAppearance(String jerseyNumber, String name, String result) {
    }

    /**
     * 60 人註冊名單中的一名球員。
     *
     * @param foreign      是否為外籍；無法判斷時為 null（由人工修正檔決定，見 PlayerOverrides）
     * @param originalName 原名（進階數據網站球員頁），洋將判斷與人工確認用；沒有時為 null
     */
    public record SourcePlayer(
            String cpblPlayerId,
            String name,
            String teamName,
            String listedPosition,
            Boolean foreign,
            String jerseyNumber,
            String originalName) {

        public SourcePlayer(String cpblPlayerId, String name, String teamName, String listedPosition, Boolean foreign,
                            String jerseyNumber) {
            this(cpblPlayerId, name, teamName, listedPosition, foreign, jerseyNumber, null);
        }
    }

    /** 某一時點的名單快照：60 人註冊名單 + 一軍登錄名單。 */
    public record RegistrationSnapshot(List<SourcePlayer> registered, java.util.Set<String> firstTeamIds) {
    }
}
