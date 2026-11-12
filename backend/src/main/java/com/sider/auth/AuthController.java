package com.sider.auth;

import com.sider.config.SiderConfig;
import com.sider.security.SecurityGate;
import com.sider.security.SharedRateLimiter;
import com.sider.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuthController {
    private final AuthService auth;
    private final SecurityGate gate;
    private final SharedRateLimiter limiter;
    private final LaunchpadClient platform;
    private final SiderConfig config;
    public AuthController(AuthService auth, SecurityGate gate, SharedRateLimiter limiter, LaunchpadClient platform, SiderConfig config) {
        this.auth = auth; this.gate = gate; this.limiter = limiter; this.platform = platform; this.config = config;
    }
    public record LoginRequest(String accessToken, String returnTo, String botToken) {
        @Override public String toString() { return "LoginRequest[credentials=redacted]"; }
    }

    @GetMapping("/api/config")
    public Map<String, Object> configuration() {
        return Map.of("botSiteKey", config.text("BOT_SITE_KEY", config.text("NEXT_PUBLIC_BOT_SITE_KEY", "")),
                "uploadMaxBytes", config.number("UPLOAD_MAX_BYTES", 52428800), "maxFiles", 5,
                "uploadConcurrency", 2, "uploadsEnabled", config.scannerEnabled(),
                "sessionTransport", config.text("SESSION_TRANSPORT", "cookie"));
    }

    @GetMapping("/api/me")
    public Map<String, Object> me(HttpServletRequest request) {
        return Map.of("user", gate.authorize(request, "page", null, false));
    }

    @PostMapping(value="/api/auth/launchpad/session", consumes="application/json")
    public ResponseEntity<Map<String, Object>> login(@RequestBody LoginRequest input, HttpServletRequest request) {
        Instant deadline = Instant.now().plusSeconds(60);
        if (input.accessToken() == null || input.accessToken().isEmpty() || input.accessToken().length() > 32768
                || input.accessToken().chars().anyMatch(c -> c <= 0x20 || c >= 0x7f))
            throw new ApiException(400, "invalid_request");
        if (input.botToken() != null && input.botToken().length() > 4096) throw new ApiException(400, "invalid_request");
        if (input.returnTo() != null && !validReturnToSyntax(input.returnTo())) throw new ApiException(400, "invalid_request");
        gate.publicOperation(request, "oauth_start", input.botToken(), true);
        limiter.reserveLogin(input.accessToken());
        // Reservation is deliberately not released on dependency errors or uncertain DB commit.
        LaunchpadClient.Profile profile = platform.userinfo(input.accessToken());
        AuthService.IssuedSession session = auth.login(profile, deadline);
        if (Instant.now().isAfter(deadline)) throw new ApiException(503, "platform_unavailable");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sessionTransport", auth.compatibility() ? "header-compat" : "cookie");
        result.put("expiresAt", session.expiresAt());
        result.put("redirectUrl", safeReturnTo(input.returnTo()));
        ResponseEntity.BodyBuilder response = ResponseEntity.ok().cacheControl(org.springframework.http.CacheControl.noStore());
        if (auth.compatibility()) result.put("accessToken", session.token());
        else response.header(HttpHeaders.SET_COOKIE, sessionCookie(session.token(), config.number("SESSION_TTL_SECONDS", 3600)).toString());
        return response.body(result);
    }

    @PostMapping("/api/auth/logout")
    public ResponseEntity<Map<String, String>> logout(HttpServletRequest request) {
        gate.publicOperation(request, "page", null, false);
        auth.logout(request);
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, sessionCookie("", 0).toString())
                .body(Map.of("redirectUrl", "/login"));
    }
    private ResponseCookie sessionCookie(String value, int maxAge) {
        boolean secure = "https".equals(URI.create(config.text("APP_BASE_URL")).getScheme());
        return ResponseCookie.from(auth.cookieName(), value).path("/").httpOnly(true).secure(secure)
                .sameSite("Lax").maxAge(Math.min(3600, maxAge)).build();
    }

    @GetMapping("/api/auth/launchpad/start")
    public ResponseEntity<Void> legacyStart() { return ResponseEntity.status(302).location(URI.create("/login")).build(); }
    @PostMapping("/api/auth/launchpad/start")
    public ResponseEntity<Map<String, String>> rejectLegacyStart() { return ResponseEntity.status(410).body(Map.of("error", "sdk_required")); }

    static boolean validReturnToSyntax(String value) {
        if (value.length() > 500 || !value.startsWith("/") || value.startsWith("//")
                || value.indexOf('\\') >= 0 || value.chars().anyMatch(Character::isISOControl)) return false;
        try {
            String decoded = java.net.URLDecoder.decode(value, java.nio.charset.StandardCharsets.UTF_8);
            if (decoded.startsWith("//") || decoded.indexOf('\\') >= 0 || decoded.chars().anyMatch(Character::isISOControl)) return false;
            // Reject multiply encoded controls/slashes rather than normalizing into a new destination.
            if (decoded.matches("(?is).*%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f).*")) return false;
            URI parsed = URI.create(value);
            return parsed.getHost() == null && parsed.getScheme() == null
                    && !parsed.getRawPath().matches("(?is).*%(?:2e|2f|5c|25).*" );
        } catch (RuntimeException error) { return false; }
    }

    public static String safeReturnTo(String value) {
        if (value == null || !validReturnToSyntax(value)) return "/resources";
        URI parsed = URI.create(value).normalize();
        String path = parsed.getPath();
        if (!path.matches("^/(?:resources|me/resources|admin/(?:dashboard|reports|audit))(?:/.*)?$")) return "/resources";
        return parsed.getRawPath() + (parsed.getRawQuery() == null ? "" : "?" + parsed.getRawQuery());
    }
}
