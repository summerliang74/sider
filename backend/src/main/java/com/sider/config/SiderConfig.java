package com.sider.config;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class SiderConfig {
    private final Environment environment;
    public SiderConfig(Environment environment) { this.environment = environment; }
    public String text(String key) {
        String value = environment.getProperty(key);
        if (value == null || value.isBlank()) throw new IllegalStateException("Missing configuration: " + key);
        return value;
    }
    public String text(String key, String fallback) { return environment.getProperty(key, fallback); }
    public int number(String key, int fallback) {
        try { return Integer.parseInt(text(key, String.valueOf(fallback))); }
        catch (NumberFormatException e) { throw new IllegalStateException("Invalid integer configuration: " + key); }
    }
    public boolean flag(String key, boolean fallback) {
        String value = text(key, String.valueOf(fallback));
        if (!value.equals("true") && !value.equals("false")) throw new IllegalStateException("Invalid boolean configuration: " + key);
        return Boolean.parseBoolean(value);
    }
    public boolean production() {
        return Arrays.stream(environment.getActiveProfiles()).anyMatch(p -> p.equals("production") || p.equals("staging"))
            || Set.of("production", "staging").contains(text("SPRING_PROFILES_ACTIVE", "local"));
    }
    public boolean scannerEnabled() { return !text("MALWARE_SCAN_URL", "disabled").equals("disabled"); }
    @PostConstruct
    public void validate() {
        URI app = uri("APP_BASE_URL", text("APP_BASE_URL"));
        if (app.getUserInfo() != null || app.getQuery() != null || app.getFragment() != null || !Set.of("", "/").contains(app.getPath())) invalid("APP_BASE_URL");
        if (!(app.getScheme().equals("https") || !production() && app.getScheme().equals("http") && local(app.getHost()))) invalid("APP_BASE_URL");
        for (String key : List.of("SESSION_TOKEN_PEPPER", "CURSOR_SIGNING_KEY", "CRON_SECRET")) {
            if (text(key).getBytes(java.nio.charset.StandardCharsets.UTF_8).length < 32) invalid(key);
        }
        String transport = text("SESSION_TRANSPORT", "cookie");
        if (!Set.of("cookie", "header-compat").contains(transport)) invalid("SESSION_TRANSPORT");
        range("SESSION_TTL_SECONDS", 3600, 1, 3600);
        range("DATABASE_MAX_CONNECTIONS", 5, 1, 20);
        range("UPLOAD_MAX_BYTES", 52_428_800, 1, 524_288_000);
        range("MALWARE_SCAN_TIMEOUT_MS", 30000, 1000, 120000);
        range("RESOURCE_DELETE_RETENTION_DAYS", 7, 0, 90);
        range("OAUTH_START_IP_LIMIT", 300, 1, 100000);
        try { double multiplier=Double.parseDouble(text("RATE_LIMIT_MULTIPLIER","1")); if(!Double.isFinite(multiplier)||multiplier<=0||multiplier>10)invalid("RATE_LIMIT_MULTIPLIER"); }
        catch(NumberFormatException e){invalid("RATE_LIMIT_MULTIPLIER");}
        if(!text("S3_BUCKET").matches("[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]")||text("S3_BUCKET").contains(".."))invalid("S3_BUCKET");
        for(String key:List.of("RATE_LIMIT_TOKEN","BOT_VERIFY_SECRET"))if(text(key).length()<16)invalid(key);
        if (!text("TRUSTED_CLIENT_IP_HEADER", "x-real-ip").matches("[a-z0-9-]+")) invalid("TRUSTED_CLIENT_IP_HEADER");
        flag("UPLOAD_WORKER_ENABLED", true); flag("S3_FORCE_PATH_STYLE", false); flag("LEGACY_UPLOAD_ENABLED", false);
        if (production() && !text("SHSID_LAUNCHPAD_OIDC_DEV", "0").equals("0")) invalid("SHSID_LAUNCHPAD_OIDC_DEV");
        for (String key : List.of("DATABASE_URL", "SHSID_ADMIN_SUBS", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "RATE_LIMIT_URL", "RATE_LIMIT_TOKEN", "BOT_VERIFY_URL", "BOT_VERIFY_SECRET")) text(key);
        String site = text("BOT_SITE_KEY", text("NEXT_PUBLIC_BOT_SITE_KEY", ""));
        if (site.isBlank() || (!text("BOT_SITE_KEY", "").isBlank() && !text("NEXT_PUBLIC_BOT_SITE_KEY", site).equals(site))) invalid("BOT_SITE_KEY");
        for (String key : List.of("S3_ENDPOINT", "RATE_LIMIT_URL", "BOT_VERIFY_URL")) secureEndpoint(key);
        boolean disabledToken = text("MALWARE_SCAN_TOKEN", "disabled").equals("disabled");
        if (scannerEnabled() == disabledToken) invalid("MALWARE_SCAN_TOKEN");
        if (scannerEnabled()) { secureEndpoint("MALWARE_SCAN_URL"); if (text("MALWARE_SCAN_TOKEN").length() < 16) invalid("MALWARE_SCAN_TOKEN"); }
        DatabaseUrl.parse(text("DATABASE_URL"), production());
        if (production()) {
            for (String key : List.of("APP_BASE_URL", "SESSION_TOKEN_PEPPER", "CURSOR_SIGNING_KEY", "CRON_SECRET", "DATABASE_URL", "SHSID_ADMIN_SUBS", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "RATE_LIMIT_URL", "RATE_LIMIT_TOKEN", "BOT_VERIFY_SECRET")) {
                if (text(key).matches("(?is).*(replace|change-me|changeme|\\.example|\\.invalid).*")) invalid(key);
            }
        }
    }
    private void secureEndpoint(String key) {
        URI u = uri(key, text(key));
        if (u.getUserInfo() != null || u.getFragment() != null || !(u.getScheme().equals("https") || !production() && u.getScheme().equals("http") && local(u.getHost()))) invalid(key);
    }
    private URI uri(String key, String value) {
        try { URI u = URI.create(value); if (u.getHost() == null || u.getScheme() == null) invalid(key); return u; }
        catch (IllegalArgumentException e) { throw new IllegalStateException("Invalid configuration: " + key); }
    }
    private void range(String key, int fallback, int low, int high) { int n = number(key, fallback); if (n < low || n > high) invalid(key); }
    public static boolean local(String host) { return Set.of("localhost", "127.0.0.1", "[::1]", "::1").contains(host); }
    private void invalid(String key) { throw new IllegalStateException("Invalid configuration: " + key); }
}
