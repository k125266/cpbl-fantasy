package tw.cpblf.live;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;

import tw.cpblf.common.Json;
import tw.cpblf.config.AppClock;
import tw.cpblf.config.AppProperties;

/**
 * 即時比分頁（設計稿「即時比分與通知」1a／1b）：今日中職比賽、上場球員數據、聯盟各隊先發。
 *
 * <p>進行中與尚未結算的比賽用即時快照（live_game_stat，非最終）；結算後改用 game_stat。
 * 順序（box score 出現順序）、棒次、替補一律取自即時快照。
 */
@Service
public class LiveService {

    public static final String NOTICE = "即時數據每 60 秒更新，非最終數據，僅供參考；正式對戰比分只採用賽後結算。";

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final AppProperties props;

    public LiveService(JdbcClient jdbc, AppClock clock, AppProperties props) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.props = props;
    }

    public record LiveView(String notice, LocalDate today, Long myTeamId, Long opponentTeamId,
                           List<LiveGame> games, List<LiveLine> lines, List<Starter> starters) {
    }

    /**
     * @param homeScore     進行中為即時比分，結束後為最終比分
     * @param lineScore     逐局比分 {away, home, awayRhe, homeRhe}；沒有時為 null
     * @param batterId      目前打者（player.id），進行中才有
     * @param batterResults 目前打者本場結果代碼
     * @param halfInning    本半局打席 [{jerseyNumber, name, result}]
     * @param sourceUrl     進階數據網站的這場比賽（來源標示）；模擬賽季為 null
     */
    public record LiveGame(long id, int sno, String status, boolean statsFinal, LocalDate scheduledDate, LocalDate playDate,
                           Instant startTime, String homeTeam, String awayTeam, Integer homeScore, Integer awayScore,
                           String inning, Instant fetchedAt, JsonNode lineScore, Long batterId, Long pitcherId,
                           Integer pitchCount, JsonNode batterResults, JsonNode halfInning, String sourceUrl,
                           String kindCode, boolean postseason) {
    }

    /**
     * 一位球員在一場比賽的數據。
     *
     * @param settled    true 為結算後的正式數據；false 為即時快照（非最終）
     * @param seq        box score 中的順序（打者依打序，再來投手依登板順序）
     * @param changedAt  數據最後一次變動的時間（「剛更新」）；正式數據為 null
     * @param fantasyTeamId 在本聯盟名單上的隊伍，不在名單上為 null
     * @param rosterSlot 名單位置（IF、OF、UTIL、SP、RP、BN、NA）
     * @param gameDayTeamId 比賽「當天」在本聯盟名單上的隊伍（不是今天的名單）；季後賽紀念卡依這個發卡
     */
    public record LiveLine(long gameId, long playerId, String name, String jerseyNumber, String cpblTeam,
                           String listedPosition, boolean home, boolean batted, boolean pitched, Integer lineupSlot,
                           boolean sub, int seq, int pa, int ab, int h, int r, int hr, int bb, int outs, int pH, int pBb,
                           int pEr, int pK, int w, int sv, boolean settled, Instant changedAt, Long fantasyTeamId,
                           String rosterSlot, Long gameDayTeamId) {
    }

    /** 聯盟各隊今天的先發（不含 BN、NA）。 */
    public record Starter(long playerId, String name, String jerseyNumber, String cpblTeam, String listedPosition,
                          long fantasyTeamId, String rosterSlot) {
    }

    public LiveView view(long leagueId, long userId) {
        LocalDate today = clock.today();
        Long myTeam = jdbc.sql("select id from fantasy_team where league_id = ? and user_id = ?").params(leagueId, userId)
                .query(Long.class).optional().orElse(null);
        Long opponent = myTeam == null ? null : jdbc.sql("""
                select case when m.team_a_id = ? then m.team_b_id else m.team_a_id end
                from matchup m join scoring_period sp on sp.id = m.scoring_period_id
                where (m.team_a_id = ? or m.team_b_id = ?) and sp.start_date <= ? and sp.end_date >= ?
                order by sp.start_date desc limit 1
                """).params(myTeam, myTeam, myTeam, today, today).query(Long.class).optional().orElse(null);
        return new LiveView(NOTICE, today, myTeam, opponent, games(today), lines(leagueId, today), starters(leagueId, today));
    }

    List<LiveGame> games(LocalDate d) {
        return games("g.play_date = :d or (g.scheduled_date = :d and g.status = 'POSTPONED')", Map.of("d", d));
    }

    /** @param where 加在 game g 上的條件（可用具名參數），例如某一天或某年某賽事 */
    List<LiveGame> games(String where, Map<String, ?> params) {
        String base = sourceBase();
        return jdbc.sql("""
                select g.id, g.season_year, g.kind_code, g.game_sno, g.status, g.stats_final, g.scheduled_date, g.play_date,
                       g.start_time, g.home_team_code, g.away_team_code,
                       case when g.status = 'FINAL' then g.home_score else coalesce(lg.home_score, g.home_score) end as home_score,
                       case when g.status = 'FINAL' then g.away_score else coalesce(lg.away_score, g.away_score) end as away_score,
                       case when g.status = 'IN_PROGRESS' then lg.inning_text end as inning, lg.fetched_at,
                       lg.line_score, lg.batter_player_id, lg.pitcher_player_id, lg.pitch_count, lg.batter_results, lg.half_inning
                from game g left join live_game lg on lg.game_id = g.id
                where %s
                order by g.start_time nulls last, g.game_sno
                """.formatted(where)).params(params).query((rs, n) -> {
            boolean live = "IN_PROGRESS".equals(rs.getString("status"));
            return new LiveGame(rs.getLong("id"), rs.getInt("game_sno"), rs.getString("status"), rs.getBoolean("stats_final"),
                    rs.getObject("scheduled_date", LocalDate.class), rs.getObject("play_date", LocalDate.class),
                    instant(rs.getTimestamp("start_time")), rs.getString("home_team_code"), rs.getString("away_team_code"),
                    (Integer) rs.getObject("home_score"), (Integer) rs.getObject("away_score"), rs.getString("inning"),
                    instant(rs.getTimestamp("fetched_at")), json(rs.getString("line_score")),
                    live ? (Long) rs.getObject("batter_player_id") : null, live ? (Long) rs.getObject("pitcher_player_id") : null,
                    live ? (Integer) rs.getObject("pitch_count") : null,
                    live ? json(rs.getString("batter_results")) : null, live ? json(rs.getString("half_inning")) : null,
                    base == null ? null : base + "/schedule/" + rs.getInt("season_year") + "-" + rs.getString("kind_code") + "-"
                            + rs.getInt("game_sno"),
                    // 季後賽只看即時比分，不結算（docs/decisions.md「賽季結構」）
                    rs.getString("kind_code"), !props.kindCode().equals(rs.getString("kind_code")));
        }).list();
    }

    List<LiveLine> lines(long leagueId, LocalDate d) {
        return lines(leagueId, "g.play_date = :d", Map.of("d", d), d);
    }

    /**
     * @param where      加在 game g 上的條件（可用具名參數）
     * @param rosterDate 幻想隊伍標記以這一天的名單為準
     */
    List<LiveLine> lines(long leagueId, String where, Map<String, ?> params, LocalDate rosterDate) {
        return jdbc.sql("""
                with src as (
                    select ls.game_id, ls.player_id, ls.team_code, ls.batted, ls.pitched, ls.pa, ls.ab, ls.h, ls.r, ls.hr, ls.bb,
                           ls.outs, ls.p_h, ls.p_bb, ls.p_er, ls.p_k, ls.w, ls.sv,
                           ls.box_seq, ls.lineup_slot, ls.is_sub, ls.changed_at, false as settled
                    from live_game_stat ls join game g on g.id = ls.game_id
                    where (%1$s) and not exists (select 1 from game_stat s where s.game_id = ls.game_id)
                    union all
                    select s.game_id, s.player_id, s.team_code, s.batted, s.pitched, s.pa, s.ab, s.h, s.r, s.hr, s.bb,
                           s.outs, s.p_h, s.p_bb, s.p_er, s.p_k, s.w, s.sv,
                           coalesce(ls.box_seq, 1000), ls.lineup_slot, coalesce(ls.is_sub, false), null, true
                    from game_stat s join game g on g.id = s.game_id
                    left join live_game_stat ls on ls.game_id = s.game_id and ls.player_id = s.player_id
                    where (%1$s)
                )
                select src.*, src.team_code = g.home_team_code as home, p.name, p.jersey_number, p.listed_position,
                       re.team_id as fantasy_team_id, re.slot as roster_slot, rg.team_id as game_day_team_id
                from src join game g on g.id = src.game_id join player p on p.id = src.player_id
                left join (roster_entry re join fantasy_team t on t.id = re.team_id and t.league_id = :league)
                       on re.player_id = src.player_id and re.valid_from <= :rosterDate
                      and (re.valid_to is null or re.valid_to > :rosterDate)
                left join (roster_entry rg join fantasy_team tg on tg.id = rg.team_id and tg.league_id = :league)
                       on rg.player_id = src.player_id and rg.valid_from <= g.play_date
                      and (rg.valid_to is null or rg.valid_to > g.play_date)
                order by g.start_time nulls last, src.game_id, src.team_code = g.home_team_code, not src.batted, src.box_seq,
                         p.name
                """.formatted(where)).params(params).param("rosterDate", rosterDate).param("league", leagueId)
                .query((rs, n) -> new LiveLine(
                rs.getLong("game_id"), rs.getLong("player_id"), rs.getString("name"), rs.getString("jersey_number"),
                rs.getString("team_code"), rs.getString("listed_position"), rs.getBoolean("home"), rs.getBoolean("batted"),
                rs.getBoolean("pitched"), (Integer) rs.getObject("lineup_slot"), rs.getBoolean("is_sub"), rs.getInt("box_seq"),
                rs.getInt("pa"), rs.getInt("ab"), rs.getInt("h"), rs.getInt("r"), rs.getInt("hr"), rs.getInt("bb"),
                rs.getInt("outs"), rs.getInt("p_h"), rs.getInt("p_bb"), rs.getInt("p_er"), rs.getInt("p_k"), rs.getInt("w"),
                rs.getInt("sv"), rs.getBoolean("settled"), instant(rs.getTimestamp("changed_at")),
                (Long) rs.getObject("fantasy_team_id"), rs.getString("roster_slot"), (Long) rs.getObject("game_day_team_id"))).list();
    }

    List<Starter> starters(long leagueId, LocalDate d) {
        return jdbc.sql("""
                select p.id, p.name, p.jersey_number, p.cpbl_team_code, p.listed_position, re.team_id, re.slot
                from roster_entry re join fantasy_team t on t.id = re.team_id and t.league_id = ?
                join player p on p.id = re.player_id
                where re.valid_from <= ? and (re.valid_to is null or re.valid_to > ?) and re.slot not in ('BN', 'NA')
                order by re.team_id, case re.slot when 'SP' then 1 when 'RP' then 1 else 0 end, re.slot, p.name
                """).params(leagueId, d, d).query((rs, n) -> new Starter(rs.getLong(1), rs.getString(2), rs.getString(3),
                rs.getString(4), rs.getString(5), rs.getLong(6), rs.getString(7))).list();
    }

    /** 進階數據網站（真實賽季與重播）才有來源連結；模擬賽季的比賽是虛構的。 */
    private String sourceBase() {
        return "stats".equals(props.source()) || props.isReplay() ? props.crawler().statsBaseUrl() : null;
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static JsonNode json(String s) {
        return s == null ? null : Json.tree(s);
    }
}
