package com.sider.security;

import com.sider.config.SiderConfig;
import com.sider.web.ApiException;
import java.net.URI;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
public class SharedRateLimiter {
    private record Policy(int ip, int user, int seconds) {}
    private static final Map<String, Policy> POLICIES = Map.ofEntries(
            Map.entry("page", new Policy(600, 0, 60)),
            Map.entry("oauth_start", new Policy(300, 0, 600)),
            Map.entry("oauth_callback", new Policy(600, 0, 600)),
            Map.entry("search", new Policy(120, 60, 60)),
            Map.entry("upload", new Policy(30, 10, 3600)),
            Map.entry("upload_transfer", new Policy(40, 12, 3600)),
            Map.entry("upload_status", new Policy(240, 30, 60)),
            Map.entry("complete", new Policy(60, 20, 3600)),
            Map.entry("download", new Policy(300, 120, 3600)),
            Map.entry("resource_write", new Policy(180, 60, 3600)),
            Map.entry("report", new Policy(30, 10, 86400)),
            Map.entry("admin", new Policy(300, 120, 3600)));
    private static final String COUNTER = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; local t=redis.call('TTL',KEYS[1]); return {n,t}";
    private final SiderConfig config;
    private final RemoteJson remote;
    private final ObjectMapper mapper;
    public SharedRateLimiter(SiderConfig config, RemoteJson remote, ObjectMapper mapper) {
        this.config = config; this.remote = remote; this.mapper = mapper;
    }

    public Object command(List<?> command) {
        RemoteJson.Result response = remote.call(HttpRequest.newBuilder(URI.create(config.text("RATE_LIMIT_URL")))
                .timeout(Duration.ofSeconds(3)).header("Authorization", "Bearer " + config.text("RATE_LIMIT_TOKEN"))
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(command))).build(),
                3, "service_unavailable");
        if (response.status() != 200 || !response.body().containsKey("result") || response.body().containsKey("error"))
            throw new ApiException(503, "service_unavailable");
        return response.body().get("result");
    }

    public boolean consume(String operation, String kind, String identity) {
        Policy policy = POLICIES.get(operation);
        if (policy == null || !("ip".equals(kind) || "user".equals(kind))) throw new IllegalArgumentException("invalid_rate_operation");
        int limit = "ip".equals(kind) ? policy.ip() : policy.user();
        if (limit == 0) return false;
        if ("ip".equals(kind) && "oauth_start".equals(operation)) limit = config.number("OAUTH_START_IP_LIMIT", 300);
        if ("ip".equals(kind) && "oauth_callback".equals(operation)) limit = config.number("OAUTH_CALLBACK_IP_LIMIT", 600);
        double multiplier = Double.parseDouble(config.text("RATE_LIMIT_MULTIPLIER", "1"));
        limit = Math.max(1, (int) Math.floor(limit * multiplier));
        String key = "shsid:rl:" + operation + ":" + kind + ":" + Credentials.hmac(identity, config.text("SESSION_TOKEN_PEPPER"));
        Object raw = command(List.of("EVAL", COUNTER, 1, key, policy.seconds()));
        if (!(raw instanceof List<?> values) || values.size() != 2
                || !(values.getFirst() instanceof Number count) || !(values.get(1) instanceof Number ttl)
                || count.longValue() < 1 || ttl.longValue() < 1) throw new ApiException(503, "service_unavailable");
        if (count.longValue() > limit) throw new RateLimitException(Math.toIntExact(Math.min(Integer.MAX_VALUE, ttl.longValue())));
        return count.longValue() >= Math.max(2, (int) Math.ceil(limit * 0.8));
    }

    public void reserveLogin(String platformToken) {
        String key = "shsid:login-exchange:" + Credentials.hmac("login-exchange\u0000" + platformToken, config.text("SESSION_TOKEN_PEPPER"));
        Object result = command(List.of("SET", key, "1", "EX", 3900, "NX"));
        if (result == null) throw new ApiException(409, "login_exchange_replayed");
        if (!"OK".equals(result)) throw new ApiException(503, "service_unavailable");
    }
}
