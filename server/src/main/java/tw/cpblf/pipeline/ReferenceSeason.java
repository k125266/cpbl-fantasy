package tw.cpblf.pipeline;

import java.util.HashMap;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tw.cpblf.source.SourceArchive;
import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.GameStatus;
import tw.cpblf.source.SourceModels.PitcherLine;
import tw.cpblf.source.StatsSiteParsers;

/**
 * 選秀參考季（docs/rulebook-amendments.md「6.5 選秀參考數據」）：把封存的上一季 box score 彙總成 reference_stat。
 * 只收本季 player 表裡有的球員（依官網球員 ID 對應）；只用於選秀室，不影響計分與季中排名。
 */
@Service
public class ReferenceSeason {

    public static final String JOB = "reference-archive";

    private final SourceArchive archive;
    private final JdbcClient jdbc;

    public ReferenceSeason(SourceArchive archive, JdbcClient jdbc) {
        this.archive = archive;
        this.jdbc = jdbc;
    }

    /** 每位球員的累計（與 reference_stat 欄位對應）。 */
    static final class Acc {
        int games, pa, ab, h, r, hr, bb, gBat, outs, ph, pbb, er, k, w, sv, qs, gPit, gs;
    }

    @Transactional
    public int rebuild(int year) {
        Map<String, Long> ids = new HashMap<>();
        jdbc.sql("select cpbl_player_id, id from player").query(rs -> {
            ids.put(rs.getString(1), rs.getLong(2));
        });
        Map<Long, Acc> acc = new HashMap<>();
        for (StatsSiteParsers.GamePage page : archive.games(year)) {
            if (page.box().status() != GameStatus.FINAL) {
                continue;
            }
            java.util.Set<Long> appeared = new java.util.HashSet<>();
            java.util.Set<Long> batted = new java.util.HashSet<>();
            java.util.Set<Long> pitched = new java.util.HashSet<>();
            for (BatterLine b : page.box().batters()) {
                Long id = ids.get(b.cpblPlayerId());
                if (id == null) continue;
                Acc a = acc.computeIfAbsent(id, x -> new Acc());
                a.pa += b.pa();
                a.ab += b.ab();
                a.h += b.h();
                a.r += b.r();
                a.hr += b.hr();
                a.bb += b.bb();
                appeared.add(id);
                batted.add(id);
            }
            for (PitcherLine p : page.box().pitchers()) {
                Long id = ids.get(p.cpblPlayerId());
                if (id == null) continue;
                Acc a = acc.computeIfAbsent(id, x -> new Acc());
                a.outs += p.outs();
                a.ph += p.h();
                a.pbb += p.bb();
                a.er += p.er();
                a.k += p.k();
                a.w += p.w();
                a.sv += p.sv();
                if (p.started() && p.outs() >= 18 && p.er() <= 3) a.qs++;
                if (p.started()) a.gs++;
                appeared.add(id);
                pitched.add(id);
            }
            appeared.forEach(id -> acc.get(id).games++);
            batted.forEach(id -> acc.get(id).gBat++);
            pitched.forEach(id -> acc.get(id).gPit++);
        }
        jdbc.sql("delete from reference_stat where season_year = ?").param(year).update();
        acc.forEach((id, a) -> jdbc.sql("""
                insert into reference_stat (season_year, player_id, games, pa, ab, h, r, hr, bb, g_bat, outs, p_h, p_bb, p_er, p_k,
                                            w, sv, qs, g_pit, gs)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """).params(year, id, a.games, a.pa, a.ab, a.h, a.r, a.hr, a.bb, a.gBat, a.outs, a.ph, a.pbb, a.er, a.k,
                a.w, a.sv, a.qs, a.gPit, a.gs).update());
        return acc.size();
    }

    public int players(int year) {
        return jdbc.sql("select count(*) from reference_stat where season_year = ?").param(year).query(Integer.class).single();
    }
}
