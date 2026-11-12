package com.sider.security;

import com.sider.config.SiderConfig;
import com.sider.web.ApiException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class ApiSecurityFilter extends OncePerRequestFilter {
    private static final int JSON_LIMIT = 65536;
    private final SiderConfig config;
    private final ObjectMapper mapper;
    private final ObjectMapper strict = JsonMapper.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    public ApiSecurityFilter(SiderConfig config, ObjectMapper mapper) { this.config = config; this.mapper = mapper; }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        headers(response);
        try {
            String path = request.getRequestURI();
            if (!path.startsWith("/api/")) { chain.doFilter(request, response); return; }
            validateQuery(request);
            String challengeToken = request.getHeader("x-bot-token");
            if (Collections.list(request.getHeaders("x-bot-token")).size() > 1
                    || challengeToken != null && (challengeToken.length() > 4096 || challengeToken.chars().anyMatch(Character::isISOControl)))
                throw new ApiException(400, "invalid_request");
            boolean write = Set.of("POST", "PUT", "PATCH", "DELETE").contains(request.getMethod());
            if (write && !path.startsWith("/api/internal/") && !"/api/auth/launchpad/start".equals(path)) requireOrigin(request);
            boolean binary = "PUT".equals(request.getMethod()) && path.matches("/api/resources/[^/]+/upload");
            boolean needsJson = Set.of("POST", "PATCH").contains(request.getMethod()) && !path.startsWith("/api/internal/")
                    && !Set.of("/api/auth/logout", "/api/auth/launchpad/start").contains(path);
            if (needsJson && !binary) {
                String contentType = request.getContentType();
                try {
                    if (contentType == null || !MediaType.APPLICATION_JSON.isCompatibleWith(MediaType.parseMediaType(contentType)))
                        throw new ApiException(415, "unsupported_media_type");
                    MediaType type = MediaType.parseMediaType(contentType);
                    if (type.getCharset() != null && !StandardCharsets.UTF_8.equals(type.getCharset())) throw new ApiException(415, "unsupported_media_type");
                } catch (IllegalArgumentException error) { throw new ApiException(415, "unsupported_media_type"); }
                if (request.getContentLengthLong() > JSON_LIMIT) throw new ApiException(413, "request_too_large");
                byte[] body = request.getInputStream().readNBytes(JSON_LIMIT + 1);
                if (body.length > JSON_LIMIT) throw new ApiException(413, "request_too_large");
                validateObject(path, body);
                chain.doFilter(new CachedRequest(request, body), response);
            } else chain.doFilter(request, response);
        } catch (ApiException error) {
            if (response.isCommitted()) throw error;
            response.resetBuffer();
            response.setStatus(error.status()); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
            Map<String, Object> body = Map.of("error", error.code());
            if (error instanceof RateLimitException rate) {
                response.setHeader("Retry-After", Integer.toString(rate.retryAfter()));
                body = Map.of("error", error.code(), "retryAfter", rate.retryAfter());
            }
            response.getWriter().write(mapper.writeValueAsString(body));
        }
    }

    private void requireOrigin(HttpServletRequest request) {
        String expected = config.text("APP_BASE_URL").replaceFirst("/$", "");
        String site = request.getHeader("Sec-Fetch-Site");
        if (Collections.list(request.getHeaders("Origin")).size() != 1 || !expected.equals(request.getHeader("Origin"))
                || Collections.list(request.getHeaders("Sec-Fetch-Site")).size() > 1 || site != null && !"same-origin".equals(site))
            throw new ApiException(403, "forbidden");
    }

    private void validateQuery(HttpServletRequest request) {
        Set<String> allowed = switch (request.getRequestURI()) {
            case "/api/resources" -> Set.of("q", "type", "tag", "collection", "cursor");
            case "/api/me/resources", "/api/admin/reports" -> Set.of("status", "cursor", "view");
            case "/api/admin/audit" -> Set.of("cursor", "view");
            case "/api/admin/dashboard" -> Set.of("range");
            default -> Set.of();
        };
        for (Map.Entry<String, String[]> entry : request.getParameterMap().entrySet())
            if (!allowed.contains(entry.getKey()) || entry.getValue().length != 1) throw new ApiException(400, "invalid_query");
    }

    @SuppressWarnings("unchecked")
    private void validateObject(String path, byte[] body) {
        Map<String, Object> values;
        try { values = strict.readValue(body, Map.class); }
        catch (RuntimeException error) { throw new ApiException(400, "invalid_request"); }
        if (values == null) throw new ApiException(400, "invalid_request");
        Set<String> keys;
        if ("/api/auth/launchpad/session".equals(path)) keys = Set.of("accessToken", "returnTo", "botToken");
        else if ("/api/resources/upload-intents".equals(path)) keys = Set.of("title", "description", "tags", "originalFilename", "sizeBytes", "mimeType", "botToken");
        else if ("/api/resources/upload-status".equals(path)) keys = Set.of("ids");
        else if (path.matches("/api/resources/[^/]+/(?:complete|download)")) keys = Set.of("botToken");
        else if (path.matches("/api/resources/[^/]+/reports")) keys = Set.of("reason", "details", "botToken");
        else if (path.matches("/api/resources/[^/]+")) keys = Set.of("title", "description", "tags", "botToken");
        else if (path.matches("/api/admin/reports/[^/]+")) keys = Set.of("note", "botToken");
        else if (path.matches("/api/admin/resources/[^/]+/moderate")) keys = Set.of("action", "reason", "reportId", "botToken");
        else if (path.matches("/api/admin/users/[^/]+/suspend")) keys = Set.of("reason", "botToken");
        else keys = Set.of();
        if (!keys.containsAll(values.keySet())) throw new ApiException(400, "invalid_request");
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            Object value = entry.getValue();
            if (value == null) throw new ApiException(400, "invalid_request");
            if (Set.of("tags", "ids").contains(entry.getKey())) {
                if (!(value instanceof java.util.List<?> list) || list.stream().anyMatch(item -> !(item instanceof String)))
                    throw new ApiException(400, "invalid_request");
            } else if ("sizeBytes".equals(entry.getKey())) {
                if (!(value instanceof Integer || value instanceof Long || value instanceof java.math.BigInteger))
                    throw new ApiException(400, "invalid_request");
            } else if (!(value instanceof String)) throw new ApiException(400, "invalid_request");
        }
        Object token = values.get("botToken");
        if (values.containsKey("botToken") && (!(token instanceof String text) || text.length() > 4096)) throw new ApiException(400, "invalid_request");
    }

    private void headers(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
        if (config.production()) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
        String storage = storageOrigins();
        response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; "
                + "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com "
                + storage + "; frame-src https://challenges.cloudflare.com; worker-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
    }

    private String storageOrigins() {
        URI endpoint = URI.create(config.text("S3_ENDPOINT"));
        String origin = endpoint.getScheme() + "://" + endpoint.getRawAuthority();
        if (config.flag("S3_FORCE_PATH_STYLE", false) || endpoint.getHost().startsWith(config.text("S3_BUCKET") + ".")) return origin;
        return origin + " " + endpoint.getScheme() + "://" + config.text("S3_BUCKET") + "." + endpoint.getHost()
                + (endpoint.getPort() == -1 ? "" : ":" + endpoint.getPort());
    }

    private static class CachedRequest extends HttpServletRequestWrapper {
        private final byte[] body;
        CachedRequest(HttpServletRequest request, byte[] body) { super(request); this.body = body; }
        @Override public ServletInputStream getInputStream() {
            ByteArrayInputStream stream = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override public int read() { return stream.read(); }
                @Override public int read(byte[] bytes, int offset, int length) { return stream.read(bytes, offset, length); }
                @Override public boolean isFinished() { return stream.available() == 0; }
                @Override public boolean isReady() { return true; }
                @Override public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException("synchronous_json_only"); }
            };
        }
        @Override public BufferedReader getReader() { return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8)); }
        @Override public int getContentLength() { return body.length; }
        @Override public long getContentLengthLong() { return body.length; }
    }
}
