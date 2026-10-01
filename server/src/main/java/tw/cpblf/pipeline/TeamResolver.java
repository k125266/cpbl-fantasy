package tw.cpblf.pipeline;

import java.util.List;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** 以球隊名稱比對內部代碼。官網隊名可能隨冠名變動，以 source_name_pattern 子字串比對。 */
@Component
public class TeamResolver {

    private record Pattern(String code, String pattern) {
    }

    private final List<Pattern> patterns;

    public TeamResolver(JdbcClient jdbc) {
        this.patterns = jdbc.sql("select code, source_name_pattern from cpbl_team")
                .query((rs, n) -> new Pattern(rs.getString(1), rs.getString(2))).list();
    }

    public String resolve(String sourceName) {
        if (sourceName == null) {
            return null;
        }
        for (Pattern p : patterns) {
            if (sourceName.contains(p.pattern())) {
                return p.code();
            }
        }
        return null;
    }
}
