package com.sider.auth;

import com.sider.config.SiderConfig;
import com.sider.security.Credentials;
import com.sider.web.ApiException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AuthService {
    private static final String CACHE = AuthService.class.getName() + ".current";
    private final NamedParameterJdbcTemplate db;
    private final TransactionTemplate transactions;
    private final SiderConfig config;
    public AuthService(NamedParameterJdbcTemplate db, TransactionTemplate transactions, SiderConfig config) {
        this.db = db; this.transactions = transactions; this.config = config;
    }
    public String cookieName() { return config.production() ? "__Host-shsid_session" : "shsid_session"; }
    public boolean compatibility() { return "header-compat".equals(config.text("SESSION_TRANSPORT", "cookie")); }
    public String expectedRole(String sub) {
        return Arrays.stream(config.text("SHSID_ADMIN_SUBS").split(",")).map(String::trim).anyMatch(sub::equals) ? "admin" : "student";
    }
    public String sessionToken(HttpServletRequest request) {
        String cookie = null;
        if (request.getCookies() != null) {
            for (Cookie candidate : request.getCookies()) if (cookieName().equals(candidate.getName())) {
                if (cookie != null) throw new ApiException(401, "unauthorized");
                cookie = candidate.getValue();
            }
        }
        String header = request.getHeader("x-sider-session");
        if (java.util.Collections.list(request.getHeaders("x-sider-session")).size() > 1) throw new ApiException(401, "unauthorized");
        if (!compatibility() && header != null) throw new ApiException(401, "unauthorized");
        if (cookie != null && header != null && !Credentials.equal(cookie, header)) throw new ApiException(401, "unauthorized");
        String value = compatibility() && header != null ? header : cookie;
        if (value != null && (value.isEmpty() || value.length() > 4096 || !value.matches("[A-Za-z0-9_-]+")))
            throw new ApiException(401, "unauthorized");
        // Business Authorization: Bearer is intentionally never accepted.
        return value;
    }
    public CurrentUser current(HttpServletRequest request) {
        Object cached = request.getAttribute(CACHE);
        if (cached instanceof CurrentUser user) return user;
        String token = sessionToken(request);
        if (token == null) return null;
        String hash = Credentials.hmac(token, config.text("SESSION_TOKEN_PEPPER"));
        try {
            List<Map<String, Object>> rows = db.queryForList("""
                SELECT u.id,u.display_name,u.email,u.avatar_url,u.org,u.role::text,u.launchpad_sub
                FROM users u JOIN sessions s ON s.user_id=u.id
                WHERE s.token_hash=:hash AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
                  AND u.status='active'
                """, Map.of("hash", hash));
            if (rows.isEmpty()) return null;
            Map<String, Object> row = rows.getFirst();
            String role = expectedRole((String) row.get("launchpad_sub"));
            if (!role.equals(row.get("role"))) {
                Boolean demoted = transactions.execute(status -> {
                    List<Map<String, Object>> current = db.queryForList("SELECT id,role::text,status::text,launchpad_sub FROM users WHERE id=:id FOR UPDATE", Map.of("id", row.get("id")));
                    if (current.isEmpty() || !"active".equals(current.getFirst().get("status"))) return true;
                    String oldRole = (String) current.getFirst().get("role");
                    db.update("UPDATE users SET role=CAST(:role AS user_role),updated_at=now() WHERE id=:id", Map.of("id", row.get("id"), "role", role));
                    if ("admin".equals(oldRole) && "student".equals(role)) {
                        db.update("UPDATE sessions SET revoked_at=now() WHERE user_id=:id AND revoked_at IS NULL", Map.of("id", row.get("id")));
                        return true;
                    }
                    return false;
                });
                if (Boolean.TRUE.equals(demoted)) return null;
            }
            CurrentUser user = dto(row, role);
            request.setAttribute(CACHE, user);
            return user;
        } catch (DataAccessException error) { throw new ApiException(503, "service_unavailable"); }
    }
    public CurrentUser require(HttpServletRequest request) {
        CurrentUser user = current(request);
        if (user == null) throw new ApiException(401, "unauthorized");
        return user;
    }
    public CurrentUser requireAdmin(HttpServletRequest request) {
        CurrentUser user = require(request);
        if (!"admin".equals(user.role())) throw new ApiException(403, "forbidden");
        return user;
    }

    /** Caller owns transaction; locks participate in the same JDBC connection. */
    public CurrentUser lockCurrent(CurrentUser actor, HttpServletRequest request) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("auth_lock_requires_transaction");
        String token = sessionToken(request);
        if (token == null) throw new ApiException(401, "unauthorized");
        List<Map<String, Object>> rows = db.queryForList("""
                SELECT id,display_name,email,avatar_url,org,role::text,launchpad_sub,status::text
                FROM users WHERE id=:id FOR SHARE
                """, Map.of("id", actor.id()));
        if (rows.isEmpty()) throw new ApiException(401, "unauthorized");
        Map<String, Object> row = rows.getFirst();
        String role = expectedRole((String) row.get("launchpad_sub"));
        if (!"active".equals(row.get("status")) || !role.equals(row.get("role")) || !role.equals(actor.role()))
            throw new ApiException(401, "unauthorized");
        List<UUID> sessions = db.query("""
                SELECT id FROM sessions WHERE user_id=:id AND token_hash=:hash AND revoked_at IS NULL
                  AND expires_at>clock_timestamp() FOR SHARE
                """, Map.of("id", actor.id(), "hash", Credentials.hmac(token, config.text("SESSION_TOKEN_PEPPER"))),
                (rs, n) -> rs.getObject("id", UUID.class));
        if (sessions.isEmpty()) throw new ApiException(401, "unauthorized");
        return dto(row, role);
    }

    public record IssuedSession(String token, Instant expiresAt) {
        @Override public String toString() { return "IssuedSession[token=redacted,expiresAt=" + expiresAt + "]"; }
    }

    public IssuedSession login(LaunchpadClient.Profile profile, Instant deadline) {
        try {
            TransactionTemplate loginTransaction = new TransactionTemplate(transactions.getTransactionManager());
            loginTransaction.setTimeout(20);
            return loginTransaction.execute(status -> {
                if (Instant.now().isAfter(deadline)) throw new ApiException(503, "platform_unavailable");
                List<Map<String, Object>> existing = db.queryForList("SELECT id,role::text,status::text FROM users WHERE launchpad_sub=:sub FOR UPDATE", Map.of("sub", profile.sub()));
                if (!existing.isEmpty() && !"active".equals(existing.getFirst().get("status"))) throw new ApiException(403, "suspended");
                String role = expectedRole(profile.sub());
                Map<String, Object> values = new HashMap<>();
                values.put("sub", profile.sub()); values.put("email", profile.email()); values.put("name", profile.name() != null ? profile.name() : profile.email() != null ? profile.email() : "SHSID student");
                values.put("picture", profile.picture()); values.put("org", profile.org()); values.put("verified", profile.verified()); values.put("role", role);
                List<UUID> users = db.query("""
                    INSERT INTO users(launchpad_sub,email,display_name,avatar_url,org,verified,role)
                    VALUES(:sub,:email,:name,:picture,:org,:verified,CAST(:role AS user_role))
                    ON CONFLICT(launchpad_sub) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,
                      avatar_url=EXCLUDED.avatar_url,org=EXCLUDED.org,verified=EXCLUDED.verified,role=EXCLUDED.role,
                      updated_at=now(),last_login_at=now()
                    WHERE users.status='active' RETURNING id
                    """, values, (rs,n) -> rs.getObject("id", UUID.class));
                if (users.isEmpty()) throw new ApiException(403, "suspended");
                UUID id = users.getFirst();
                if (!existing.isEmpty() && "admin".equals(existing.getFirst().get("role")) && "student".equals(role))
                    db.update("UPDATE sessions SET revoked_at=now() WHERE user_id=:id AND revoked_at IS NULL", Map.of("id", id));
                IssuedSession session = new IssuedSession(Credentials.randomToken(), Instant.now().plusSeconds(Math.min(3600, config.number("SESSION_TTL_SECONDS", 3600))));
                db.update("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(:id,:hash,:expiry)", Map.of(
                        "id", id, "hash", Credentials.hmac(session.token(), config.text("SESSION_TOKEN_PEPPER")), "expiry", Timestamp.from(session.expiresAt())));
                if (Instant.now().isAfter(deadline)) throw new ApiException(503, "platform_unavailable");
                return session;
            });
        } catch (DataAccessException error) { throw new ApiException(503, "platform_unavailable"); }
    }

    public void logout(HttpServletRequest request) {
        String token = sessionToken(request);
        if (token == null) return;
        try {
            db.update("UPDATE sessions SET revoked_at=now() WHERE token_hash=:hash AND revoked_at IS NULL",
                    Map.of("hash", Credentials.hmac(token, config.text("SESSION_TOKEN_PEPPER"))));
            request.removeAttribute(CACHE);
        } catch (DataAccessException error) { throw new ApiException(503, "service_unavailable"); }
    }

    private static CurrentUser dto(Map<String, Object> row, String role) {
        return new CurrentUser((UUID) row.get("id"), (String) row.get("display_name"), (String) row.get("email"),
                (String) row.get("avatar_url"), (String) row.get("org"), role);
    }
}
