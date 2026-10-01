package tw.cpblf.league;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import tw.cpblf.config.AppClock;
import tw.cpblf.roster.PlayerStatusService;
import tw.cpblf.roster.RosterService;

/**
 * 球員動態：全部由比賽數據、名單異動與聯盟交易自動產生的事實描述。
 * 不擷取任何新聞內容，也不推測傷況（規則書 6.1.3、10.2）。
 */
@Service
public class FeedService {

    public enum Kind { HOT, MOVE, GAME, LEAGUE }

    public record FeedItem(Kind kind, Long playerId, String playerName, String cpblTeam, String jerseyNumber, String text,
                           OffsetDateTime at, boolean live) {
    }

    private final JdbcClient jdbc;
    private final AppClock clock;
    private final RosterService roster;
    private final PlayerStatusService statuses;
    private final LeagueService leagues;

    public FeedService(JdbcClient jdbc, AppClock clock, RosterService roster, PlayerStatusService statuses, LeagueService leagues) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.roster = roster;
        this.statuses = statuses;
        this.leagues = leagues;
    }

    record P(long id, String name, String team, String no) {
    }

    private String shortName(String code) {
        return jdbc.sql("select short_name from cpbl_team where code = ?").param(code).query(String.class).optional().orElse(code);
    }

    /** 聯盟動態：聯盟內被持有球員的表現與異動，加上本隊受影響的賽程與聯盟交易。 */
    public List<FeedItem> leagueFeed(long leagueId, Long viewerTeamId, int limit) {
        LocalDate today = clock.today();
        List<FeedItem> out = new ArrayList<>();
        List<Long> rostered = jdbc.sql("""
                select distinct re.player_id from roster_entry re join fantasy_team t on t.id = re.team_id
                where t.league_id = ? and (re.valid_to is null or re.valid_to > ?)
                """).params(leagueId, today).query(Long.class).list();
        out.addAll(performances(rostered, today.minusDays(3), today));
        out.addAll(moves(rostered, today.minusDays(7), today));
        if (viewerTeamId != null) {
            out.addAll(idleStarters(leagueId, viewerTeamId, today));
            out.addAll(postponements(viewerTeamId, today));
        }
        out.addAll(transactions(leagueId, today.minusDays(7)));
        out.sort(Comparator.comparing(FeedItem::at, Comparator.nullsLast(Comparator.reverseOrder())));
        return out.subList(0, Math.min(limit, out.size()));
    }

    /** 單一球員的動態。 */
    public List<FeedItem> playerFeed(long leagueId, long playerId) {
        LocalDate today = clock.today();
        List<FeedItem> out = new ArrayList<>();
        out.addAll(performances(List.of(playerId), today.minusDays(30), today));
        out.addAll(moves(List.of(playerId), today.minusDays(60), today));
        out.addAll(transactions(leagueId, today.minusDays(60)).stream().filter(f -> f.playerId() != null && f.playerId() == playerId).toList());
        out.sort(Comparator.comparing(FeedItem::at, Comparator.nullsLast(Comparator.reverseOrder())));
        return out.subList(0, Math.min(15, out.size()));
    }

    private P player(long id) {
        return jdbc.sql("select id, name, cpbl_team_code, jersey_number from player where id = ?").param(id)
                .query((rs, n) -> new P(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4))).single();
    }

    private OffsetDateTime eveningOf(LocalDate d) {
        return d.atTime(22, 0).atZone(clock.zone()).toOffsetDateTime();
    }

    /** 亮眼表現：多轟、猛打、多打點、多盜、優質先發、無失分長局數、救援成功。 */
    private List<FeedItem> performances(List<Long> ids, LocalDate from, LocalDate to) {
        if (ids.isEmpty()) {
            return List.of();
        }
        return jdbc.sql("""
                select p.id, p.name, p.cpbl_team_code, p.jersey_number, g.play_date,
                       case when gs.team_code = g.home_team_code then g.away_team_code else g.home_team_code end as opp,
                       gs.ab, gs.h, gs.hr, gs.rbi, gs.sb, gs.pitched, gs.started, gs.outs, gs.p_er, gs.p_k, gs.sv, gs.hld
                from game_stat gs join game g on g.id = gs.game_id join player p on p.id = gs.player_id
                where gs.player_id in (:ids) and g.status = 'FINAL' and g.play_date between :from and :to
                order by g.play_date desc
                """).param("ids", ids).param("from", from).param("to", to)
                .query((rs, n) -> {
                    String name = rs.getString(2);
                    String text = null;
                    int h = rs.getInt("h"), ab = rs.getInt("ab"), hr = rs.getInt("hr"), rbi = rs.getInt("rbi"), sb = rs.getInt("sb");
                    int outs = rs.getInt("outs"), er = rs.getInt("p_er"), k = rs.getInt("p_k");
                    String ip = (outs / 3) + "." + (outs % 3);
                    if (hr >= 2) {
                        text = name + " 單場 " + hr + " 轟 " + rbi + " 打點（" + h + "-" + ab + "）";
                    } else if (h >= 3) {
                        text = name + " 猛打賞，" + ab + " 打數 " + h + " 安" + (hr > 0 ? "含 1 轟" : "") + (rbi > 0 ? "、" + rbi + " 打點" : "");
                    } else if (rbi >= 4) {
                        text = name + " 單場 " + rbi + " 打點";
                    } else if (sb >= 2) {
                        text = name + " 單場 " + sb + " 次盜壘成功";
                    } else if (rs.getBoolean("started") && outs >= 18 && er <= 3) {
                        text = name + " 優質先發：" + ip + " 局 " + er + " 自責分 " + k + " 次三振";
                    } else if (rs.getBoolean("pitched") && outs >= 9 && er == 0) {
                        text = name + " " + ip + " 局無失分";
                    } else if (rs.getInt("sv") > 0) {
                        text = name + " 拿下救援成功";
                    }
                    if (text == null) {
                        return null;
                    }
                    return new FeedItem(Kind.HOT, rs.getLong(1), name, rs.getString(3), rs.getString(4),
                            text + "（vs " + shortName(rs.getString("opp")) + "）", eveningOf(rs.getObject(5, LocalDate.class)), false);
                }).list().stream().filter(java.util.Objects::nonNull).toList();
    }

    /** 升降二軍、註銷、轉隊。下二軍時附上最早可回一軍日。 */
    private List<FeedItem> moves(List<Long> ids, LocalDate from, LocalDate to) {
        if (ids.isEmpty()) {
            return List.of();
        }
        return jdbc.sql("""
                select p.id, p.name, p.cpbl_team_code, p.jersey_number, p.is_foreign, l.field, l.old_value, l.new_value,
                       l.effective_date, l.created_at
                from player_status_log l join player p on p.id = l.player_id
                where l.player_id in (:ids) and l.effective_date between :from and :to and l.old_value is not null
                order by l.id desc
                """).param("ids", ids).param("from", from).param("to", to)
                .query((rs, n) -> {
                    String name = rs.getString(2);
                    String field = rs.getString("field");
                    String nv = rs.getString("new_value");
                    LocalDate d = rs.getObject("effective_date", LocalDate.class);
                    String text;
                    if ("first_team_status".equals(field) && "MINORS".equals(nv)) {
                        int days = rs.getBoolean("is_foreign") ? 15 : 10;
                        text = name + " 下二軍。" + (rs.getBoolean("is_foreign") ? "洋將需滿 15 日" : "需滿 10 日") + "，最早 "
                                + d.plusDays(days).getMonthValue() + "/" + d.plusDays(days).getDayOfMonth() + " 可回一軍";
                    } else if ("first_team_status".equals(field)) {
                        text = name + " 登錄一軍";
                    } else if ("registration_status".equals(field) && "DELISTED".equals(nv)) {
                        text = name + " 遭註銷，本季不可回歸";
                    } else if ("cpbl_team_code".equals(field)) {
                        text = name + " 轉隊：" + shortName(rs.getString("old_value")) + " → " + shortName(nv);
                    } else {
                        return null;
                    }
                    return new FeedItem(Kind.MOVE, rs.getLong(1), name, rs.getString(3), rs.getString(4), text,
                            rs.getObject("created_at", OffsetDateTime.class), false);
                }).list().stream().filter(java.util.Objects::nonNull).toList();
    }

    /** 本隊先發中，仍在一軍但連續未出賽者。 */
    private List<FeedItem> idleStarters(long leagueId, long teamId, LocalDate today) {
        List<Long> starters = roster.entriesOn(teamId, today).stream().filter(e -> e.slot().isStarting())
                .map(RosterService.Entry::playerId).toList();
        Map<Long, PlayerStatusService.PlayerStatus> st = statuses.statuses(leagues.get(leagueId), starters, today);
        List<FeedItem> out = new ArrayList<>();
        for (Long id : starters) {
            PlayerStatusService.PlayerStatus s = st.get(id);
            if (s != null && s.code() != PlayerStatusService.Code.ACTIVE) {
                P p = player(id);
                out.add(new FeedItem(Kind.MOVE, id, p.name(), p.team(), p.no(), p.name() + " 在你的先發陣容中：" + s.text(),
                        clock.now().atZone(clock.zone()).toOffsetDateTime().minusMinutes(1), false));
            }
        }
        return out;
    }

    /** 今日延賽影響本隊先發。 */
    private List<FeedItem> postponements(long teamId, LocalDate today) {
        List<String> teams = jdbc.sql("""
                select home_team_code from game where scheduled_date = ? and status = 'POSTPONED'
                union select away_team_code from game where scheduled_date = ? and status = 'POSTPONED'
                """).params(today, today).query(String.class).list();
        if (teams.isEmpty()) {
            return List.of();
        }
        Set<String> set = Set.copyOf(teams);
        long affected = roster.entriesOn(teamId, today).stream().filter(e -> e.slot().isStarting())
                .filter(e -> set.contains(player(e.playerId()).team())).count();
        if (affected == 0) {
            return List.of();
        }
        return List.of(new FeedItem(Kind.GAME, null, null, null, null,
                String.join("、", teams.stream().map(this::shortName).toList()) + " 今日比賽延賽，你有 " + affected + " 名先發受影響",
                clock.now().atZone(clock.zone()).toOffsetDateTime(), false));
    }

    /** Waiver 得標、交易完成、釋出進入 waiver。 */
    private List<FeedItem> transactions(long leagueId, LocalDate since) {
        Instant from = clock.atStartOfDay(since);
        List<FeedItem> out = new ArrayList<>();
        out.addAll(jdbc.sql("""
                select p.id, p.name, p.cpbl_team_code, p.jersey_number, t.name, c.faab_bid, c.processed_at,
                       (select count(*) from waiver_claim c2 where c2.player_id = c.player_id and c2.processed_at = c.processed_at)
                from waiver_claim c join player p on p.id = c.player_id join fantasy_team t on t.id = c.team_id
                where c.league_id = ? and c.status = 'WON' and c.processed_at >= ?
                """).params(leagueId, java.sql.Timestamp.from(from))
                .query((rs, n) -> new FeedItem(Kind.LEAGUE, rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5) + " 以 FAAB " + rs.getInt(6) + " 點簽下 " + rs.getString(2) + "（" + rs.getInt(8) + " 隊出價）",
                        rs.getObject(7, OffsetDateTime.class), false)).list());
        out.addAll(jdbc.sql("""
                select p.id, p.name, p.cpbl_team_code, p.jersey_number, w.clears_at, w.released_on
                from waiver_player w join player p on p.id = w.player_id where w.league_id = ?
                """).param(leagueId)
                .query((rs, n) -> {
                    OffsetDateTime clears = rs.getObject(5, OffsetDateTime.class).atZoneSameInstant(clock.zone()).toOffsetDateTime();
                    return new FeedItem(Kind.LEAGUE, rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                            rs.getString(2) + " 遭釋出，waiver 至 " + clears.getMonthValue() + "/" + clears.getDayOfMonth() + " "
                                    + String.format("%02d:%02d", clears.getHour(), clears.getMinute()),
                            eveningOf(rs.getObject(6, LocalDate.class)).minusHours(10), false);
                }).list());
        jdbc.sql("""
                select t.id, t.completed_at, tp.name, tr.name from trade t
                join fantasy_team tp on tp.id = t.proposer_team_id join fantasy_team tr on tr.id = t.receiver_team_id
                where t.league_id = ? and t.status = 'COMPLETED' and t.completed_at >= ?
                """).params(leagueId, java.sql.Timestamp.from(from))
                .query((rs, n) -> {
                    long tradeId = rs.getLong(1);
                    List<String> names = jdbc.sql("select p.name from trade_item i join player p on p.id = i.player_id where i.trade_id = ?")
                            .param(tradeId).query(String.class).list();
                    out.add(new FeedItem(Kind.LEAGUE, null, null, null, null,
                            rs.getString(3) + " 與 " + rs.getString(4) + " 完成交易：" + String.join("、", names),
                            rs.getObject(2, OffsetDateTime.class), false));
                    return null;
                }).list();
        return out;
    }
}
