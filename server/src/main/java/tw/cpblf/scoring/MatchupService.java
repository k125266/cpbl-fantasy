package tw.cpblf.scoring;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tw.cpblf.common.Json;
import tw.cpblf.config.AppClock;
import tw.cpblf.league.NotificationService;
import tw.cpblf.season.SeasonService;

/**
 * CPBLF-23：對戰判定、provisional 緩衝期與鎖定、半季冠軍與總冠軍。
 */
@Service
public class MatchupService {

    private static final Logger log = LoggerFactory.getLogger(MatchupService.class);

    private final JdbcClient jdbc;
    private final ScoringService scoring;
    private final SeasonService season;
    private final AppClock clock;
    private final NotificationService notifications;

    public MatchupService(JdbcClient jdbc, ScoringService scoring, SeasonService season, AppClock clock,
                          NotificationService notifications) {
        this.jdbc = jdbc;
        this.scoring = scoring;
        this.season = season;
        this.clock = clock;
        this.notifications = notifications;
    }

    record PeriodRow(long id, long leagueId, String kind, LocalDate start, LocalDate end, String status, Instant locksAt,
                     int lockHours) {
    }

    record MatchupRow(long id, Long a, Long b, String status, String result, java.math.BigDecimal scoreA,
                      java.math.BigDecimal scoreB) {
    }

    private List<PeriodRow> allPeriods() {
        return jdbc.sql("""
                select sp.id, h.league_id, sp.kind, sp.start_date, sp.end_date, sp.status, sp.locks_at, l.matchup_lock_hours
                from scoring_period sp join season_half h on h.id = sp.season_half_id join league l on l.id = h.league_id
                order by sp.start_date
                """).query((rs, n) -> new PeriodRow(rs.getLong(1), rs.getLong(2), rs.getString(3),
                rs.getObject(4, LocalDate.class), rs.getObject(5, LocalDate.class), rs.getString(6),
                rs.getTimestamp(7) == null ? null : rs.getTimestamp(7).toInstant(), rs.getInt(8))).list();
    }

    /** 推進所有對戰期狀態並重算進行中 / 緩衝期中的對戰。可重複執行。 */
    @Transactional
    public void progress() {
        Instant now = clock.now();
        LocalDate today = clock.today();
        for (PeriodRow p : allPeriods()) {
            String status = p.status();
            if ("UPCOMING".equals(status) && !today.isBefore(p.start())) {
                status = setStatus(p, "ACTIVE", null);
            }
            if ("ACTIVE".equals(status) && today.isAfter(p.end())) {
                Instant locksAt = clock.atStartOfDay(p.end().plusDays(1)).plus(Duration.ofHours(p.lockHours()));
                recompute(p);
                status = setStatus(p, "PROVISIONAL", locksAt);
                p = new PeriodRow(p.id(), p.leagueId(), p.kind(), p.start(), p.end(), status, locksAt, p.lockHours());
            }
            if ("ACTIVE".equals(status) || "PROVISIONAL".equals(status)) {
                recompute(p);
            }
            if ("PROVISIONAL".equals(status) && p.locksAt() != null && !now.isBefore(p.locksAt())) {
                lock(p);
            }
        }
        for (Long leagueId : jdbc.sql("select id from league").query(Long.class).list()) {
            updateHalves(leagueId, today);
        }
    }

    private String setStatus(PeriodRow p, String status, Instant locksAt) {
        jdbc.sql("update scoring_period set status = ?, locks_at = coalesce(?, locks_at) where id = ?")
                .params(status, locksAt == null ? null : Timestamp.from(locksAt), p.id()).update();
        String matchupStatus = switch (status) {
            case "ACTIVE" -> "LIVE";
            case "PROVISIONAL" -> "PROVISIONAL";
            default -> "PENDING";
        };
        jdbc.sql("update matchup set status = ?, updated_at = now() where scoring_period_id = ? and status <> 'LOCKED'")
                .params(matchupStatus, p.id()).update();
        return status;
    }

    private void lock(PeriodRow p) {
        recompute(p);
        jdbc.sql("update scoring_period set status = 'LOCKED' where id = ?").param(p.id()).update();
        jdbc.sql("""
                update matchup set status = 'LOCKED', locked_at = ?, updated_at = now()
                where scoring_period_id = ? and status <> 'LOCKED'
                """).params(Timestamp.from(clock.now()), p.id()).update();
        log.info("scoring period {} locked", p.id());
    }

    /** 數據修正後重算涉及這些日期的對戰期（包含已鎖定者，但鎖定者只更新統計）。 */
    @Transactional
    public void recomputeForDates(Collection<LocalDate> dates) {
        if (dates.isEmpty()) {
            return;
        }
        for (PeriodRow p : allPeriods()) {
            if ("UPCOMING".equals(p.status())) {
                continue;
            }
            boolean hit = dates.stream().anyMatch(d -> !d.isBefore(p.start()) && !d.isAfter(p.end()));
            if (hit) {
                recompute(p);
            }
        }
    }

    void recompute(PeriodRow p) {
        List<MatchupRow> ms = jdbc.sql("""
                select id, team_a_id, team_b_id, status, result, score_a, score_b from matchup where scoring_period_id = ?
                """).param(p.id()).query((rs, n) -> {
            long a = rs.getLong(2);
            Long ta = rs.wasNull() ? null : a;
            long b = rs.getLong(3);
            Long tb = rs.wasNull() ? null : b;
            return new MatchupRow(rs.getLong(1), ta, tb, rs.getString(4), rs.getString(5), rs.getBigDecimal(6),
                    rs.getBigDecimal(7));
        }).list();
        for (MatchupRow m : ms) {
            if (m.a() == null || m.b() == null) {
                continue;
            }
            StatTotals ta = scoring.teamTotals(m.a(), p.start(), p.end());
            StatTotals tb = scoring.teamTotals(m.b(), p.start(), p.end());
            MatchupScorer.Score s = MatchupScorer.score(ta, tb);
            String categories = Json.write(s.categories());
            if ("LOCKED".equals(m.status())) {
                // 48 小時後鎖定：只更新統計，不變更勝負，並加註說明（規則書 9.3）
                String note = null;
                if (!s.result().name().equals(m.result()) || s.scoreA().compareTo(m.scoreA()) != 0) {
                    note = "鎖定後數據修正：依修正後數據為 " + s.scoreA() + " : " + s.scoreB() + "，勝負維持鎖定時結果";
                }
                jdbc.sql("update matchup set categories = ?, note = coalesce(?, note), updated_at = now() where id = ?")
                        .params(categories, note, m.id()).update();
            } else {
                jdbc.sql("""
                        update matchup set categories = ?, score_a = ?, score_b = ?, result = ?, updated_at = now() where id = ?
                        """).params(categories, s.scoreA(), s.scoreB(), s.result().name(), m.id()).update();
            }
        }
    }

    // ------------------------------------------------------------------
    // 半季冠軍、總冠軍
    // ------------------------------------------------------------------

    private void updateHalves(long leagueId, LocalDate today) {
        for (SeasonService.Half h : season.halves(leagueId)) {
            if ("UPCOMING".equals(h.status()) && !today.isBefore(h.startDate())) {
                jdbc.sql("update season_half set status = 'ACTIVE' where id = ?").param(h.id()).update();
            }
            if (h.championTeamId() != null) {
                continue;
            }
            int regular = jdbc.sql("select count(*) from scoring_period where season_half_id = ? and kind = 'REGULAR'")
                    .param(h.id()).query(Integer.class).single();
            int locked = jdbc.sql("""
                    select count(*) from scoring_period where season_half_id = ? and kind = 'REGULAR' and status = 'LOCKED'
                    """).param(h.id()).query(Integer.class).single();
            if (regular == 0 || locked < regular) {
                continue;
            }
            List<SeasonService.StandingRow> st = season.standings(leagueId, h.halfNo());
            if (st.isEmpty()) {
                continue;
            }
            long champ = st.get(0).teamId();
            jdbc.sql("update season_half set champion_team_id = ?, status = 'COMPLETED' where id = ?").params(champ, h.id()).update();
            notifications.notifyLeague(leagueId, (h.halfNo() == 1 ? "上" : "下") + "半季冠軍：" + st.get(0).teamName());
        }
        resolveChampionship(leagueId);
    }

    private void resolveChampionship(long leagueId) {
        List<SeasonService.Half> hs = season.halves(leagueId);
        if (hs.size() < 2 || hs.get(0).championTeamId() == null || hs.get(1).championTeamId() == null) {
            return;
        }
        Long existing = jdbc.sql("select champion_team_id from league where id = ?").param(leagueId)
                .query(Long.class).optional().orElse(null);
        if (existing != null) {
            return;
        }
        long c1 = hs.get(0).championTeamId();
        long c2 = hs.get(1).championTeamId();
        if (c1 == c2) {
            setChampion(leagueId, c1, "同時奪得上下半季冠軍，直接獲得年度總冠軍");
            return;
        }
        record Final(long periodId, long matchupId, Long a, String status, String result) {
        }
        Final f = jdbc.sql("""
                select sp.id, m.id, m.team_a_id, sp.status, m.result
                from scoring_period sp join season_half h on h.id = sp.season_half_id join matchup m on m.scoring_period_id = sp.id
                where h.league_id = ? and sp.kind = 'FINAL'
                """).param(leagueId).query((rs, n) -> {
            return new Final(rs.getLong(1), rs.getLong(2), rs.getObject(3, Long.class), rs.getString(4), rs.getString(5));
        }).optional().orElse(null);
        if (f == null) {
            return;
        }
        if (f.a() == null) {
            // 總冠軍賽的計分以 effective-dated roster 回溯計算，因此即使在期間開始後才確定對戰組合也不影響結果
            jdbc.sql("update matchup set team_a_id = ?, team_b_id = ? where id = ?").params(c1, c2, f.matchupId()).update();
            notifications.notifyLeague(leagueId, "總冠軍賽對戰組合確定");
            PeriodRow p = allPeriods().stream().filter(x -> x.id() == f.periodId()).findFirst().orElseThrow();
            if (!"UPCOMING".equals(p.status())) {
                recompute(p);
            }
            return;
        }
        if ("LOCKED".equals(f.status()) && f.result() != null) {
            switch (f.result()) {
                case "A_WIN" -> setChampion(leagueId, c1, "總冠軍賽勝出");
                case "B_WIN" -> setChampion(leagueId, c2, "總冠軍賽勝出");
                default -> {
                    long winner = tiebreak(leagueId, c1, c2);
                    setChampion(leagueId, winner, "總冠軍賽和局，以全季例行對戰勝率較高者獲勝");
                }
            }
        }
    }

    private long tiebreak(long leagueId, long c1, long c2) {
        double p1 = 0, p2 = 0;
        int g1 = 0, g2 = 0;
        for (int half = 1; half <= 2; half++) {
            for (SeasonService.StandingRow r : season.standings(leagueId, half)) {
                int g = r.wins() + r.losses() + r.ties();
                double w = r.wins() + 0.5 * r.ties();
                if (r.teamId() == c1) {
                    p1 += w;
                    g1 += g;
                } else if (r.teamId() == c2) {
                    p2 += w;
                    g2 += g;
                }
            }
        }
        double pct1 = g1 == 0 ? 0 : p1 / g1;
        double pct2 = g2 == 0 ? 0 : p2 / g2;
        // 仍平手時由上半季冠軍獲勝
        return pct2 > pct1 ? c2 : c1;
    }

    private void setChampion(long leagueId, long teamId, String note) {
        jdbc.sql("update league set champion_team_id = ?, champion_note = ? where id = ?").params(teamId, note, leagueId).update();
        String name = jdbc.sql("select name from fantasy_team where id = ?").param(teamId).query(String.class).single();
        notifications.notifyLeague(leagueId, "年度總冠軍：" + name + "（" + note + "）");
    }

    // ------------------------------------------------------------------
    // 查詢
    // ------------------------------------------------------------------

    public record MatchupView(long id, long periodId, int halfNo, int periodNo, String kind, LocalDate start, LocalDate end,
                              Long teamA, String teamAName, Long teamB, String teamBName, java.math.BigDecimal scoreA,
                              java.math.BigDecimal scoreB, String result, String status, OffsetDateTime locksAt,
                              List<MatchupScorer.CategoryResult> categories, String note) {
    }

    public List<MatchupView> list(long leagueId) {
        return jdbc.sql("""
                select m.id, sp.id, h.half_no, sp.period_no, sp.kind, sp.start_date, sp.end_date,
                       m.team_a_id, ta.name, m.team_b_id, tb.name, m.score_a, m.score_b, m.result, m.status, sp.locks_at,
                       m.categories, m.note
                from matchup m join scoring_period sp on sp.id = m.scoring_period_id
                join season_half h on h.id = sp.season_half_id
                left join fantasy_team ta on ta.id = m.team_a_id left join fantasy_team tb on tb.id = m.team_b_id
                where h.league_id = ? order by sp.start_date, m.id
                """).param(leagueId).query((rs, n) -> {
            long a = rs.getLong(8);
            Long ta = rs.wasNull() ? null : a;
            long b = rs.getLong(10);
            Long tb = rs.wasNull() ? null : b;
            String cats = rs.getString(17);
            return new MatchupView(rs.getLong(1), rs.getLong(2), rs.getInt(3), rs.getInt(4), rs.getString(5),
                    rs.getObject(6, LocalDate.class), rs.getObject(7, LocalDate.class), ta, rs.getString(9), tb,
                    rs.getString(11), rs.getBigDecimal(12), rs.getBigDecimal(13), rs.getString(14), rs.getString(15),
                    rs.getObject(16, OffsetDateTime.class),
                    cats == null ? List.of() : Json.read(cats, new com.fasterxml.jackson.core.type.TypeReference<>() {
                    }), rs.getString(18));
        }).list();
    }
}
