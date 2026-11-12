package com.sider.security;

import com.sider.auth.AuthService;
import com.sider.auth.CurrentUser;
import com.sider.config.SiderConfig;
import com.sider.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import org.springframework.stereotype.Service;

@Service
public class SecurityGate {
    private final AuthService auth;
    private final SharedRateLimiter limiter;
    private final BotVerifier bot;
    private final SiderConfig config;
    public SecurityGate(AuthService auth, SharedRateLimiter limiter, BotVerifier bot, SiderConfig config) {
        this.auth = auth; this.limiter = limiter; this.bot = bot; this.config = config;
    }
    public CurrentUser authorize(HttpServletRequest request, String operation, String botToken, boolean challenge) {
        String ip = clientIp(request);
        boolean risky = limiter.consume(operation, "ip", ip);
        CurrentUser user = auth.require(request);
        risky |= limiter.consume(operation, "user", user.id().toString());
        if ("admin".equals(operation) && !"admin".equals(user.role())) throw new ApiException(403, "forbidden");
        if (challenge) bot.verify(risky, botToken, operation, ip);
        return user;
    }
    public void publicOperation(HttpServletRequest request, String operation, String botToken, boolean challenge) {
        String ip = clientIp(request);
        boolean risky = limiter.consume(operation, "ip", ip);
        if (challenge) bot.verify(risky, botToken, operation, ip);
    }
    public String clientIp(HttpServletRequest request) {
        // Only trust the configured, proxy-overwritten header. Never resolve hostnames.
        String raw = request.getHeader(config.text("TRUSTED_CLIENT_IP_HEADER", "x-real-ip"));
        if (raw == null || java.util.Collections.list(request.getHeaders(config.text("TRUSTED_CLIENT_IP_HEADER", "x-real-ip"))).size() != 1) return "unknown";
        String value = raw.trim();
        if (value.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}")) {
            for (String part : value.split("\\.")) if (Integer.parseInt(part) > 255 || part.length() > 1 && part.startsWith("0")) return "unknown";
            return value;
        }
        if (!value.contains(":") || !value.matches("[0-9a-fA-F:.]+")) return "unknown";
        try { return InetAddress.getByName(value).getHostAddress(); }
        catch (java.net.UnknownHostException error) { return "unknown"; }
    }
}
