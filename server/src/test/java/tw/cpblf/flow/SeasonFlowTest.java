package tw.cpblf.flow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.common.ApiException;
import tw.cpblf.demo.DemoSeeder;
import tw.cpblf.demo.DemoService;
import tw.cpblf.draft.DraftService;
import tw.cpblf.league.League;
import tw.cpblf.league.LeagueService;
import tw.cpblf.roster.PlayerStatusService;
import tw.cpblf.roster.RosterService;
import tw.cpblf.roster.Slot;
import tw.cpblf.scoring.ScoringService;
import tw.cpblf.scoring.StatTotals;
import tw.cpblf.season.SeasonService;
import tw.cpblf.trade.TradeService;
import tw.cpblf.waiver.WaiverService;

/** 以模擬賽季跑完整流程：選秀 → 對戰期 → 鎖定 → 交易 / waiver / 註銷。 */
class SeasonFlowTest extends IntegrationTest {

    @Autowired DemoSeeder seeder;
    @Autowired DemoService demo;
    @Autowired DraftService drafts;
    @Autowired LeagueService leagues;
    @Autowired SeasonService season;
    @Autowired ScoringService scoring;
    @Autowired RosterService roster;
    @Autowired TradeService trades;
    @Autowired WaiverService waivers;
    @Autowired PlayerStatusService statuses;

    long leagueId;
    List<Long> teams;

    void seedAndDraft() {
        leagueId = seeder.seed();
        long draftId = jdbc.sql("select id from draft where league_id = ?").param(leagueId).query(Long.class).single();
        drafts.start(draftId);
        while (drafts.inProgress(draftId)) {
            drafts.autoPick(draftId);
        }
        teams = jdbc.sql("select id from fantasy_team where league_id = ? order by id").param(leagueId).query(Long.class).list();
    }

    @Test
    void draftBuildsValidRosters() {
        seedAndDraft();
        League league = leagues.get(leagueId);
        LocalDate opening = LocalDate.of(2026, 3, 28);
        for (Long t : teams) {
            var entries = roster.entriesOn(t, opening);
            assertThat(entries.stream().filter(e -> e.slot() != Slot.NA).count()).isEqualTo(20);
            assertThat(entries.stream().filter(e -> e.slot().isStarting()).count()).isEqualTo(league.startingSlotCount());
            int foreign = count("select count(*) from player p join roster_entry re on re.player_id = p.id where re.team_id = ? and p.is_foreign", t);
            assertThat(foreign).isLessThanOrEqualTo(league.foreignPlayerLimit());
        }
    }

    @Test
    void periodsProgressToProvisionalThenLocked() {
        seedAndDraft();
        demo.advanceDays(23); // 3/20 起算 → 4/11 23:30：第 1 期 (3/28–4/10) 結束，48 小時緩衝中
        var p1 = season.periods(leagueId).get(0);
        assertThat(p1.status()).isEqualTo("PROVISIONAL");
        // 每期雙對手：5 隊每期 5 場
        assertThat(count("select count(*) from matchup where scoring_period_id = ? and status = 'PROVISIONAL' and result is not null", p1.id()))
                .isEqualTo(5);
        demo.advanceDays(2); // → 4/13 23:30，已過 4/13 00:00 鎖定時間
        p1 = season.periods(leagueId).get(0);
        assertThat(p1.status()).isEqualTo("LOCKED");
        assertThat(count("select count(*) from matchup where scoring_period_id = ? and status = 'LOCKED'", p1.id())).isEqualTo(5);
    }

    /** 規則書 6.3：延賽後補賽，數據一律以實際開打日歸屬，原定日期保留。 */
    @Test
    void makeupGamesAreAttributedToActualPlayDate() {
        seedAndDraft();
        demo.advanceDays(33); // → 4/21
        record G(long id, LocalDate scheduled, LocalDate actual, String status) {
        }
        List<G> makeups = jdbc.sql("select id, scheduled_date, actual_play_date, status from game where actual_play_date is not null")
                .query((rs, n) -> new G(rs.getLong(1), rs.getObject(2, LocalDate.class), rs.getObject(3, LocalDate.class),
                        rs.getString(4))).list();
        assertThat(makeups).isNotEmpty();
        G g = makeups.get(0);
        assertThat(g.actual()).isAfter(g.scheduled());
        assertThat(g.status()).isEqualTo("FINAL");
        assertThat(count("select count(*) from game_stat where game_id = ?", g.id())).isGreaterThan(0);
        // 原定日期所屬期間不含此場，實際開打日所屬期間含此場
        var periods = season.periods(leagueId);
        var actualPeriod = periods.stream().filter(p -> !g.actual().isBefore(p.startDate()) && !g.actual().isAfter(p.endDate()))
                .findFirst().orElseThrow();
        assertThat(count("select count(*) from game where id = ? and play_date between ? and ?", g.id(),
                actualPeriod.startDate(), actualPeriod.endDate())).isEqualTo(1);
    }

    /** CPBLF-22：交易後歷史對戰比分不得變動。 */
    @Test
    void tradeDoesNotChangeHistoricalScores() {
        seedAndDraft();
        demo.advanceDays(25);
        var p1 = season.periods(leagueId).get(0);
        long a = teams.get(0);
        long b = teams.get(1);
        StatTotals beforeA = scoring.teamTotals(a, p1.startDate(), p1.endDate());
        StatTotals beforeB = scoring.teamTotals(b, p1.startDate(), p1.endDate());
        List<Map<String, Object>> matchupsBefore = jdbc.sql("select id, score_a, score_b, result from matchup where scoring_period_id = ? order by id")
                .param(p1.id()).query().listOfRows();

        LocalDate today = clock.today();
        long[] pair = benchSwap(a, b, today);
        long give = pair[0];
        long get = pair[1];
        long tradeId = trades.propose(a, b, List.of(give), List.of(get), "test");
        trades.respond(b, tradeId, true);
        clock.setNow(clock.now().plusSeconds(25 * 3600));
        trades.processDue();
        Map<String, Object> trade = jdbc.sql("select status, result_note from trade where id = ?").param(tradeId).query().singleRow();
        assertThat(trade.get("status")).as("交易失敗原因：%s", trade.get("result_note")).isEqualTo("COMPLETED");
        assertThat(roster.ownerTeam(leagueId, give, clock.today().plusDays(1))).contains(b);

        assertThat(scoring.teamTotals(a, p1.startDate(), p1.endDate())).isEqualTo(beforeA);
        assertThat(scoring.teamTotals(b, p1.startDate(), p1.endDate())).isEqualTo(beforeB);
        demo.advanceDays(1);
        assertThat(jdbc.sql("select id, score_a, score_b, result from matchup where scoring_period_id = ? order by id")
                .param(p1.id()).query().listOfRows()).isEqualTo(matchupsBefore);
    }

    @Test
    void lockedPlayerMovesTakeEffectTomorrow() {
        seedAndDraft();
        demo.advanceDays(10); // 4/7 (二) 23:30 之後
        demo.setClock(LocalDateTime.of(2026, 4, 8, 19, 30)); // 週三比賽進行中
        long team = teams.get(0);
        LocalDate today = clock.today();
        var entries = roster.entriesOn(team, today);
        var lockedEntry = entries.stream().filter(e -> roster.isLocked(e.playerId())).findFirst().orElseThrow();
        Slot other = lockedEntry.slot() == Slot.BN ? Slot.UTIL : Slot.BN;
        assertThatThrownBy(() -> roster.setSlots(team, Map.of(lockedEntry.playerId(), other)))
                .isInstanceOf(ApiException.class).hasMessageContaining("鎖定");
        LocalDate eff = roster.drop(team, lockedEntry.playerId());
        assertThat(eff).isEqualTo(today.plusDays(1));
        // 今日仍在名單上（當日數據照算），明日起離隊
        assertThat(roster.entriesOn(team, today)).anyMatch(e -> e.playerId() == lockedEntry.playerId());
        assertThat(roster.entriesOn(team, today.plusDays(1))).noneMatch(e -> e.playerId() == lockedEntry.playerId());
    }

    @Test
    void waiverTieGoesToWorseRecord() {
        seedAndDraft();
        demo.advanceDays(26); // 第 1 期已鎖定，有戰績
        demo.setClock(LocalDateTime.of(2026, 4, 21, 10, 0)); // 週一休兵日，無鎖定
        // 模擬賽季中各隊 1、2 號先發不會被下放（統一 2 號除外），確保結算時仍在一軍
        record Owned(long teamId, long playerId) {
        }
        Owned target = jdbc.sql("""
                select re.team_id, p.id from roster_entry re join player p on p.id = re.player_id
                join fantasy_team t on t.id = re.team_id
                where t.league_id = ? and re.valid_to is null and p.cpbl_player_id ~ '^9[0-9]000[12]$' and p.cpbl_player_id <> '920002'
                order by p.id limit 1
                """).param(leagueId).query((rs, n) -> new Owned(rs.getLong(1), rs.getLong(2))).single();
        long dropper = target.teamId();
        long dropped = target.playerId();
        roster.drop(dropper, dropped);
        List<Long> ranked = season.standings(leagueId, 1).stream().map(SeasonService.StandingRow::teamId)
                .filter(id -> id != dropper).toList();
        long best = ranked.get(0);
        long worst = ranked.get(ranked.size() - 1);
        long bestDrop = roster.entriesOn(best, clock.today()).stream().filter(e -> e.slot() == Slot.BN).findFirst().orElseThrow().playerId();
        long worstDrop = roster.entriesOn(worst, clock.today()).stream().filter(e -> e.slot() == Slot.BN).findFirst().orElseThrow().playerId();
        assertThatThrownBy(() -> roster.addFreeAgent(best, dropped, bestDrop)).isInstanceOf(ApiException.class);
        waivers.claim(best, dropped, bestDrop, 15);
        waivers.claim(worst, dropped, worstDrop, 15);
        demo.advanceDays(3); // 4/23 03:00 結算
        List<String> results = jdbc.sql("select team_id || ':' || status || ':' || coalesce(result_note, '') from waiver_claim order by id")
                .query(String.class).list();
        assertThat(results).as("claims %s", results).anyMatch(r -> r.startsWith(worst + ":WON"));
        assertThat(roster.ownerTeam(leagueId, dropped, clock.today())).contains(worst);
        assertThat(jdbc.sql("select faab_budget from fantasy_team where id = ?").param(worst).query(Integer.class).single()).isEqualTo(85);
        assertThat(jdbc.sql("select faab_budget from fantasy_team where id = ?").param(best).query(Integer.class).single()).isEqualTo(100);
    }

    @Test
    void delistedPlayerIsReleasedNextDayAndStatusTextIsFactual() {
        seedAndDraft();
        demo.advanceDays(20);
        long team = teams.get(2);
        long delistTarget = jdbc.sql("select id from player where cpbl_player_id = '940007'").query(Long.class).single();
        // 模擬賽季第 35 天（5/2）註銷該洋投；先讓某隊持有他（NA）
        roster.addInternal(team, delistTarget, Slot.NA, clock.today(), "FA", 7);
        demo.advanceDays(26); // → 5/3 23:30
        assertThat(jdbc.sql("select registration_status from player where id = ?").param(delistTarget).query(String.class).single())
                .isEqualTo("DELISTED");
        assertThat(roster.ownerTeam(leagueId, delistTarget, clock.today())).isEmpty();
        assertThat(count("select count(*) from notification where team_id = ? and message like '%註銷%'", team)).isEqualTo(1);
        assertThat(count("select count(*) from waiver_player where player_id = ?", delistTarget)).isZero();

        List<Long> all = jdbc.sql("select id from player").query(Long.class).list();
        var st = statuses.statuses(leagues.get(leagueId), all, clock.today());
        assertThat(st.values()).noneMatch(s -> s.text().contains("傷"));
        assertThat(st.values()).anyMatch(s -> s.code() == PlayerStatusService.Code.MINORS && s.earliestReturn() != null);
        assertThat(st.values()).anyMatch(s -> s.code() == PlayerStatusService.Code.IDLE);
        assertThat(st.get(delistTarget).code()).isEqualTo(PlayerStatusService.Code.DELISTED);
    }

    /**
     * 兩隊各一位板凳球員，交換後兩隊都合法：一換一、板凳換板凳，名額與人數不變；
     * 洋將身分相同，洋將人數也不變。上半季順位隨機，各隊名單每次不同，所以要挑而不是取第一位（E19）。
     */
    private long[] benchSwap(long a, long b, LocalDate date) {
        List<Long> benchA = bench(a, date);
        List<Long> benchB = bench(b, date);
        for (long x : benchA) {
            for (long y : benchB) {
                if (foreign(x) == foreign(y)) {
                    return new long[] {x, y};
                }
            }
        }
        throw new IllegalStateException("兩隊板凳找不到洋將身分相同的一對");
    }

    private List<Long> bench(long team, LocalDate date) {
        return roster.entriesOn(team, date).stream().filter(e -> e.slot() == Slot.BN).map(e -> e.playerId()).toList();
    }

    private boolean foreign(long playerId) {
        return jdbc.sql("select is_foreign from player where id = ?").param(playerId).query(Boolean.class).single();
    }
}
