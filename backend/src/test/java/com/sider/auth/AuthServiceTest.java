package com.sider.auth;

import com.sider.config.SiderConfig;
import com.sider.security.Credentials;
import com.sider.web.ApiException;
import jakarta.servlet.http.Cookie;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AuthServiceTest {
    private static final UUID ID = UUID.fromString("11373201-18b6-48fa-b8a7-41ba8c281736");
    private final NamedParameterJdbcTemplate db = mock(NamedParameterJdbcTemplate.class);
    private final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
    private final MockEnvironment environment = new MockEnvironment()
            .withProperty("SESSION_TOKEN_PEPPER", "independent-session-pepper-12345678")
            .withProperty("SHSID_ADMIN_SUBS", "platform:admin");
    private AuthService auth() {
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        return new AuthService(db, new TransactionTemplate(manager), new SiderConfig(environment));
    }
    private static Map<String, Object> row(String role, String sub) {
        Map<String, Object> row = new HashMap<>();
        row.put("id", ID); row.put("display_name", "Student"); row.put("role", role);
        row.put("launchpad_sub", sub); row.put("org", "SHSID"); row.put("status", "active");
        return row;
    }

    @Test void nodeSessionHmacIsPreservedAndBearerIsNotBusinessAuthentication() {
        assertThat(Credentials.hmac("opaque_session_token", environment.getProperty("SESSION_TOKEN_PEPPER")))
                .isEqualTo("TfE2syijAHDo8ucql1s4T39K79h99Xo2C05-sAFgu3o");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer opaque_session_token");
        assertThat(auth().current(request)).isNull();
        verifyNoInteractions(db);
    }

    @Test void headerIsExplicitProfileOnlyAndConflictingCookieCannotChooseIdentity() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("x-sider-session", "opaque_session_token");
        assertThatThrownBy(() -> auth().sessionToken(request)).isInstanceOf(ApiException.class).hasMessage("unauthorized");
        environment.withProperty("SESSION_TRANSPORT", "header-compat");
        assertThat(auth().sessionToken(request)).isEqualTo("opaque_session_token");
        request.setCookies(new Cookie("shsid_session", "other_token"));
        assertThatThrownBy(() -> auth().sessionToken(request)).isInstanceOf(ApiException.class).hasMessage("unauthorized");
        request.setCookies(new Cookie("shsid_session", "opaque_session_token"));
        assertThat(auth().sessionToken(request)).isEqualTo("opaque_session_token");
    }

    @Test void allowlistDemotionCommitsRevocationBeforeReturningAnonymous() {
        when(db.queryForList(contains("FROM users u JOIN sessions"), anyMap())).thenReturn(List.of(row("admin", "removed-admin")));
        when(db.queryForList(contains("FOR UPDATE"), anyMap())).thenReturn(List.of(row("admin", "removed-admin")));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("shsid_session", "opaque_session_token"));
        assertThat(auth().current(request)).isNull();
        verify(db).update(contains("UPDATE users SET role"), argThat((Map<String, ?> values) -> "student".equals(values.get("role"))));
        verify(db).update(contains("UPDATE sessions SET revoked_at"), anyMap());
        verify(manager).commit(any());
    }

    @Test void sessionLookupFiltersSuspensionExpiryAndRevocationAndDoesNotExposePlatformSub() {
        when(db.queryForList(contains("FROM users u JOIN sessions"), anyMap())).thenReturn(List.of(row("student", "student:1")));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("shsid_session", "opaque_session_token"));
        CurrentUser user = auth().require(request);
        assertThat(user.id()).isEqualTo(ID);
        assertThat(user.role()).isEqualTo("student");
        verify(db).queryForList(argThat((String sql) -> sql.contains("s.revoked_at IS NULL") && sql.contains("expires_at>clock_timestamp()") && sql.contains("u.status='active'")),
                argThat((Map<String, ?> values) -> "TfE2syijAHDo8ucql1s4T39K79h99Xo2C05-sAFgu3o".equals(values.get("hash"))));
    }

    @Test void writeAuthorizationLockCannotSilentlyRunOutsideCallerTransaction() {
        CurrentUser user = new CurrentUser(ID, "Student", null, null, "SHSID", "student");
        assertThatThrownBy(() -> auth().lockCurrent(user, new MockHttpServletRequest()))
                .isInstanceOf(IllegalStateException.class).hasMessage("auth_lock_requires_transaction");
        verifyNoInteractions(db);
    }

    @Test void returnDestinationRejectsOpenRedirectsAndEncodedInternalTraversal() {
        assertThat(AuthController.safeReturnTo("/resources?q=biology#section")).isEqualTo("/resources?q=biology");
        for (String invalid : List.of("//evil.test", "/%2f/evil.test", "/resources/%2e%2e/dashboard-api", "/resources/%252e%252e/dashboard-api", "/api/internal/ready", "/dashboard-api/oauth", "/resources\\evil"))
            assertThat(AuthController.safeReturnTo(invalid)).as(invalid).isEqualTo("/resources");
        assertThat(AuthController.safeReturnTo("/admin/reports")).isEqualTo("/admin/reports");
    }
}
