package tw.cpblf.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class IpConverterTest {

    @Test
    void convertsThirdsNotation() {
        assertThat(IpConverter.outs("6")).isEqualTo(18);
        assertThat(IpConverter.outs("6.1")).isEqualTo(19);
        assertThat(IpConverter.outs("6.2")).isEqualTo(20);
        assertThat(IpConverter.outs("0.1")).isEqualTo(1);
        assertThat(IpConverter.outs(7, 0)).isEqualTo(21);
        assertThat(IpConverter.format(20)).isEqualTo("6.2");
    }

    @Test
    void rejectsInvalidThirds() {
        assertThatThrownBy(() -> IpConverter.outs("6.3")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void qsBoundary() {
        // QS = outs >= 18 且 ER <= 3
        assertThat(IpConverter.outs("6.0") >= 18).isTrue();
        assertThat(IpConverter.outs("5.2") >= 18).isFalse();
    }
}
