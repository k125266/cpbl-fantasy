package tw.cpblf.pipeline;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import org.springframework.stereotype.Component;

/**
 * 球員資料的人工修正（resources/player-overrides.csv）。名單同步時優先於資料源的判斷，同步也不會覆蓋。
 *
 * <p>目前只有洋將標記：進階數據網站沒有國籍欄位，只能由「原名」推斷，部分球員無法判斷或判斷錯誤
 * （見 StatsSiteParsers.foreignByOriginalName）。之後由 E13 管理員設定頁取代這個檔案。
 */
@Component
public class PlayerOverrides {

    static final String RESOURCE = "/player-overrides.csv";

    private final Map<String, Boolean> foreign;

    public PlayerOverrides() {
        this(load());
    }

    PlayerOverrides(Map<String, Boolean> foreign) {
        this.foreign = Collections.unmodifiableMap(foreign);
    }

    /** 人工指定的洋將標記；沒有指定時為 null。 */
    public Boolean foreign(String cpblPlayerId) {
        return foreign.get(cpblPlayerId);
    }

    public int size() {
        return foreign.size();
    }

    /** 格式：cpbl_player_id,name,foreign,note；# 開頭為註解，第一列為標題。 */
    static Map<String, Boolean> load() {
        Map<String, Boolean> out = new HashMap<>();
        try (InputStream in = PlayerOverrides.class.getResourceAsStream(RESOURCE)) {
            if (in == null) {
                return out;
            }
            BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            boolean header = true;
            while ((line = r.readLine()) != null) {
                String l = line.strip();
                if (l.isEmpty() || l.startsWith("#")) {
                    continue;
                }
                if (header) {
                    header = false;
                    continue;
                }
                String[] f = l.split(",", 4);
                if (f.length < 3 || !(f[2].equals("true") || f[2].equals("false"))) {
                    throw new IllegalStateException("player-overrides.csv 格式錯誤：" + line);
                }
                out.put(f[0].strip(), Boolean.parseBoolean(f[2].strip()));
            }
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return out;
    }
}
