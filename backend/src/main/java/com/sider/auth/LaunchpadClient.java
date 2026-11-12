package com.sider.auth;

import com.sider.config.SiderConfig;
import com.sider.security.RemoteJson;
import com.sider.web.ApiException;
import java.net.URI;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class LaunchpadClient {
    public record Profile(String sub, String email, String name, String picture, String org, boolean verified) {}
    private final SiderConfig config;
    private final RemoteJson remote;
    public LaunchpadClient(SiderConfig config, RemoteJson remote) { this.config = config; this.remote = remote; }

    public Profile userinfo(String token) {
        URI origin = URI.create(config.text("APP_BASE_URL"));
        HttpRequest.Builder request = HttpRequest.newBuilder(origin.resolve("/dashboard-api/oauth/bootstrap"))
                .timeout(Duration.ofSeconds(10));
        if (!config.production() && "1".equals(config.text("SHSID_LAUNCHPAD_OIDC_DEV", "0"))) {
            // APP_BASE_URL is validated by SiderConfig and cannot contain JSON delimiters.
            request.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString("{\"devOrigin\":\"" + origin + "\"}"));
        } else request.POST(HttpRequest.BodyPublishers.noBody());
        RemoteJson.Result bootstrap = remote.call(request.build(), 10, "platform_unavailable");
        if (bootstrap.status() != 200) throw new ApiException(503, "platform_unavailable");
        Map<String, Object> body = bootstrap.body();
        String redirect = text(body, "redirect_uri", 2048, false);
        if (!origin.resolve("/__lp_auth/callback").toString().equals(redirect)) throw new ApiException(503, "platform_unavailable");
        URI endpoint;
        try {
            URI advertised = URI.create(text(body, "userinfo_endpoint", 2048, false));
            // Bootstrap may advertise the platform issuer URL. Credentials still travel
            // only through the fixed, trusted application bridge, never an arbitrary URL.
            if (advertised.getHost() == null || advertised.getRawQuery() != null || advertised.getFragment() != null
                    || advertised.getUserInfo() != null || !("https".equals(advertised.getScheme())
                    || !config.production() && sameOrigin(origin, advertised)))
                throw new IllegalArgumentException();
            endpoint = origin.resolve("/dashboard-api/oauth/userinfo");
            Object rawScopes = body.get("scopes");
            List<?> scopes = rawScopes instanceof List<?> list ? list
                    : rawScopes instanceof String string ? Arrays.asList(string.split("\\s+")) : List.of();
            if (!scopes.containsAll(List.of("openid", "profile", "email", "allows"))) throw new IllegalArgumentException();
        } catch (RuntimeException error) { throw new ApiException(503, "platform_unavailable"); }
        RemoteJson.Result result = remote.call(HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(10))
                .header("Authorization", "Bearer " + token).GET().build(), 10, "platform_unavailable");
        if (result.status() == 401 || result.status() == 403) throw new ApiException(401, "invalid_token");
        if (result.status() != 200) throw new ApiException(503, "platform_unavailable");
        return profile(result.body());
    }

    private static boolean sameOrigin(URI first, URI second) {
        return first.getScheme().equals(second.getScheme()) && first.getHost().equalsIgnoreCase(second.getHost())
                && effectivePort(first) == effectivePort(second);
    }
    private static int effectivePort(URI value) { return value.getPort() >= 0 ? value.getPort() : "https".equals(value.getScheme()) ? 443 : 80; }

    public static Profile profile(Map<String, Object> body) {
        String sub = text(body, "sub", 255, false);
        String email = text(body, "email", 320, true);
        if (email != null && !email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) throw new ApiException(503, "platform_unavailable");
        String name = text(body, "name", 200, true);
        String picture = text(body, "picture", 2048, true);
        if (picture != null) {
            try { if (!"https".equals(URI.create(picture).getScheme())) throw new IllegalArgumentException(); }
            catch (RuntimeException error) { throw new ApiException(503, "platform_unavailable"); }
        }
        String org = text(body, "org", 200, true);
        if (!(body.get("verified") instanceof Boolean verified)) throw new ApiException(503, "platform_unavailable");
        Object allows = body.get("allows");
        if (body.containsKey("allows") && (!(allows instanceof Map<?, ?> map) || map.size() > 100
                || map.keySet().stream().anyMatch(key -> !(key instanceof String string) || string.length() > 100)))
            throw new ApiException(503, "platform_unavailable");
        return new Profile(sub, email, name, picture, org == null ? "personal:" + sub : org, verified);
    }

    private static String text(Map<String, Object> body, String key, int maximum, boolean nullable) {
        Object value = body.get(key);
        if (nullable && (value == null || "".equals(value))) return null;
        if (!(value instanceof String string) || string.isBlank() || string.length() > maximum
                || string.chars().anyMatch(Character::isISOControl)) throw new ApiException(503, "platform_unavailable");
        return string;
    }
}
