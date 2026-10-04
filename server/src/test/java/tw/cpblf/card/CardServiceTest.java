package tw.cpblf.card;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.card.CardService.GameLine;
import tw.cpblf.card.CardService.Hist;
import tw.cpblf.league.LeagueService;

class CardServiceTest extends IntegrationTest {

    static final LocalDate D = LocalDate.of(2026, 4, 1);

    @Autowired
    CardService cards;
    @Autowired
    LeagueService leagues;

    static GameLine bat(int day, int h, int hr, int bb) {
        return new GameLine(D.plusDays(day), h, hr, bb, false, false, 0, 0, 0);
    }

    static GameLine pitch(int day, int outs, int er, int k) {
        return new GameLine(D.plusDays(day), 0, 0, 0, true, true, outs, er, k);
    }

    // ---------- 印章 ----------

    @Test
    void hitterStampsCarryTheFirstDateAchieved() {
        var games = List.of(bat(0, 3, 0, 0), bat(1, 1, 2, 0), bat(2, 3, 0, 1), bat(3, 0, 0, 2));
        var stamps = CardService.stamps(games, List.of(), false);
        assertThat(stamps).extracting(CardService.Stamp::label).containsExactly("猛打賞", "雙響砲", "選球眼", "週MVP");
        assertThat(stamps.get(0).date()).isEqualTo(D);
        assertThat(stamps.get(1).date()).isEqualTo(D.plusDays(1));
        // 單場 2 保送不到 3，未達成
        assertThat(stamps.get(2).date()).isNull();
        assertThat(stamps.get(3).date()).isNull();
    }

    @Test
    void pitcherStampsUseFifthQualityStartAndScorelessSeven() {
        List<GameLine> games = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            games.add(pitch(i * 5, 18, 3, 6));   // 每場剛好 QS
        }
        games.add(pitch(40, 21, 0, 11));        // 7 局 0 責、11 K
        var stamps = CardService.stamps(games, List.of(new WeeklyMvpService.Mvp(D.plusDays(5), 1, "P", 1)), true);
        assertThat(stamps).extracting(CardService.Stamp::label).containsExactly("雙十K", "QS×5", "七局無失分", "週MVP");
        assertThat(stamps.get(0).date()).isEqualTo(D.plusDays(40));
        // 第 5 次 QS：第 0、5、10、15、20 天
        assertThat(stamps.get(1).date()).isEqualTo(D.plusDays(20));
        assertThat(stamps.get(2).date()).isEqualTo(D.plusDays(40));
        // 週 MVP 的日期為該週週日
        assertThat(stamps.get(3).date()).isEqualTo(D.plusDays(11));
    }

    // ---------- 高光與裁切 ----------

    @Test
    void highlightPicksTheBestSingleGame() {
        var h = CardService.highlight(List.of(bat(0, 4, 0, 0), bat(1, 2, 2, 0), bat(2, 3, 3, 0)), false);
        assertThat(h.label()).isEqualTo("單場 3 轟");
        assertThat(h.date()).isEqualTo(D.plusDays(2));
        assertThat(CardService.highlight(List.of(bat(0, 1, 0, 0)), false)).isNull();
        assertThat(CardService.highlight(List.of(pitch(0, 21, 0, 8)), true).label()).isEqualTo("7 局無失分");
    }

    @Test
    void trimKeepsTheOriginAndTheMostRecentEvents() {
        List<Hist> h = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            h.add(new Hist(D.plusDays(i), "e" + i, "team", null));
        }
        assertThat(CardService.trim(h)).extracting(Hist::label).containsExactly("e0", "e3", "e4", "e5");
    }

    // ---------- 履歷（資料庫） ----------

    @Test
    void provenanceShowsDraftPickTradeAndRelease() {
        long u1 = user("a"), u2 = user("b");
        long league = jdbc.sql("insert into league (name, season_year, invite_code, commissioner_user_id) values ('L', 2026, 'INV', ?) returning id")
                .param(u1).query(Long.class).single();
        long t1 = team(league, u1, "北投夜鷹"), t2 = team(league, u2, "三重火箭");
        long half = jdbc.sql("insert into season_half (league_id, half_no, start_date, end_date) values (?, 1, ?, ?) returning id")
                .params(league, D, D.plusDays(90)).query(Long.class).single();
        long draft = jdbc.sql("insert into draft (league_id, season_half_id, rounds, pick_seconds, status) values (?, ?, 20, 90, 'COMPLETED') returning id")
                .params(league, half).query(Long.class).single();
        long p = jdbc.sql("insert into player (cpbl_player_id, name, cpbl_team_code, listed_position, first_team_status) values ('X', '林承翰', 'BRO', 'IF', 'ACTIVE') returning id")
                .query(Long.class).single();
        // 2 隊聯盟：第 3 輪第 2 順位 = 總順位 6
        jdbc.sql("insert into draft_pick (draft_id, pick_no, round, team_id, player_id, picked_at) values (?, 6, 3, ?, ?, now())")
                .params(draft, t1, p).update();
        // 選秀進夜鷹 → 位置異動（同隊合併）→ 交易到火箭 → 被釋出
        entry(t1, p, D, D.plusDays(5), "DRAFT");
        entry(t1, p, D.plusDays(5), D.plusDays(10), "MOVE");
        entry(t2, p, D.plusDays(10), D.plusDays(20), "TRADE");

        var events = cards.rosterEvents(leagues.get(league), p);
        assertThat(events).extracting(Hist::label).containsExactly("選秀 3.02 · 北投夜鷹", "交易 → 三重火箭", "釋出 → 自由球員");
        assertThat(events).extracting(Hist::date).containsExactly(D, D.plusDays(10), D.plusDays(20));
        assertThat(events.get(1).teamId()).isEqualTo(t2);
        assertThat(events.get(2).tone()).isEqualTo("muted");
    }

    long user(String name) {
        return jdbc.sql("insert into app_user (username, display_name, password_hash) values (?, ?, 'x') returning id")
                .params(name, name).query(Long.class).single();
    }

    long team(long league, long user, String name) {
        return jdbc.sql("insert into fantasy_team (league_id, user_id, name, abbr) values (?, ?, ?, 'X') returning id")
                .params(league, user, name).query(Long.class).single();
    }

    void entry(long team, long player, LocalDate from, LocalDate to, String via) {
        jdbc.sql("insert into roster_entry (team_id, player_id, slot, valid_from, valid_to, acquired_via) values (?, ?, 'BN', ?, ?, ?)")
                .params(team, player, from, to, via).update();
    }
}
