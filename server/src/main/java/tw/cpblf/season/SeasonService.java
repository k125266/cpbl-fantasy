package tw.cpblf.season;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tw.cpblf.common.ApiException;

/**
 * CPBLF-20：賽季結構。season_half → scoring_period（雙週）→ matchup。
 */
@Service
public class SeasonService {

    private final JdbcClient jdbc;

    public SeasonService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public record Half(long id, long leagueId, int halfNo, LocalDate startDate, LocalDate endDate, String status,
                       Long championTeamId) {
    }

    public record Period(long id, long halfId, int halfNo, int periodNo, String kind, LocalDate startDate, LocalDate endDate,
                         String status, java.time.OffsetDateTime locksAt) {
    }

    public record SetupRequest(LocalDate half1Start, LocalDate half1End, LocalDate half2Start, LocalDate half2End,
                               Integer periodDays, Integer finalDays) {
    }

    @Transactional
    public void setup(long leagueId, SetupRequest req) {
        int periodDays = req.periodDays() == null ? 14 : req.periodDays();
        int finalDays = req.finalDays() == null ? 14 : req.finalDays();
        if (req.half1Start() == null || req.half1End() == null || req.half2Start() == null || req.half2End() == null) {
            throw ApiException.badRequest("請填入上下半季起訖日");
        }
        if (!req.half1Start().isBefore(req.half1End()) || !req.half1End().isBefore(req.half2Start())
                || !req.half2Start().isBefore(req.half2End())) {
            throw ApiException.badRequest("半季日期順序不正確");
        }
        if (periodDays < 7 || finalDays < 7) {
            throw ApiException.badRequest("對戰期至少 7 天");
        }
        int started = jdbc.sql("""
                select count(*) from scoring_period sp join season_half h on h.id = sp.season_half_id
                where h.league_id = ? and sp.status <> 'UPCOMING'
                """).param(leagueId).query(Integer.class).single();
        if (started > 0) {
            throw ApiException.conflict("賽季已開始，無法重新產生賽程");
        }
        List<Long> teams = jdbc.sql("select id from fantasy_team where league_id = ? order by id").param(leagueId)
                .query(Long.class).list();
        if (teams.size() < 2) {
            throw ApiException.badRequest("至少需要 2 隊");
        }
        jdbc.sql("""
                delete from matchup where scoring_period_id in (
                  select sp.id from scoring_period sp join season_half h on h.id = sp.season_half_id where h.league_id = ?)
                """).param(leagueId).update();
        jdbc.sql("""
                delete from scoring_period where season_half_id in (select id from season_half where league_id = ?)
                """).param(leagueId).update();
        jdbc.sql("delete from season_half where league_id = ? and id not in (select season_half_id from draft)")
                .param(leagueId).update();

        long h1 = upsertHalf(leagueId, 1, req.half1Start(), req.half1End());
        long h2 = upsertHalf(leagueId, 2, req.half2Start(), req.half2End());

        List<LocalDate[]> p1 = split(req.half1Start(), req.half1End(), periodDays);
        LocalDate regularEnd2 = req.half2End().minusDays(finalDays);
        if (regularEnd2.isBefore(req.half2Start().plusDays(periodDays - 1))) {
            throw ApiException.badRequest("下半季長度不足以容納例行對戰期與總冠軍賽");
        }
        List<LocalDate[]> p2 = split(req.half2Start(), regularEnd2, periodDays);

        List<List<long[]>> rounds = ringRounds(teams);
        int roundIdx = 0;
        roundIdx = createPeriods(h1, p1, rounds, roundIdx);
        createPeriods(h2, p2, rounds, roundIdx);
        long finalId = jdbc.sql("""
                insert into scoring_period (season_half_id, period_no, kind, start_date, end_date)
                values (?, ?, 'FINAL', ?, ?) returning id
                """).params(h2, p2.size() + 1, regularEnd2.plusDays(1), req.half2End()).query(Long.class).single();
        jdbc.sql("insert into matchup (scoring_period_id) values (?)").param(finalId).update();
    }

    private long upsertHalf(long leagueId, int halfNo, LocalDate start, LocalDate end) {
        return jdbc.sql("""
                insert into season_half (league_id, half_no, start_date, end_date) values (?, ?, ?, ?)
                on conflict (league_id, half_no) do update set start_date = excluded.start_date, end_date = excluded.end_date,
                    status = 'UPCOMING', champion_team_id = null
                returning id
                """).params(leagueId, halfNo, start, end).query(Long.class).single();
    }

    private int createPeriods(long halfId, List<LocalDate[]> periods, List<List<long[]>> rounds, int roundIdx) {
        int no = 1;
        for (LocalDate[] p : periods) {
            long pid = jdbc.sql("""
                    insert into scoring_period (season_half_id, period_no, kind, start_date, end_date)
                    values (?, ?, 'REGULAR', ?, ?) returning id
                    """).params(halfId, no++, p[0], p[1]).query(Long.class).single();
            for (long[] pair : rounds.get(roundIdx % rounds.size())) {
                jdbc.sql("insert into matchup (scoring_period_id, team_a_id, team_b_id) values (?, ?, ?)")
                        .params(pid, pair[0], pair[1]).update();
            }
            roundIdx++;
        }
        return roundIdx;
    }

    /** 將區間切成 days 天一期；最後一段不足一半時併入前一期。 */
    static List<LocalDate[]> split(LocalDate start, LocalDate end, int days) {
        List<LocalDate[]> out = new ArrayList<>();
        LocalDate s = start;
        while (!s.isAfter(end)) {
            LocalDate e = s.plusDays(days - 1);
            if (e.isAfter(end)) {
                e = end;
            }
            out.add(new LocalDate[]{s, e});
            s = e.plusDays(1);
        }
        if (out.size() > 1) {
            LocalDate[] last = out.get(out.size() - 1);
            long len = last[1].toEpochDay() - last[0].toEpochDay() + 1;
            if (len < (days + 1) / 2) {
                out.remove(out.size() - 1);
                out.get(out.size() - 1)[1] = last[1];
            }
        }
        return out;
    }

    /**
     * 每期雙對手：隊伍排成一圈，每期與左右兩隊各打一場，沒有輪空。
     * 步距 k = 1…⌊(N−1)/2⌋ 輪流使用，每輪配對為 (t[j], t[j+k])，每隊各當一次 A 方、一次 B 方；
     * 跑完所有步距剛好每對隊伍各碰一次（5 隊：步距 1、2 交替，每兩期一個循環）。
     * 隊數為偶數時再補一輪對角配對（每隊 1 場），確保每對隊伍都會碰到；2 隊時即每期 1 場。
     */
    static List<List<long[]>> ringRounds(List<Long> teams) {
        int n = teams.size();
        List<List<long[]>> rounds = new ArrayList<>();
        for (int k = 1; k <= (n - 1) / 2; k++) {
            List<long[]> pairs = new ArrayList<>();
            for (int j = 0; j < n; j++) {
                pairs.add(new long[]{teams.get(j), teams.get((j + k) % n)});
            }
            rounds.add(pairs);
        }
        if (n % 2 == 0) {
            List<long[]> pairs = new ArrayList<>();
            for (int j = 0; j < n / 2; j++) {
                pairs.add(new long[]{teams.get(j), teams.get(j + n / 2)});
            }
            rounds.add(pairs);
        }
        return rounds;
    }

    // ------------------------------------------------------------------
    // 查詢
    // ------------------------------------------------------------------

    public List<Half> halves(long leagueId) {
        return jdbc.sql("""
                select id, league_id, half_no, start_date, end_date, status, champion_team_id
                from season_half where league_id = ? order by half_no
                """).param(leagueId).query((rs, n) -> {
            return new Half(rs.getLong(1), rs.getLong(2), rs.getInt(3), rs.getObject(4, LocalDate.class),
                    rs.getObject(5, LocalDate.class), rs.getString(6), rs.getObject(7, Long.class));
        }).list();
    }

    public List<Period> periods(long leagueId) {
        return jdbc.sql("""
                select sp.id, sp.season_half_id, h.half_no, sp.period_no, sp.kind, sp.start_date, sp.end_date, sp.status, sp.locks_at
                from scoring_period sp join season_half h on h.id = sp.season_half_id
                where h.league_id = ? order by sp.start_date
                """).param(leagueId).query((rs, n) -> new Period(rs.getLong(1), rs.getLong(2), rs.getInt(3), rs.getInt(4),
                rs.getString(5), rs.getObject(6, LocalDate.class), rs.getObject(7, LocalDate.class), rs.getString(8),
                rs.getObject(9, java.time.OffsetDateTime.class))).list();
    }

    public Optional<Period> periodOn(long leagueId, LocalDate date) {
        return periods(leagueId).stream()
                .filter(p -> !date.isBefore(p.startDate()) && !date.isAfter(p.endDate()))
                .findFirst();
    }

    /** 目前所屬半季；兩半季之間或開季前回傳下一個半季，季後回傳下半季。 */
    public Optional<Half> currentHalf(long leagueId, LocalDate date) {
        List<Half> hs = halves(leagueId);
        for (Half h : hs) {
            if (!date.isAfter(h.endDate())) {
                return Optional.of(h);
            }
        }
        return hs.isEmpty() ? Optional.empty() : Optional.of(hs.get(hs.size() - 1));
    }

    public record StandingRow(long teamId, String teamName, String abbr, String owner, int wins, int losses, int ties,
                              double pct, BigDecimal pointsFor, BigDecimal pointsAgainst, int provisional, int rank) {
    }

    /**
     * 半季戰績（勝敗和三欄）。排序：勝率 → 類別總得分 → 隊伍 id。
     * 只計已結束（provisional / locked）的例行對戰期。
     */
    public List<StandingRow> standings(long leagueId, int halfNo) {
        record Acc(long id, String name, String abbr, String owner, int[] wlt, BigDecimal[] pts, int[] prov) {
        }
        Map<Long, Acc> acc = new LinkedHashMap<>();
        jdbc.sql("""
                select t.id, t.name, t.abbr, u.display_name from fantasy_team t join app_user u on u.id = t.user_id
                where t.league_id = ? order by t.id
                """).param(leagueId).query((rs, n) -> acc.put(rs.getLong(1), new Acc(rs.getLong(1), rs.getString(2),
                rs.getString(3), rs.getString(4), new int[3], new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO}, new int[1])))
                .list();
        jdbc.sql("""
                select m.team_a_id, m.team_b_id, m.score_a, m.score_b, m.result, m.status
                from matchup m join scoring_period sp on sp.id = m.scoring_period_id
                join season_half h on h.id = sp.season_half_id
                where h.league_id = ? and h.half_no = ? and sp.kind = 'REGULAR'
                  and m.status in ('PROVISIONAL', 'LOCKED') and m.result is not null
                """).params(leagueId, halfNo).query((rs, n) -> {
            Acc a = acc.get(rs.getLong(1));
            Acc b = acc.get(rs.getLong(2));
            String result = rs.getString(5);
            boolean prov = "PROVISIONAL".equals(rs.getString(6));
            switch (result) {
                case "A_WIN" -> {
                    a.wlt()[0]++;
                    b.wlt()[1]++;
                }
                case "B_WIN" -> {
                    a.wlt()[1]++;
                    b.wlt()[0]++;
                }
                default -> {
                    a.wlt()[2]++;
                    b.wlt()[2]++;
                }
            }
            a.pts()[0] = a.pts()[0].add(rs.getBigDecimal(3));
            a.pts()[1] = a.pts()[1].add(rs.getBigDecimal(4));
            b.pts()[0] = b.pts()[0].add(rs.getBigDecimal(4));
            b.pts()[1] = b.pts()[1].add(rs.getBigDecimal(3));
            if (prov) {
                a.prov()[0]++;
                b.prov()[0]++;
            }
            return null;
        }).list();
        List<StandingRow> rows = new ArrayList<>();
        for (Acc a : acc.values()) {
            int g = a.wlt()[0] + a.wlt()[1] + a.wlt()[2];
            double pct = g == 0 ? 0 : (a.wlt()[0] + 0.5 * a.wlt()[2]) / g;
            rows.add(new StandingRow(a.id(), a.name(), a.abbr(), a.owner(), a.wlt()[0], a.wlt()[1], a.wlt()[2], pct, a.pts()[0],
                    a.pts()[1], a.prov()[0], 0));
        }
        rows.sort(Comparator.comparingDouble(StandingRow::pct).reversed()
                .thenComparing(StandingRow::pointsFor, Comparator.reverseOrder())
                .thenComparingLong(StandingRow::teamId));
        List<StandingRow> ranked = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            StandingRow r = rows.get(i);
            ranked.add(new StandingRow(r.teamId(), r.teamName(), r.abbr(), r.owner(), r.wins(), r.losses(), r.ties(), r.pct(),
                    r.pointsFor(), r.pointsAgainst(), r.provisional(), i + 1));
        }
        return ranked;
    }
}
