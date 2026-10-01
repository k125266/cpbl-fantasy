package tw.cpblf.roster;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import tw.cpblf.league.League;

/**
 * CPBLF-37：缺陣狀態。只呈現可由結構化資料客觀推導的出賽狀態（規則書 6.1）。
 * 標示文字一律為事實描述，不推測原因。
 */
@Service
public class PlayerStatusService {

    private static final DateTimeFormatter MD = DateTimeFormatter.ofPattern("M/d");

    public enum Code { ACTIVE, IDLE, MINORS, DELISTED }

    public record PlayerStatus(Code code, String text, LocalDate earliestReturn) {
    }

    private final JdbcClient jdbc;

    public PlayerStatusService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    record Info(long id, String team, boolean foreign, String listed, String registration, String firstTeam,
                LocalDate changedOn, LocalDate delistedOn, LocalDate lastBat, LocalDate lastPitch) {
    }

    public Map<Long, PlayerStatus> statuses(League league, Collection<Long> ids, LocalDate today) {
        Map<Long, PlayerStatus> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        List<Info> infos = jdbc.sql("""
                select p.id, p.cpbl_team_code, p.is_foreign, p.listed_position, p.registration_status, p.first_team_status,
                       p.first_team_changed_on, p.delisted_on,
                       (select max(g.play_date) from game_stat gs join game g on g.id = gs.game_id
                         where gs.player_id = p.id and gs.batted and gs.pa > 0 and g.play_date <= :today) as last_bat,
                       (select max(g.play_date) from game_stat gs join game g on g.id = gs.game_id
                         where gs.player_id = p.id and gs.pitched and g.play_date <= :today) as last_pitch
                from player p where p.id in (:ids)
                """).param("ids", ids).param("today", today)
                .query((rs, n) -> new Info(rs.getLong(1), rs.getString(2), rs.getBoolean(3), rs.getString(4), rs.getString(5),
                        rs.getString(6), rs.getObject(7, LocalDate.class), rs.getObject(8, LocalDate.class),
                        rs.getObject(9, LocalDate.class), rs.getObject(10, LocalDate.class)))
                .list();

        Map<String, List<LocalDate>> teamGameDays = new HashMap<>();
        Map<String, LocalDate> teamFirstGame = new HashMap<>();
        for (Info i : infos) {
            if (i.team() != null && !teamGameDays.containsKey(i.team())) {
                teamGameDays.put(i.team(), jdbc.sql("""
                        select distinct play_date from game
                        where status = 'FINAL' and play_date <= ? and (home_team_code = ? or away_team_code = ?)
                        order by play_date desc limit ?
                        """).params(today, i.team(), i.team(), league.hitterIdleGameDays()).query(LocalDate.class).list());
                teamFirstGame.put(i.team(), jdbc.sql("""
                        select min(play_date) from game where status = 'FINAL' and (home_team_code = ? or away_team_code = ?)
                        """).params(i.team(), i.team()).query(LocalDate.class).optional().orElse(null));
            }
        }

        for (Info i : infos) {
            if ("DELISTED".equals(i.registration())) {
                out.put(i.id(), new PlayerStatus(Code.DELISTED,
                        "已註銷" + (i.delistedOn() == null ? "" : "（" + i.delistedOn().format(MD) + "）") + "・本季不可回歸", null));
                continue;
            }
            if ("MINORS".equals(i.firstTeam())) {
                LocalDate since = i.changedOn();
                LocalDate earliest = since == null ? null
                        : since.plusDays(i.foreign() ? league.foreignMinorsReturnDays() : league.minorsReturnDays());
                String text = "下二軍" + (since == null ? "" : "（" + since.format(MD) + " 起）")
                        + (earliest == null ? "" : "・最早 " + earliest.format(MD) + " 可回一軍");
                out.put(i.id(), new PlayerStatus(Code.MINORS, text, earliest));
                continue;
            }
            String idle = null;
            if ("P".equals(i.listed())) {
                LocalDate first = teamFirstGame.get(i.team());
                LocalDate threshold = today.minusDays(league.pitcherIdleDays());
                if (first != null && !first.isAfter(threshold) && (i.lastPitch() == null || !i.lastPitch().isAfter(threshold))) {
                    idle = "近 " + league.pitcherIdleDays() + " 日未出場";
                }
            } else {
                List<LocalDate> days = teamGameDays.getOrDefault(i.team(), List.of());
                if (days.size() >= league.hitterIdleGameDays()) {
                    LocalDate oldest = days.get(days.size() - 1);
                    if (i.lastBat() == null || i.lastBat().isBefore(oldest)) {
                        idle = "近 " + league.hitterIdleGameDays() + " 個比賽日未出賽";
                    }
                }
            }
            out.put(i.id(), idle == null ? new PlayerStatus(Code.ACTIVE, "一軍", null) : new PlayerStatus(Code.IDLE, idle, null));
        }
        return out;
    }

    public List<String> forbiddenWordsCheck(Collection<PlayerStatus> statuses) {
        List<String> bad = new ArrayList<>();
        for (PlayerStatus s : statuses) {
            if (s.text().contains("傷")) {
                bad.add(s.text());
            }
        }
        return bad;
    }
}
