package tw.cpblf.demo;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import tw.cpblf.auth.AuthService;
import tw.cpblf.auth.CurrentUser;
import tw.cpblf.config.AppProperties;
import tw.cpblf.draft.DraftService;
import tw.cpblf.league.League;
import tw.cpblf.league.LeagueService;
import tw.cpblf.pipeline.Pipeline;
import tw.cpblf.season.SeasonService;
import tw.cpblf.source.CpblDataSource;

/**
 * demo 模式首次啟動時建立 5 名示範使用者與一個聯盟，並同步模擬賽季的名單與賽程。
 * 帳號 demo1（聯盟管理員兼系統管理員）～ demo5，密碼皆為 demo1234。
 */
@Component
public class DemoSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoSeeder.class);
    public static final String PASSWORD = "demo1234";

    private final AppProperties props;
    private final JdbcClient jdbc;
    private final AuthService auth;
    private final LeagueService leagues;
    private final SeasonService season;
    private final DraftService drafts;
    private final Pipeline pipeline;
    private final CpblDataSource source;

    public DemoSeeder(AppProperties props, JdbcClient jdbc, AuthService auth, LeagueService leagues, SeasonService season,
                      DraftService drafts, Pipeline pipeline, CpblDataSource source) {
        this.props = props;
        this.jdbc = jdbc;
        this.auth = auth;
        this.leagues = leagues;
        this.season = season;
        this.drafts = drafts;
        this.pipeline = pipeline;
        this.source = source;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!props.isDemo() || props.demo() == null || !props.demo().seedLeague()) {
            return;
        }
        int users = jdbc.sql("select count(*) from app_user").query(Integer.class).single();
        if (users > 0) {
            return;
        }
        seed();
    }

    public long seed() {
        log.info("demo 模式：建立示範聯盟");
        pipeline.syncRegistration();
        pipeline.pollSchedule();
        String[] teamNames = {"北區雷霆", "港都海風", "山城火焰", "平原快馬", "東岸浪潮"};
        String[] abbrs = {"雷霆", "海風", "火焰", "快馬", "浪潮"};
        CurrentUser commissioner = auth.createUserIfAbsent("demo1", "玩家一", PASSWORD, true);
        League league = leagues.create(commissioner, "Demo 聯盟", props.seasonYear(), teamNames[0], abbrs[0]);
        for (int i = 2; i <= 5; i++) {
            CurrentUser u = auth.createUserIfAbsent("demo" + i, "玩家" + "一二三四五".charAt(i - 1), PASSWORD, false);
            leagues.joinWithInvite(u, league.inviteCode(), teamNames[i - 1], abbrs[i - 1]);
        }
        if (source instanceof SimulatedDataSource sim) {
            season.setup(league.id(), new SeasonService.SetupRequest(sim.seasonStart(), sim.half1End(), sim.half2Start(),
                    sim.seasonEnd(), 14, 14));
            drafts.create(league.id(), 1, null);
        }
        return league.id();
    }
}
