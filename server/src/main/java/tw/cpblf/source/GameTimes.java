package tw.cpblf.source;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Optional;

/** 開賽時間：預設值與進階數據網站顯示時間的換算。 */
public final class GameTimes {

    private GameTimes() {
    }

    static final ZoneId TAIPEI = ZoneId.of("Asia/Taipei");
    static final LocalTime WEEKDAY_START = LocalTime.of(18, 35);
    static final LocalTime WEEKEND_START = LocalTime.of(17, 5);
    /**
     * 進階數據網站的賽程列表把台北時間當成 UTC 再轉一次，顯示時間比實際晚 8 小時，日期也可能跟著跳到隔天
     * （2026-10-05 實測：補賽 A-274 顯示「10月7日 02:35」，實際為 10/6 18:35）。
     */
    static final Duration SITE_OFFSET = Duration.ofHours(8);
    /** 換算後的合理開賽時段；超出就當作換算規則失效，改用預設時間。 */
    static final LocalTime EARLIEST = LocalTime.of(11, 0);
    static final LocalTime LATEST = LocalTime.of(21, 30);

    /** 網站沒有提供開賽時間時的預設：平日 18:35、週六日 17:05。 */
    public static Instant defaultStart(LocalDate date) {
        DayOfWeek d = date.getDayOfWeek();
        LocalTime t = d == DayOfWeek.SATURDAY || d == DayOfWeek.SUNDAY ? WEEKEND_START : WEEKDAY_START;
        return date.atTime(t).atZone(TAIPEI).toInstant();
    }

    /** 網站顯示的日期與時間 → 實際開賽時間；不在合理時段內回傳 empty。 */
    public static Optional<Instant> fromSiteDisplay(LocalDate shownDate, LocalTime shownTime) {
        LocalDateTime actual = shownDate.atTime(shownTime).minus(SITE_OFFSET);
        LocalTime t = actual.toLocalTime();
        if (t.isBefore(EARLIEST) || t.isAfter(LATEST)) {
            return Optional.empty();
        }
        return Optional.of(actual.atZone(TAIPEI).toInstant());
    }
}
