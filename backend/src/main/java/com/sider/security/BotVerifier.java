package com.sider.security;

import com.sider.config.SiderConfig;
import com.sider.web.ApiException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class BotVerifier {
    private final SiderConfig config;
    private final SharedRateLimiter limiter;
    private final RemoteJson remote;
    public BotVerifier(SiderConfig config, SharedRateLimiter limiter, RemoteJson remote) {
        this.config = config; this.limiter = limiter; this.remote = remote;
    }
    private static String encoded(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    public void verify(boolean required, String token, String action, String ip) {
        if (!required) return;
        if (token == null || token.isEmpty()) throw new ApiException(403, "bot_challenge_required");
        if (token.length() > 4096 || token.chars().anyMatch(Character::isISOControl)) throw new ApiException(403, "bot_challenge_invalid");
        String form = "secret=" + encoded(config.text("BOT_VERIFY_SECRET")) + "&response=" + encoded(token) + "&remoteip=" + encoded(ip);
        RemoteJson.Result result = remote.call(HttpRequest.newBuilder(URI.create(config.text("BOT_VERIFY_URL")))
                .timeout(Duration.ofSeconds(5)).header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form)).build(), 5, "bot_challenge_unavailable");
        if (result.status() != 200) throw new ApiException(503, "bot_challenge_unavailable");
        if (!valid(result.body(), URI.create(config.text("APP_BASE_URL")).getHost(), action, Instant.now()))
            throw new ApiException(403, "bot_challenge_invalid");
        Object replay;
        try { replay = limiter.command(List.of("SET", "shsid:bot:" + Credentials.sha256(token), "1", "EX", 600, "NX")); }
        catch (ApiException error) { throw new ApiException(503, "bot_challenge_unavailable"); }
        if (!"OK".equals(replay)) throw new ApiException(403, "bot_challenge_invalid");
    }
    public static boolean valid(Map<String, Object> body, String hostname, String action, Instant now) {
        if (!Boolean.TRUE.equals(body.get("success")) || !hostname.equals(body.get("hostname")) || !action.equals(body.get("action"))) return false;
        try {
            return Math.abs(Duration.between(Instant.parse((String) body.get("challenge_ts")), now).toMillis()) <= 300000;
        } catch (RuntimeException error) { return false; }
    }
}
