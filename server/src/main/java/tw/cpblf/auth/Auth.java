package tw.cpblf.auth;

import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

import tw.cpblf.common.ApiException;

public final class Auth {

    private Auth() {
    }

    public static CurrentUser require() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        Object u = attrs == null ? null : attrs.getAttribute(AuthInterceptor.ATTR, RequestAttributes.SCOPE_REQUEST);
        if (u instanceof CurrentUser cu) {
            return cu;
        }
        throw ApiException.unauthorized();
    }

    public static CurrentUser requireAdmin() {
        CurrentUser u = require();
        if (!u.admin()) {
            throw ApiException.forbidden("需要系統管理員權限");
        }
        return u;
    }
}
