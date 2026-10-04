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

    public record BatterLine(
            String cpblPlayerId,
            String name,
            boolean home,
            String positions,
            int pa, int ab, int r, int h, int hr, int rbi, int sb, int bb) {
    }

    public record PitcherLine(
            String cpblPlayerId,
            String name,
            boolean home,
            boolean started,
            int outs, int h, int bb, int er, int k, int sv, int hld, int w) {
    }

    public record BoxScore(
            GameStatus status,
            String inningText,
            Integer homeScore,
            Integer awayScore,
            List<BatterLine> batters,
            List<PitcherLine> pitchers) {
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
