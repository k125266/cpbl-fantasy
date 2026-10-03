package tw.cpblf.pipeline;

import java.util.LinkedHashMap;
import java.util.Map;

import tw.cpblf.source.SourceModels.BatterLine;
import tw.cpblf.source.SourceModels.PitcherLine;

/** 單一球員單場的計分數據（打擊 + 投球合併）。 */
public record StatRow(
        String teamCode,
        boolean batted, String positions, int pa, int ab, int r, int h, int hr, int rbi, int sb, int bb,
        boolean pitched, boolean started, int outs, int pH, int pBb, int pEr, int pK, int sv, int hld, int w) {

    public static final StatRow EMPTY = new StatRow(null, false, "", 0, 0, 0, 0, 0, 0, 0, 0, false, false, 0, 0, 0, 0, 0, 0, 0, 0);

    public StatRow withBatting(String team, BatterLine b) {
        return new StatRow(team, true, b.positions() == null ? "" : b.positions(), b.pa(), b.ab(), b.r(), b.h(), b.hr(), b.rbi(),
                b.sb(), b.bb(), pitched, started, outs, pH, pBb, pEr, pK, sv, hld, w);
    }

    public StatRow withPitching(String team, PitcherLine p) {
        return new StatRow(teamCode == null ? team : teamCode, batted, positions, pa, ab, r, h, hr, rbi, sb, bb,
                true, p.started(), p.outs(), p.h(), p.bb(), p.er(), p.k(), p.sv(), p.hld(), p.w());
    }

    /** 比較用：不含 team_code 的計分欄位。 */
    public Map<String, Object> values() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("batted", batted);
        m.put("positions", positions == null ? "" : positions);
        m.put("pa", pa);
        m.put("ab", ab);
        m.put("r", r);
        m.put("h", h);
        m.put("hr", hr);
        m.put("rbi", rbi);
        m.put("sb", sb);
        m.put("bb", bb);
        m.put("pitched", pitched);
        m.put("started", started);
        m.put("outs", outs);
        m.put("p_h", pH);
        m.put("p_bb", pBb);
        m.put("p_er", pEr);
        m.put("p_k", pK);
        m.put("sv", sv);
        m.put("hld", hld);
        m.put("w", w);
        return m;
    }

    public static StatRow fromResultSet(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new StatRow(rs.getString("team_code"), rs.getBoolean("batted"),
                rs.getString("positions") == null ? "" : rs.getString("positions"),
                rs.getInt("pa"), rs.getInt("ab"), rs.getInt("r"), rs.getInt("h"), rs.getInt("hr"), rs.getInt("rbi"),
                rs.getInt("sb"), rs.getInt("bb"), rs.getBoolean("pitched"), rs.getBoolean("started"), rs.getInt("outs"),
                rs.getInt("p_h"), rs.getInt("p_bb"), rs.getInt("p_er"), rs.getInt("p_k"), rs.getInt("sv"), rs.getInt("hld"), rs.getInt("w"));
    }
}
