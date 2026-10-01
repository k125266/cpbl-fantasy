package tw.cpblf.source;

/** 收到速率限制回應。呼叫端必須停止該 job，不得重試繞過（規則書 10.3）。 */
public class RateLimitedException extends RuntimeException {
    public RateLimitedException(String message) {
        super(message);
    }
}
