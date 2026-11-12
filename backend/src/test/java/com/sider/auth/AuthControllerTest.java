package com.sider.auth;

import com.sider.config.SiderConfig;
import com.sider.security.SecurityGate;
import com.sider.security.SharedRateLimiter;
import com.sider.web.ApiException;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AuthControllerTest {
    private final AuthService auth = mock(AuthService.class);
    private final SecurityGate gate = mock(SecurityGate.class);
    private final SharedRateLimiter limiter = mock(SharedRateLimiter.class);
    private final LaunchpadClient platform = mock(LaunchpadClient.class);
    private final SiderConfig config = new SiderConfig(new MockEnvironment().withProperty("APP_BASE_URL", "https://app.school.test"));
    private final AuthController controller = new AuthController(auth,gate,limiter,platform,config);

    @Test void cookieLoginNeverReturnsPlainSessionAndBindsSecureCookie() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        LaunchpadClient.Profile profile = new LaunchpadClient.Profile("platform:1", null,"Student",null,"school",false);
        when(platform.userinfo("opaque-platform-token")).thenReturn(profile);
        when(auth.login(eq(profile),any())).thenReturn(new AuthService.IssuedSession("opaque_sider_token", Instant.now().plusSeconds(3600)));
        when(auth.cookieName()).thenReturn("__Host-shsid_session");
        var response = controller.login(new AuthController.LoginRequest("opaque-platform-token","/resources",null),request);
        assertThat(response.getBody()).doesNotContainKey("accessToken").containsEntry("sessionTransport","cookie");
        assertThat(response.getHeaders().getFirst("Set-Cookie")).contains("__Host-shsid_session=opaque_sider_token", "Secure", "HttpOnly", "SameSite=Lax", "Path=/").doesNotContain("Domain=");
        InOrder sequence = inOrder(gate,limiter,platform,auth);
        sequence.verify(gate).publicOperation(request,"oauth_start",null,true);
        sequence.verify(limiter).reserveLogin("opaque-platform-token");
        sequence.verify(platform).userinfo("opaque-platform-token");
        sequence.verify(auth).login(eq(profile),any());
    }

    @Test void reservedExchangeRejectsBeforeAnyPlatformOrDatabaseWork() {
        doThrow(new ApiException(409,"login_exchange_replayed")).when(limiter).reserveLogin("opaque-platform-token");
        assertThatThrownBy(() -> controller.login(new AuthController.LoginRequest("opaque-platform-token",null,null), new MockHttpServletRequest()))
                .isInstanceOf(ApiException.class).hasMessage("login_exchange_replayed");
        verifyNoInteractions(platform,auth);
    }

    @Test void unverifiedPlatformProfileStillUsesPlatformIdentityBoundaryWithoutOrgGating() {
        var profile = LaunchpadClient.profile(new java.util.HashMap<>(java.util.Map.of("sub","platform:1","verified",false,"allows",java.util.Map.of())));
        assertThat(profile.org()).isEqualTo("personal:platform:1");
        assertThat(profile.verified()).isFalse();
        assertThat(profile.email()).isNull();
    }

    @Test void explicitCompatibilityResponseContainsOnlySiderTokenAndNoCookie() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        LaunchpadClient.Profile profile = new LaunchpadClient.Profile("platform:1", null,"Student",null,"school",false);
        when(auth.compatibility()).thenReturn(true);
        when(platform.userinfo("opaque-platform-token")).thenReturn(profile);
        when(auth.login(eq(profile),any())).thenReturn(new AuthService.IssuedSession("opaque_sider_token",Instant.now().plusSeconds(3600)));
        var response = controller.login(new AuthController.LoginRequest("opaque-platform-token",null,null),request);
        assertThat(response.getBody()).containsEntry("accessToken","opaque_sider_token").containsEntry("sessionTransport","header-compat");
        assertThat(response.getHeaders().getFirst("Set-Cookie")).isNull();
        assertThat(response.getBody().values()).doesNotContain("opaque-platform-token");
    }
}
