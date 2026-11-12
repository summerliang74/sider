package com.sider.config;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Parse credentials separately; never include the supplied URI in exceptions. */
public record DatabaseUrl(String jdbcUrl, String username, String password, Properties properties) {
    public static DatabaseUrl parse(String value, boolean production) {
        try {
            URI u = URI.create(value);
            if (!Set.of("postgres", "postgresql").contains(u.getScheme()) || u.getHost() == null || u.getFragment() != null || u.getRawPath() == null || u.getRawPath().length() < 2 || u.getUserInfo() == null) throw new IllegalArgumentException();
            String[] userinfo = u.getRawUserInfo().split(":", 2);
            if (userinfo.length != 2 || userinfo[0].isEmpty()) throw new IllegalArgumentException();
            Properties p = new Properties();
            if (u.getRawQuery() != null) for (String pair : u.getRawQuery().split("&")) {
                String[] kv = pair.split("=", 2);
                String key = decode(kv[0]);
                // Neon/libpq connection strings use snake_case while pgJDBC
                // exposes the same setting as channelBinding.
                if (key.equals("channel_binding")) key = "channelBinding";
                if (kv.length != 2 || !Set.of("sslmode", "sslrootcert", "channelBinding").contains(key) || p.containsKey(key)) throw new IllegalArgumentException();
                p.setProperty(key, decode(kv[1]));
            }
            String mode = p.getProperty("sslmode", production ? "verify-full" : "prefer");
            if (production && !mode.equals("verify-full")) throw new IllegalArgumentException();
            if (!production && !SiderConfig.local(u.getHost()) && !mode.equals("verify-full")) throw new IllegalArgumentException();
            p.setProperty("sslmode", mode);
            // LibPQFactory expects ~/.postgresql/root.crt. Public-CA services
            // such as Neon should use the JVM trust store when no explicit CA
            // file was supplied, while verify-full still enforces the hostname.
            if (mode.equals("verify-full") && !p.containsKey("sslrootcert"))
                p.setProperty("sslfactory", "org.postgresql.ssl.DefaultJavaSSLFactory");
            p.setProperty("prepareThreshold", "0"); p.setProperty("connectTimeout", "10"); p.setProperty("socketTimeout", "30");
            return new DatabaseUrl("jdbc:postgresql://" + u.getHost() + (u.getPort() == -1 ? "" : ":" + u.getPort()) + u.getRawPath(), decode(userinfo[0]), decode(userinfo[1]), p);
        } catch (RuntimeException e) { throw new IllegalStateException("Invalid DATABASE_URL (syntax, supported parameters or TLS)"); }
    }
    private static String decode(String value) { return URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8); }
    @Override public String toString() { return "DatabaseUrl[redacted]"; }
}
