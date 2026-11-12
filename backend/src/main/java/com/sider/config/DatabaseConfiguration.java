package com.sider.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
public class DatabaseConfiguration {
    @Bean(destroyMethod = "close") public HikariDataSource dataSource(SiderConfig env) {
        DatabaseUrl url = DatabaseUrl.parse(env.text("DATABASE_URL"), env.production());
        HikariConfig c = new HikariConfig();
        c.setJdbcUrl(url.jdbcUrl()); c.setUsername(url.username()); c.setPassword(url.password()); c.setDataSourceProperties(url.properties());
        c.setMaximumPoolSize(env.number("DATABASE_MAX_CONNECTIONS", 5)); c.setMinimumIdle(0);
        c.setConnectionTimeout(10000); c.setIdleTimeout(300000); c.setMaxLifetime(1500000);
        c.setInitializationFailTimeout(-1); c.setPoolName("sider");
        c.setConnectionInitSql("SET statement_timeout='5s'; SET lock_timeout='2s'");
        return new HikariDataSource(c);
    }
    @Bean public JdbcTemplate jdbcTemplate(DataSource ds) { return new JdbcTemplate(ds); }
    @Bean public NamedParameterJdbcTemplate namedJdbc(JdbcTemplate jdbc) { return new NamedParameterJdbcTemplate(jdbc); }
    @Bean public JdbcTransactionManager transactionManager(DataSource ds) { return new JdbcTransactionManager(ds); }
    @Bean public TransactionTemplate transactionTemplate(JdbcTransactionManager tm) { return new TransactionTemplate(tm); }
}
