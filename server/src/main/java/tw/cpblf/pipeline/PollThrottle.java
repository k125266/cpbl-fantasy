package tw.cpblf.pipeline;

import java.time.Duration;

/**
 * 輪詢的最短間隔保護。排程用 fixedRate（開始時間固定對齊，不會每次多出執行時間而越來越晚），
 * 但上一次跑太久時 fixedRate 會「追趕」連續執行；這裡讓距離上一次開始太近的那一次直接略過，
 * 守住「即時輪詢間隔 ≥ 60 秒」（規則書 10.3）。用 nanoTime，不受 demo 模擬時鐘影響。
 */
final class PollThrottle {

    private final long minNanos;
    private boolean started;
    private long lastStart;

    PollThrottle(Duration minSpacing) {
        this.minNanos = minSpacing.toNanos();
    }

    /** 可以開始就記下這次的開始時間並回傳 true。 */
    synchronized boolean tryStart(long nowNanos) {
        if (started && nowNanos - lastStart < minNanos) {
            return false;
        }
        started = true;
        lastStart = nowNanos;
        return true;
    }
}
