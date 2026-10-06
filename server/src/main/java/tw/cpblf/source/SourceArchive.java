package tw.cpblf.source;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.core.type.TypeReference;

import tw.cpblf.common.Json;
import tw.cpblf.source.SourceModels.SourcePlayer;

/** 整季封存的存取（source_archive）。內容都是白名單 record，重播時由 ReplayDataSource 讀取。 */
@Component
public class SourceArchive {

    private final JdbcClient jdbc;

    public SourceArchive(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public static String gameKey(int year, String kindCode, int sno) {
        return year + "-" + kindCode + "-" + sno;
    }

    public void putGame(StatsSiteParsers.GamePage page) {
        var g = page.game();
        put("game", gameKey(g.year(), g.kindCode(), g.gameSno()), Json.write(page));
    }

    public void putPlayer(SourcePlayer p) {
        put("player", p.cpblPlayerId(), Json.write(p));
    }

    private void put(String kind, String key, String json) {
        jdbc.sql("""
                insert into source_archive (kind, key, payload, fetched_at) values (?, ?, ?::jsonb, now())
                on conflict (kind, key) do update set payload = excluded.payload, fetched_at = excluded.fetched_at
                """).params(kind, key, json).update();
    }

    /** 已封存且比賽已結束（不必再抓）。 */
    public boolean hasFinalGame(String key) {
        return jdbc.sql("select count(*) from source_archive where kind = 'game' and key = ? and payload -> 'game' ->> 'status' = 'FINAL'")
                .param(key).query(Integer.class).single() > 0;
    }

    public boolean hasPlayer(String cpblId) {
        return jdbc.sql("select count(*) from source_archive where kind = 'player' and key = ?").param(cpblId)
                .query(Integer.class).single() > 0;
    }

    /** 已封存且有個人頁的原名（洋將判斷依據）；沒有的話封存時要重抓個人頁。 */
    public boolean hasProfile(String cpblId) {
        return jdbc.sql("select count(*) from source_archive where kind = 'player' and key = ? and payload ->> 'originalName' is not null")
                .param(cpblId).query(Integer.class).single() > 0;
    }

    /** 某一年的封存比賽（參考季與當季分開讀，重播不會讀到參考季）。 */
    public List<StatsSiteParsers.GamePage> games(int year) {
        return jdbc.sql("select payload::text from source_archive where kind = 'game' and key like ?").param(year + "-%")
                .query(String.class).list().stream()
                .map(s -> Json.read(s, new TypeReference<StatsSiteParsers.GamePage>() { })).toList();
    }

    public int countGames(int year) {
        return jdbc.sql("select count(*) from source_archive where kind = 'game' and key like ?").param(year + "-%")
                .query(Integer.class).single();
    }

    public List<SourcePlayer> players() {
        return jdbc.sql("select payload::text from source_archive where kind = 'player' order by key").query(String.class).list().stream()
                .map(s -> Json.read(s, new TypeReference<SourcePlayer>() { })).toList();
    }

    /**
     * 依封存建議的賽季日期：開幕日、上半季結束（第 180 號比賽的日期，6 隊各 60 場）、下半季開始（隔天）、季末。
     * 封存是空的時，各值為 null。
     */
    public Map<String, LocalDate> suggestedSeason(int year, String kindCode) {
        String prefix = year + "-" + kindCode + "-";
        Map<String, Object> row = jdbc.sql("""
                select min((payload -> 'game' ->> 'date')::date) as opening,
                       max((payload -> 'game' ->> 'date')::date) as season_end,
                       max(case when key = ? then (payload -> 'game' ->> 'date')::date end) as half1_end
                from source_archive where kind = 'game' and key like ?
                """).params(prefix + HALF1_LAST_SNO, prefix + "%").query().singleRow();
        Map<String, LocalDate> out = new LinkedHashMap<>();
        LocalDate half1End = toDate(row.get("half1_end"));
        out.put("opening", toDate(row.get("opening")));
        out.put("half1End", half1End);
        out.put("half2Start", half1End == null ? null : half1End.plusDays(1));
        out.put("seasonEnd", toDate(row.get("season_end")));
        return out;
    }

    /** 中職一軍例行賽每半季 180 場（6 隊各 60 場）。 */
    static final int HALF1_LAST_SNO = 180;

    private static LocalDate toDate(Object o) {
        return o == null ? null : o instanceof java.sql.Date d ? d.toLocalDate() : LocalDate.parse(o.toString());
    }

    public int count(String kind) {
        return jdbc.sql("select count(*) from source_archive where kind = ?").param(kind).query(Integer.class).single();
    }
}
