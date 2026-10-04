package tw.cpblf.api;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import tw.cpblf.auth.Auth;
import tw.cpblf.card.CardService;
import tw.cpblf.league.LeagueService;

/** 收藏卡資料：卡面數據、本聯盟的卡片履歷與成就印章。 */
@RestController
@RequestMapping("/api")
public class CardController {

    private final LeagueService leagues;
    private final CardService cards;

    public CardController(LeagueService leagues, CardService cards) {
        this.leagues = leagues;
        this.cards = cards;
    }

    @GetMapping("/leagues/{leagueId}/players/{playerId}/card")
    public CardService.Card card(@PathVariable long leagueId, @PathVariable long playerId) {
        leagues.requireMember(leagueId, Auth.require());
        return cards.card(leagues.get(leagueId), playerId);
    }
}
