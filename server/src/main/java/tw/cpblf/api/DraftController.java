package tw.cpblf.api;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import tw.cpblf.auth.Auth;
import tw.cpblf.auth.CurrentUser;
import tw.cpblf.common.ApiException;
import tw.cpblf.draft.DraftService;
import tw.cpblf.league.LeagueService;

@RestController
@RequestMapping("/api/leagues/{leagueId}/drafts")
public class DraftController {

    private final LeagueService leagues;
    private final DraftService drafts;

    public DraftController(LeagueService leagues, DraftService drafts) {
        this.leagues = leagues;
        this.drafts = drafts;
    }

    @GetMapping
    public List<DraftService.DraftView> list(@PathVariable long leagueId) {
        CurrentUser u = Auth.require();
        leagues.requireMember(leagueId, u);
        return drafts.list(leagueId, leagues.teamOf(leagueId, u.id()).orElse(null));
    }

    @GetMapping("/{draftId}")
    public DraftService.DraftView get(@PathVariable long leagueId, @PathVariable long draftId) {
        CurrentUser u = Auth.require();
        leagues.requireMember(leagueId, u);
        check(leagueId, draftId);
        return drafts.view(draftId, leagues.teamOf(leagueId, u.id()).orElse(null));
    }

    /** @param scheduledAt 選秀時間（keeper 在前 10 分鐘截止）；可不填 */
    public record Create(int halfNo, List<Long> order, OffsetDateTime scheduledAt) {
    }

    @PostMapping
    public Map<String, Object> create(@PathVariable long leagueId, @RequestBody Create req) {
        leagues.requireCommissioner(leagueId, Auth.require());
        return Map.of("id", drafts.create(leagueId, req.halfNo(), req.order(),
                req.scheduledAt() == null ? null : req.scheduledAt().toInstant()));
    }

    /** 揭曉順位並公開各隊 keeper（聯盟管理員）。 */
    @PostMapping("/{draftId}/reveal")
    public Map<String, Boolean> reveal(@PathVariable long leagueId, @PathVariable long draftId) {
        leagues.requireCommissioner(leagueId, Auth.require());
        check(leagueId, draftId);
        drafts.reveal(draftId);
        return Map.of("ok", true);
    }

    public record Keepers(List<Long> playerIds) {
    }

    /** 自己的候選清單（預排清單），依順序；被選走的已排除。 */
    @GetMapping("/{draftId}/queue")
    public List<Long> queue(@PathVariable long leagueId, @PathVariable long draftId) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        check(leagueId, draftId);
        return drafts.queue(draftId, team);
    }

    /** 整份取代候選清單（加入、移除、調整順序都用這個）。 */
    @org.springframework.web.bind.annotation.PutMapping("/{draftId}/queue")
    public List<Long> setQueue(@PathVariable long leagueId, @PathVariable long draftId, @RequestBody Keepers req) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        check(leagueId, draftId);
        return drafts.setQueue(draftId, team, req.playerIds());
    }

    /** 自己的 keeper 候選：目前名單，附上半季排名與取得方式。 */
    @GetMapping("/{draftId}/keeper-candidates")
    public List<DraftService.KeeperCandidate> keeperCandidates(@PathVariable long leagueId, @PathVariable long draftId) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        check(leagueId, draftId);
        return drafts.keeperCandidates(draftId, team);
    }

    @PostMapping("/{draftId}/keepers")
    public List<DraftService.KeeperView> keepers(@PathVariable long leagueId, @PathVariable long draftId, @RequestBody Keepers req) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        check(leagueId, draftId);
        return drafts.setKeepers(draftId, team, req.playerIds());
    }

    @PostMapping("/{draftId}/start")
    public Map<String, Boolean> start(@PathVariable long leagueId, @PathVariable long draftId) {
        leagues.requireCommissioner(leagueId, Auth.require());
        check(leagueId, draftId);
        drafts.start(draftId);
        return Map.of("ok", true);
    }

    public record Pick(long playerId) {
    }

    @PostMapping("/{draftId}/pick")
    public Map<String, Boolean> pick(@PathVariable long leagueId, @PathVariable long draftId, @RequestBody Pick req) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        check(leagueId, draftId);
        drafts.pick(draftId, team, req.playerId());
        return Map.of("ok", true);
    }

    /** 聯盟管理員：剩餘選擇全部以自動選取完成（缺席隊伍或 demo 用）。 */
    @PostMapping("/{draftId}/auto-complete")
    public Map<String, Object> autoComplete(@PathVariable long leagueId, @PathVariable long draftId) {
        leagues.requireCommissioner(leagueId, Auth.require());
        check(leagueId, draftId);
        int n = 0;
        while (drafts.inProgress(draftId)) {
            drafts.autoPick(draftId);
            n++;
        }
        return Map.of("picks", n);
    }

    private void check(long leagueId, long draftId) {
        if (drafts.leagueOf(draftId) != leagueId) {
            throw ApiException.notFound("選秀不存在");
        }
    }
}
