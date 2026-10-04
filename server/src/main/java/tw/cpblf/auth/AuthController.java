package tw.cpblf.auth;

import java.util.Map;

import org.springframework.http.ResponseCookie;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import tw.cpblf.config.AppProperties;
import tw.cpblf.league.LeagueService;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;
    private final LeagueService leagues;
    private final AppProperties props;

    public AuthController(AuthService auth, LeagueService leagues, AppProperties props) {
        this.auth = auth;
        this.leagues = leagues;
        this.props = props;
    }

    /** 設計稿四步流程最後一次送出：邀請碼（加入）或建盟碼＋聯盟名稱（建立），加上隊伍。 */
    public record RegisterRequest(String username, String displayName, String password, String inviteCode, String createCode,
                                  String leagueName, String teamName, String teamAbbr, String teamIcon, String teamColor) {
    }

    public record LoginRequest(String username, String password) {
    }

    @PostMapping("/register")
    public CurrentUser register(@RequestBody RegisterRequest req, HttpServletResponse res) {
        CurrentUser user = leagues.register(new LeagueService.Registration(req.username(), req.displayName(), req.password(),
                req.inviteCode(), req.createCode(), req.leagueName(), props.seasonYear(),
                new LeagueService.TeamIdentity(req.teamName(), req.teamAbbr(), req.teamIcon(), req.teamColor())));
        setCookie(res, auth.createSession(user.id()));
        return user;
    }

    @PostMapping("/login")
    public CurrentUser login(@RequestBody LoginRequest req, HttpServletResponse res) {
        CurrentUser user = auth.authenticate(req.username(), req.password());
        setCookie(res, auth.createSession(user.id()));
        return user;
    }

    @PostMapping("/logout")
    public Map<String, Boolean> logout(HttpServletRequest req, HttpServletResponse res) {
        String token = AuthInterceptor.tokenFrom(req);
        if (token != null) {
            auth.logout(token);
        }
        res.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(AuthInterceptor.COOKIE, "").path("/").maxAge(0).build().toString());
        return Map.of("ok", true);
    }

    @GetMapping("/me")
    public CurrentUser me() {
        return Auth.require();
    }

    @DeleteMapping("/me")
    public Map<String, Boolean> deleteMe(HttpServletResponse res) {
        auth.deleteAccount(Auth.require().id());
        res.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(AuthInterceptor.COOKIE, "").path("/").maxAge(0).build().toString());
        return Map.of("ok", true);
    }

    private static void setCookie(HttpServletResponse res, String token) {
        ResponseCookie cookie = ResponseCookie.from(AuthInterceptor.COOKIE, token)
                .httpOnly(true).sameSite("Lax").path("/").maxAge(AuthService.SESSION_TTL).build();
        res.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
