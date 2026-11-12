package com.sider.security;

import com.sider.auth.AuthService;
import com.sider.auth.CurrentUser;
import com.sider.config.SiderConfig;
import com.sider.web.ApiException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class SecurityGateTest {
    private final AuthService auth = mock(AuthService.class);
    private final SharedRateLimiter limiter = mock(SharedRateLimiter.class);
    private final BotVerifier bot = mock(BotVerifier.class);
    private final SecurityGate gate = new SecurityGate(auth, limiter, bot, new SiderConfig(new MockEnvironment()));
    @Test void coarseLimitRunsBeforeSessionAndPreventsAnyDownstreamWork() {
        MockHttpServletRequest request = new MockHttpServletRequest(); request.addHeader("x-real-ip", "192.0.2.12");
        when(limiter.consume("search", "ip", "192.0.2.12")).thenThrow(new RateLimitException(45));
        assertThatThrownBy(() -> gate.authorize(request, "search", null, true)).isInstanceOf(RateLimitException.class);
        verifyNoInteractions(auth, bot);
    }
    @Test void authenticatedQuotaAndRiskChallengePrecedeBusinessReturn() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        CurrentUser user = new CurrentUser(UUID.randomUUID(), "Student", null, null, "school", "student");
        when(auth.require(request)).thenReturn(user);
        when(limiter.consume("search", "user", user.id().toString())).thenReturn(true);
        assertThat(gate.authorize(request, "search", "challenge-token", true)).isEqualTo(user);
        InOrder order = inOrder(limiter, auth, bot);
        order.verify(limiter).consume("search", "ip", "unknown");
        order.verify(auth).require(request);
        order.verify(limiter).consume("search", "user", user.id().toString());
        order.verify(bot).verify(true, "challenge-token", "search", "unknown");
    }
    @Test void nonAdminCannotReachAdminBusinessOrBotProvider() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        when(auth.require(request)).thenReturn(new CurrentUser(UUID.randomUUID(), "Student", null, null, "school", "student"));
        assertThatThrownBy(() -> gate.authorize(request, "admin", "token", true)).isInstanceOf(ApiException.class).hasMessage("forbidden");
        verifyNoInteractions(bot);
    }
    @Test void onlyLiteralTrustedProxyAddressIsAccepted() {
        for (String invalid : new String[]{"evil.example", "1.2.3.4, 5.6.7.8", "999.1.2.3", "fe80::1%eth0"}) {
            MockHttpServletRequest request = new MockHttpServletRequest(); request.addHeader("x-real-ip", invalid);
            assertThat(gate.clientIp(request)).isEqualTo("unknown");
        }
    }
}
