package tw.cpblf.auth;

public record CurrentUser(long id, String username, String displayName, boolean admin) {
}
