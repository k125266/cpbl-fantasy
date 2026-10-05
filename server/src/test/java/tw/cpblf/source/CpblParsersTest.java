package tw.cpblf.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;

import tw.cpblf.common.Json;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.GameStatus;

class CpblParsersTest {

    @Test
    void parsesScheduleWithEmbeddedJsonString() {
        String games = Json.write(List.of(
                java.util.Map.of("GameSno", 12, "KindCode", "A", "GameDate", "2026-04-01T00:00:00", "PreExeDate", "2026-04-01T18:35:00",
                        "HomeTeamName", "富邦悍將", "VisitingTeamName", "味全龍", "IsGameStop", "0", "PresentStatus", 1,
                        "HomeScore", 3, "VisitingScore", 3),
                java.util.Map.of("GameSno", 13, "KindCode", "A", "GameDate", "2026-04-01T00:00:00", "PreExeDate", "2026-04-01T18:35:00",
                        "HomeTeamName", "樂天桃猿", "VisitingTeamName", "台鋼雄鷹", "IsGameStop", "1", "PresentStatus", 0)));
        var out = CpblParsers.parseSchedule(Json.write(java.util.Map.of("GameDatas", games)), ZoneId.of("Asia/Taipei"));
        assertThat(out).hasSize(2);
        assertThat(out.get(0).status()).isEqualTo(GameStatus.FINAL);
        assertThat(out.get(0).homeScore()).isEqualTo(3);
        assertThat(out.get(1).status()).isEqualTo(GameStatus.POSTPONED);
        assertThat(out.get(1).homeScore()).isNull();
    }

    /** CPBLF-70：非白名單欄位（文字轉播、新聞、圖片）不會出現在解析結果中。 */
    @Test
    void boxScoreParserKeepsOnlyWhitelistedFields() {
        String batting = Json.write(List.of(java.util.Map.ofEntries(
                java.util.Map.entry("HitterAcnt", "0000001"), java.util.Map.entry("HitterName", "測試員"),
                java.util.Map.entry("VisitingHomeType", "2"), java.util.Map.entry("DefendStation", "游"),
                java.util.Map.entry("PlateAppearances", 4), java.util.Map.entry("HitCnt", 4), java.util.Map.entry("HittingCnt", 2),
                java.util.Map.entry("HomeRunCnt", 1), java.util.Map.entry("RunBattedINCnt", 2), java.util.Map.entry("ScoreCnt", 1),
                java.util.Map.entry("StealBaseOKCnt", 0), java.util.Map.entry("BasesONBallsCnt", 0),
                java.util.Map.entry("PlayerPhotoUrl", "https://example/photo.jpg"))));
        String pitching = Json.write(List.of(
                java.util.Map.of("PitcherAcnt", "0000002", "PitcherName", "先發", "VisitingHomeType", "1", "InningPitchedCnt", 6,
                        "InningPitchedDiv3Cnt", 1, "EarnedRunCnt", 3, "StrikeOutCnt", 7, "HittingCnt", 5, "BasesONBallsCnt", 2),
                java.util.Map.of("PitcherAcnt", "0000003", "PitcherName", "後援", "VisitingHomeType", "1", "InningPitchedCnt", 1,
                        "InningPitchedDiv3Cnt", 0, "EarnedRunCnt", 0, "ReliefPointCnt", 1)));
        String body = Json.write(java.util.Map.of("BattingJson", batting, "PitchingJson", pitching,
                "LiveLogJson", "[{\"Content\":\"文字轉播內容\"}]", "NewsContent", "新聞全文"));
        BoxScore box = CpblParsers.parseBoxScore(body, GameStatus.FINAL);

        assertThat(box.batters()).hasSize(1);
        assertThat(box.batters().get(0).positions()).isEqualTo("SS");
        assertThat(box.pitchers().get(0).started()).isTrue();
        assertThat(box.pitchers().get(0).outs()).isEqualTo(19);
        assertThat(box.pitchers().get(1).started()).isFalse();
        assertThat(box.pitchers().get(1).hld()).isEqualTo(1);
        // 結果物件的序列化內容不含任何非白名單資訊
        String serialized = Json.write(box);
        assertThat(serialized).doesNotContain("文字轉播", "新聞", "photo");
        // record 欄位就是落地的上限（lineupSlot、sub 為棒次與替補，2026-10 即時比分加入）
        assertThat(Arrays.stream(SourceModels.BatterLine.class.getRecordComponents()).map(c -> c.getName()))
                .containsExactly("cpblPlayerId", "name", "home", "positions", "pa", "ab", "r", "h", "hr", "rbi", "sb", "bb",
                        "lineupSlot", "sub");
        // 賽況細節同樣以 record 欄位為上限：比賽狀態與結果代碼，沒有任何敘述文字欄位
        assertThat(Arrays.stream(SourceModels.GameDetail.class.getRecordComponents()).map(c -> c.getName()))
                .containsExactly("lineScore", "batterId", "pitcherId", "pitchCount", "batterResults", "halfInning");
        assertThat(Arrays.stream(SourceModels.PlateAppearance.class.getRecordComponents()).map(c -> c.getName()))
                .containsExactly("jerseyNumber", "name", "result");
    }

    @Test
    void missingRequiredFieldIsStructureError() {
        String body = Json.write(java.util.Map.of("BattingJson", "[{\"HitterName\":\"x\"}]", "PitchingJson", "[]"));
        assertThatThrownBy(() -> CpblParsers.parseBoxScore(body, GameStatus.FINAL)).isInstanceOf(SourceStructureException.class);
    }

    @Test
    void positionNormalization() {
        assertThat(CpblParsers.positions("左")).isEqualTo("LF");
        assertThat(CpblParsers.positions("三,游")).isEqualTo("3B,SS");
        assertThat(CpblParsers.positions("代打")).isEmpty();
        assertThat(CpblParsers.positions("CF")).isEqualTo("CF");
    }
}
