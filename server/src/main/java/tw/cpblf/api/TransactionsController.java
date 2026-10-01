package tw.cpblf.api;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import tw.cpblf.auth.Auth;
import tw.cpblf.league.LeagueService;
import tw.cpblf.trade.TradeService;
import tw.cpblf.waiver.WaiverService;

/** Waiver 出價與交易。 */
@RestController
@RequestMapping("/api/leagues/{leagueId}")
public class TransactionsController {

    private final LeagueService leagues;
    private final WaiverService waivers;
    private final TradeService trades;

    public TransactionsController(LeagueService leagues, WaiverService waivers, TradeService trades) {
        this.leagues = leagues;
        this.waivers = waivers;
        this.trades = trades;
    }

    @GetMapping("/waivers")
    public Map<String, Object> waivers(@PathVariable long leagueId) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        return Map.of("claims", waivers.claims(leagueId, team), "players", waivers.waiverPlayers(leagueId));
    }

    public record ClaimRequest(long playerId, Long dropPlayerId, int bid) {
    }

    @PostMapping("/waivers/claims")
    public Map<String, Object> claim(@PathVariable long leagueId, @RequestBody ClaimRequest req) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        return Map.of("id", waivers.claim(team, req.playerId(), req.dropPlayerId(), req.bid()));
    }

    @DeleteMapping("/waivers/claims/{claimId}")
    public Map<String, Boolean> cancel(@PathVariable long leagueId, @PathVariable long claimId) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        waivers.cancel(team, claimId);
        return Map.of("ok", true);
    }

    @GetMapping("/trades")
    public List<TradeService.Trade> trades(@PathVariable long leagueId) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        return trades.list(leagueId, team);
    }

    public record Propose(long receiverTeamId, List<Long> give, List<Long> receive, String message) {
    }

    @PostMapping("/trades")
    public Map<String, Object> propose(@PathVariable long leagueId, @RequestBody Propose req) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        return Map.of("id", trades.propose(team, req.receiverTeamId(), req.give() == null ? List.of() : req.give(),
                req.receive() == null ? List.of() : req.receive(), req.message()));
    }

    public record Respond(boolean accept) {
    }

    @PostMapping("/trades/{tradeId}/respond")
    public Map<String, Boolean> respond(@PathVariable long leagueId, @PathVariable long tradeId, @RequestBody Respond req) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        trades.respond(team, tradeId, req.accept());
        return Map.of("ok", true);
    }

    public record Vote(boolean object) {
    }

    @PostMapping("/trades/{tradeId}/vote")
    public Map<String, Boolean> vote(@PathVariable long leagueId, @PathVariable long tradeId, @RequestBody Vote req) {
        long team = leagues.requireTeam(leagueId, Auth.require());
        trades.vote(team, tradeId, req.object());
        return Map.of("ok", true);
    }
}
