package tw.cpblf.pipeline;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.PitcherLine;

/** 將 box score 轉成以內部 player_id 為 key 的 StatRow。遇到未知球員時丟出例外，不得靜默略過。 */
@Component
public class BoxScoreMapper {

    public static class UnknownPlayerException extends RuntimeException {
        public UnknownPlayerException(String message) {
            super(message);
        }
    }

    private final JdbcClient jdbc;

    public BoxScoreMapper(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Map<Long, StatRow> map(BoxScore box, String homeTeam, String awayTeam) {
        Map<String, Long> ids = new HashMap<>();
        jdbc.sql("select cpbl_player_id, id from player").query((rs, n) -> Map.entry(rs.getString(1), rs.getLong(2)))
                .list().forEach(e -> ids.put(e.getKey(), e.getValue()));
        Map<Long, StatRow> rows = new LinkedHashMap<>();
        for (BatterLine b : box.batters()) {
            long id = resolve(ids, b.cpblPlayerId(), b.name());
            String team = b.home() ? homeTeam : awayTeam;
            rows.put(id, rows.getOrDefault(id, StatRow.EMPTY).withBatting(team, b));
        }
        for (PitcherLine p : box.pitchers()) {
            long id = resolve(ids, p.cpblPlayerId(), p.name());
            String team = p.home() ? homeTeam : awayTeam;
            rows.put(id, rows.getOrDefault(id, StatRow.EMPTY).withPitching(team, p));
        }
        return rows;
    }

    private static long resolve(Map<String, Long> ids, String cpblId, String name) {
        Long id = ids.get(cpblId);
        if (id == null) {
            throw new UnknownPlayerException("未知球員 " + name + "（" + cpblId + "）");
        }
        return id;
    }
}
