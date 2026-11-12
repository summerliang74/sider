package com.sider.security;

import com.sider.config.SiderConfig;
import com.sider.web.ApiException;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class BotAndReplayTest {
    private final SiderConfig config = new SiderConfig(new MockEnvironment()
            .withProperty("APP_BASE_URL", "https://app.school.test")
            .withProperty("BOT_VERIFY_URL", "https://challenges.cloudflare.com/turnstile/v0/siteverify")
            .withProperty("BOT_VERIFY_SECRET", "secret-not-for-logging")
            .withProperty("SESSION_TOKEN_PEPPER", "independent-session-pepper-12345678"));

    @Test void botBindingRequiresExactHostActionAndFreshTimestamp() {
        Instant now = Instant.parse("2026-11-11T08:00:00Z");
        Map<String, Object> result = new HashMap<>(Map.of("success", true, "hostname", "app.school.test", "action", "download", "challenge_ts", now.toString()));
        assertThat(BotVerifier.valid(result, "app.school.test", "download", now)).isTrue();
        assertThat(BotVerifier.valid(result, "app.school.test", "upload", now)).isFalse();
        assertThat(BotVerifier.valid(result, "evil.test", "download", now)).isFalse();
        assertThat(BotVerifier.valid(result, "app.school.test", "download", now.plusSeconds(301))).isFalse();
        assertThat(BotVerifier.valid(result, "app.school.test", "download", now.minusSeconds(301))).isFalse();
    }

    @Test void verifiedBotTokenCannotBeConsumedTwiceAndRedisFailureClosesOperation() {
        RemoteJson remote = mock(RemoteJson.class);
        SharedRateLimiter limiter = mock(SharedRateLimiter.class);
        when(remote.call(any(), eq(5), eq("bot_challenge_unavailable"))).thenReturn(new RemoteJson.Result(200,
                Map.of("success", true, "hostname", "app.school.test", "action", "download", "challenge_ts", Instant.now().toString())));
        when(limiter.command(anyList())).thenReturn("OK").thenReturn(null).thenThrow(new ApiException(503, "service_unavailable"));
        BotVerifier verifier = new BotVerifier(config, limiter, remote);
        verifier.verify(true, "opaque-bot-token", "download", "unknown");
        assertThatThrownBy(() -> verifier.verify(true, "opaque-bot-token", "download", "unknown")).hasMessage("bot_challenge_invalid");
        assertThatThrownBy(() -> verifier.verify(true, "other-bot-token", "download", "unknown")).hasMessage("bot_challenge_unavailable");
    }

    @Test void loginFingerprintReservationIsAtomicDomainSeparatedAndBounded() {
        SharedRateLimiter limiter = spy(new SharedRateLimiter(config, mock(RemoteJson.class), JsonMapper.builder().build()));
        doReturn("OK").doReturn(null).when(limiter).command(anyList());
        limiter.reserveLogin("platform-secret-token");
        assertThatThrownBy(() -> limiter.reserveLogin("platform-secret-token")).hasMessage("login_exchange_replayed");
        @SuppressWarnings("rawtypes") ArgumentCaptor<List> commands = ArgumentCaptor.forClass(List.class);
        verify(limiter, times(2)).command(commands.capture());
        List<?> first = commands.getAllValues().getFirst();
        assertThat(first.get(0)).isEqualTo("SET"); assertThat(first.get(3)).isEqualTo("EX");
        assertThat(first.get(4)).isEqualTo(3900); assertThat(first.get(5)).isEqualTo("NX");
        assertThat(first.get(1).toString()).doesNotContain("platform-secret-token");
        assertThat(first.get(1)).isEqualTo(commands.getAllValues().get(1).get(1));
        assertThat(first.get(1).toString()).doesNotEndWith(Credentials.hmac("platform-secret-token", "independent-session-pepper-12345678"));
    }
}
