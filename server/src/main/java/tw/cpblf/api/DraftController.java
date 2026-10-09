package tw.cpblf.api;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import tw.cpblf.auth.Auth;
import tw.cpblf.auth.CurrentUser;
import tw.cpblf.common.ApiException;
import tw.cpblf.draft.DraftBoardService;
import tw.cpblf.draft.DraftService;
import tw.cpblf.league.LeagueService;

@RestController
@RequestMapping("/api/leagues/{leagueId}/drafts")
public class DraftController {

    private final LeagueService leagues;
    private final DraftService drafts;
    private final DraftBoardService board;

    public DraftController(LeagueService leagues, DraftService drafts, DraftBoardService board) {
        this.board = board;
        this.leagues = leagues;
        this.drafts = drafts;
    }

    @GetMapping
    public List<DraftService.DraftView> list(@PathVariable long leagueId) {
        CurrentUser u = Auth.require();
        leagues.requireMember(leagueId, u);
        drafts.ensureDrafts(leagueId); // 選秀自動進入「準備中」，不需要管理員建立
        return drafts.list(leagueId, leagues.teamOf(leagueId, u.id()).orElse(null));
    }

    @GetMapping("/{draftId}")
    public DraftService.DraftView get(@PathVariable long leagueId, @PathVariable long draftId) {
        CurrentUser u = Auth.require();
        leagues.requireMember(leagueId, u);
        check(leagueId, draftId);
        return drafts.view(draftId, leagues.teamOf(leagueId, u.id()).orElse(null));
    }

    /** @param pickSeconds 每手秒數；不填維持目前設定 */
    public record Begin(Integer pickSeconds) {
    }

    /**
     * 聯盟管理員按「開始選秀」：keeper 鎖定、馬上揭曉順位，動畫播完後自動開始第一手。
     * 沒有預設選秀時間——玩家自己討論好時間，管理員到時候按開始。
     */
    @PostMapping("/{draftId}/begin")
    public Map<String, Boolean> begin(@PathVariable long leagueId, @PathVariable long draftId, @RequestBody Begin req) {
        leagues.requireCommissioner(leagueId, Auth.require());
        check(leagueId, draftId);
        drafts.begin(draftId, req.pickSeconds());
        return Map.of("ok", true);
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

    /** 選秀室：可選球員（排名、數據、守位、補缺位、推薦）與我的先發缺位。 */
    @GetMapping("/{draftId}/board")
    public DraftBoardService.Board board(@PathVariable long leagueId, @PathVariable long draftId) {
        CurrentUser u = Auth.require();
        leagues.requireMember(leagueId, u);
        check(leagueId, draftId);
        return board.board(draftId, leagues.teamOf(leagueId, u.id()).orElse(null));
    }

    /** 自己的候選清單（預排清單），依順序；被選走的已排除。 */
    @GetMapping("/{draftId}/queue")
    public List<Long> queue(@PathVariable long leagueId, @PathVariable long draftId) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        check(leagueId, draftId);
        return drafts.queue(draftId, team);
    }

    /** 整份取代候選清單（加入、移除、調整順序都用這個）。 */
    @PutMapping("/{draftId}/queue")
    public List<Long> setQueue(@PathVariable long leagueId, @PathVariable long draftId, @RequestBody Keepers req) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        check(leagueId, draftId);
        return drafts.setQueue(draftId, team, req.playerIds());
    }

    public record Autopilot(long teamId, boolean on) {
    }

    /** 託管（E18）：自己的隊伍可以設定；聯盟管理員可以設定任何隊伍（例：電腦隊伍）。 */
    @PutMapping("/{draftId}/autopilot")
    public Map<String, Boolean> autopilot(@PathVariable long leagueId, @PathVariable long draftId, @RequestBody Autopilot req) {
        CurrentUser u = Auth.require();
        leagues.requireMember(leagueId, u);
        check(leagueId, draftId);
        Long mine = leagues.teamOf(leagueId, u.id()).orElse(null);
        if (mine == null || mine != req.teamId()) {
            leagues.requireCommissioner(leagueId, u);
        }
        drafts.setAutopilot(draftId, req.teamId(), req.on());
        return Map.of("ok", true);
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
        drafts.requireRevealShown(draftId);
        drafts.start(draftId);
        return Map.of("ok", true);
    }

    /** 聯盟管理員：暫停（倒數停住、不能選人）。 */
    @PostMapping("/{draftId}/pause")
    public Map<String, Boolean> pause(@PathVariable long leagueId, @PathVariable long draftId) {
        leagues.requireCommissioner(leagueId, Auth.require());
        check(leagueId, draftId);
        drafts.pause(draftId);
        return Map.of("ok", true);
    }

    /** 聯盟管理員：繼續（從暫停時剩下的秒數接著倒數）。 */
    @PostMapping("/{draftId}/resume")
    public Map<String, Boolean> resume(@PathVariable long leagueId, @PathVariable long draftId) {
        leagues.requireCommissioner(leagueId, Auth.require());
        check(leagueId, draftId);
        drafts.resume(draftId);
        return Map.of("ok", true);
    }

    public record PickSeconds(int seconds) {
    }

    /** 聯盟管理員：調整每手秒數，從下一手生效。 */
    @PutMapping("/{draftId}/pick-seconds")
    public Map<String, Boolean> pickSeconds(@PathVariable long leagueId, @PathVariable long draftId, @RequestBody PickSeconds req) {
        leagues.requireCommissioner(leagueId, Auth.require());
        check(leagueId, draftId);
        drafts.setPickSeconds(draftId, req.seconds());
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
