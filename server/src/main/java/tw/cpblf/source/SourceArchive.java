package tw.cpblf.source;

import java.util.List;

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

    public List<StatsSiteParsers.GamePage> games() {
        return jdbc.sql("select payload::text from source_archive where kind = 'game'").query(String.class).list().stream()
                .map(s -> Json.read(s, new TypeReference<StatsSiteParsers.GamePage>() { })).toList();
    }

    public List<SourcePlayer> players() {
        return jdbc.sql("select payload::text from source_archive where kind = 'player' order by key").query(String.class).list().stream()
                .map(s -> Json.read(s, new TypeReference<SourcePlayer>() { })).toList();
    }

    public int count(String kind) {
        return jdbc.sql("select count(*) from source_archive where kind = ?").param(kind).query(Integer.class).single();
    }
}
