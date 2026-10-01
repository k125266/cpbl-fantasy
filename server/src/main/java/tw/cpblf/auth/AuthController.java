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
import tw.cpblf.league.LeagueService;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;
    private final LeagueService leagues;

    public AuthController(AuthService auth, LeagueService leagues) {
        this.auth = auth;
        this.leagues = leagues;
    }

    public record RegisterRequest(String username, String displayName, String password, String inviteCode, String teamName,
                                  String teamAbbr) {
    }

    public record LoginRequest(String username, String password) {
    }

    @PostMapping("/register")
    public CurrentUser register(@RequestBody RegisterRequest req, HttpServletResponse res) {
        CurrentUser user = leagues.registerWithInvite(req.username(), req.displayName(), req.password(), req.inviteCode(),
                req.teamName(), req.teamAbbr());
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
