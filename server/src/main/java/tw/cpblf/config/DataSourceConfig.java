package tw.cpblf.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import tw.cpblf.demo.SimulatedDataSource;
import tw.cpblf.source.CpblDataSource;
import tw.cpblf.source.CpblWebDataSource;
import tw.cpblf.source.StatsSiteDataSource;

@Configuration
public class DataSourceConfig {

    @Bean
    public CpblDataSource cpblDataSource(AppProperties props, AppClock clock) {
        if (props.isDemo()) {
            return new SimulatedDataSource(clock, props.seasonYear(), props.demo().seed());
        }
        if ("stats".equalsIgnoreCase(props.source())) {
            return new StatsSiteDataSource(props);
        }
        if (!"web".equalsIgnoreCase(props.source())) {
            throw new IllegalStateException("未知的 cpblf.source：" + props.source());
        }
        return new CpblWebDataSource(props);
    }
}
