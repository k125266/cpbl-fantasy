package tw.cpblf.pipeline;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;

import org.junit.jupiter.api.Test;

class PollThrottleTest {

    private static long s(long seconds) {
        return Duration.ofSeconds(seconds).toNanos();
    }

    @Test
    void firstPollAlwaysStartsAndCatchUpRunsAreSkipped() {
        PollThrottle t = new PollThrottle(Duration.ofSeconds(55));
        assertThat(t.tryStart(s(0))).isTrue();
        // 上一次跑了 90 秒，fixedRate 追趕：緊接著的下一次（距離開始只有 3 秒）要略過
        assertThat(t.tryStart(s(3))).isFalse();
        assertThat(t.tryStart(s(54))).isFalse();
        // 略過的不會重設計時：滿 55 秒就可以
        assertThat(t.tryStart(s(55))).isTrue();
        assertThat(t.tryStart(s(60))).isFalse();
        assertThat(t.tryStart(s(115))).isTrue();
    }

    @Test
    void normalSixtySecondCadenceIsNeverSkippedEvenWithJitter() {
        PollThrottle t = new PollThrottle(Duration.ofSeconds(55));
        long now = 0;
        for (int i = 0; i < 100; i++) {
            long jitter = (i % 2 == 0 ? 40 : -40) * 1_000_000L; // ±40 毫秒
            assertThat(t.tryStart(now + jitter)).as("poll %d", i).isTrue();
            now += s(60);
        }
    }
}
