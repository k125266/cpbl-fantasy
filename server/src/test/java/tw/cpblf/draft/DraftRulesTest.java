package tw.cpblf.draft;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import tw.cpblf.IntegrationTest;
import tw.cpblf.common.ApiException;
import tw.cpblf.demo.DemoSeeder;
import tw.cpblf.draft.DraftService.DraftView;
import tw.cpblf.draft.DraftService.PickView;
import tw.cpblf.season.SeasonService;

/** E14：上半季隨機蛇形 20 輪；下半季補強選秀（依戰績由差到好、每輪同順序 5 輪），keeper 至多 15 人且不佔輪次。 */
class DraftRulesTest extends IntegrationTest {

    @Autowired DemoSeeder seeder;
    @Autowired DraftService drafts;
    @Autowired SeasonService season;

    long leagueId;
    List<Long> teams;

    void firstHalfDrafted() {
        leagueId = seeder.seed();
        long d1 = jdbc.sql("select id from draft where league_id = ?").param(leagueId).query(Long.class).single();
        drafts.start(d1);
        while (drafts.inProgress(d1)) {
            drafts.autoPick(d1);
        }
        teams = jdbc.sql("select id from fantasy_team where league_id = ? order by id").param(leagueId).query(Long.class).list();
        // 名單自開幕日生效，keeper 只能從當下名單選
        clock.setNow(OffsetDateTime.parse("2026-04-01T12:00:00+08:00").toInstant());
    }

    List<Long> roundOrder(List<PickView> picks, int round) {
        return picks.stream().filter(p -> p.round() == round).map(PickView::teamId).toList();
    }

    List<Long> rosterOf(long team) {
        return jdbc.sql("select player_id from roster_entry where team_id = ? and valid_to is null order by player_id")
                .param(team).query(Long.class).list();
    }

    @Test
    void draftCannotStartBeforeTheRevealHasBeenShown() {
        leagueId = seeder.seed();
        long d1 = jdbc.sql("select id from draft where league_id = ?").param(leagueId).query(Long.class).single();
        // 不能跳過揭曉
        assertThatThrownBy(() -> drafts.requireRevealShown(d1)).isInstanceOf(ApiException.class).hasMessageContaining("請先揭曉");
        drafts.reveal(d1);
        // 揭曉動畫還在播
        clock.setNow(clock.now().plusSeconds(DraftService.REVEAL_SECONDS - 3));
        assertThatThrownBy(() -> drafts.requireRevealShown(d1)).isInstanceOf(ApiException.class).hasMessageContaining("揭曉中");
        // 播完之後可以開始
        clock.setNow(clock.now().plusSeconds(5));
        drafts.requireRevealShown(d1);
        drafts.start(d1);
        assertThat(drafts.inProgress(d1)).isTrue();
    }

    @Test
    void firstHalfIsASnakeOfTwentyRoundsRevealedAtStart() {
        leagueId = seeder.seed();
        long d1 = jdbc.sql("select id from draft where league_id = ?").param(leagueId).query(Long.class).single();
        DraftView before = drafts.view(d1, null);
        assertThat(before.order()).isEmpty(); // 揭曉前不公開
        drafts.start(d1);
        DraftView v = drafts.view(d1, null);
        assertThat(v.revealedAt()).isNotNull();
        assertThat(v.snake()).isTrue();
        assertThat(v.rounds()).isEqualTo(20);
        List<Long> r2 = new ArrayList<>(roundOrder(v.picks(), 2));
        Collections.reverse(r2);
        assertThat(roundOrder(v.picks(), 1)).isEqualTo(r2);
    }

    @Test
    void secondHalfOrderIsWorstFirstAndEveryRoundTheSame() {
        firstHalfDrafted();
        long d2 = drafts.create(leagueId, 2, null);
        drafts.reveal(d2);
        DraftView v = drafts.view(d2, null);
        List<Long> worstFirst = new ArrayList<>(season.standings(leagueId, 1).stream().map(SeasonService.StandingRow::teamId).toList());
        Collections.reverse(worstFirst);
        assertThat(v.order()).isEqualTo(worstFirst);
        assertThat(v.snake()).isFalse();

        drafts.start(d2);
        v = drafts.view(d2, null);
        assertThat(v.rounds()).isEqualTo(5);
        assertThat(v.picks()).hasSize(5 * teams.size());
        assertThat(roundOrder(v.picks(), 2)).isEqualTo(roundOrder(v.picks(), 1));
    }

    @Test
    void keepersAreCappedSecretUntilRevealAndDoNotUseRounds() {
        firstHalfDrafted();
        long d2 = drafts.create(leagueId, 2, null);
        long me = teams.get(0), other = teams.get(1);
        List<Long> mine = rosterOf(me);
        assertThat(mine.size()).isGreaterThanOrEqualTo(16);

        assertThatThrownBy(() -> drafts.setKeepers(d2, me, mine.subList(0, 16))).isInstanceOf(ApiException.class);
        List<Long> keep = mine.subList(0, 15);
        drafts.setKeepers(d2, me, keep);
        drafts.setKeepers(d2, other, rosterOf(other).subList(0, 3));

        // 揭曉前：自己看得到，別隊看不到
        assertThat(drafts.view(d2, me).myKeepers()).hasSize(15);
        assertThat(drafts.view(d2, other).keepers()).isEmpty();

        drafts.reveal(d2);
        assertThat(drafts.view(d2, other).keepers()).filteredOn(k -> k.teamId() == me)
                .singleElement().satisfies(k -> assertThat(k.players()).hasSize(15));
        // 揭曉後鎖定
        assertThatThrownBy(() -> drafts.setKeepers(d2, me, keep.subList(0, 10))).isInstanceOf(ApiException.class);

        drafts.start(d2);
        while (drafts.inProgress(d2)) {
            drafts.autoPick(d2);
        }
        // keeper 不佔輪次：每隊選 5 人，keeper 沒被別隊選走
        assertThat(count("select count(*) from draft_pick where draft_id = ? and team_id = ?", d2, me)).isEqualTo(5);
        assertThat(count("select count(*) from draft_pick where draft_id = ? and player_id in (:ids)".replace(":ids",
                String.join(",", keep.stream().map(String::valueOf).toList())), d2)).isZero();
        // 下半季名單 = 15 keeper + 5 選秀
        long kept = jdbc.sql("""
                select count(*) from roster_entry where team_id = ? and valid_to is null and acquired_via = 'KEEPER'
                """).param(me).query(Long.class).single();
        assertThat(kept).isEqualTo(15);
        assertThat(rosterOf(me)).hasSize(20).containsAll(keep);
        // 只留 3 人的隊伍：3 + 5，其餘空位之後從自由球員補
        assertThat(rosterOf(other)).hasSize(8);
    }

    @Test
    void keeperCandidatesShowRankAndHowEachPlayerWasAcquired() {
        firstHalfDrafted();
        long d2 = drafts.create(leagueId, 2, null);
        long me = teams.get(0);
        var cands = drafts.keeperCandidates(d2, me);
        assertThat(cands).hasSize(rosterOf(me).size());
        assertThat(cands).allSatisfy(c -> assertThat(c.via()).startsWith("選秀第 ").endsWith(" 輪"));
        assertThat(cands).extracting(DraftService.KeeperCandidate::rank).doesNotContainNull().isSorted();
    }

    @Test
    void keepersCloseTenMinutesBeforeTheDraft() {
        firstHalfDrafted();
        Instant draftAt = clock.now().plus(Duration.ofMinutes(5)).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        long d2 = drafts.create(leagueId, 2, null, draftAt);
        assertThat(drafts.view(d2, null).keeperDeadline().toInstant()).isEqualTo(draftAt.minus(Duration.ofMinutes(10)));
        long me = teams.get(0);
        assertThatThrownBy(() -> drafts.setKeepers(d2, me, rosterOf(me).subList(0, 2)))
                .isInstanceOf(ApiException.class).hasMessageContaining("截止");
    }
}
