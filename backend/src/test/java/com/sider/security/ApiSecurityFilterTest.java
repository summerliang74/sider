package com.sider.security;

import com.sider.config.SiderConfig;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

class ApiSecurityFilterTest {
    private final MockEnvironment environment = new MockEnvironment()
            .withProperty("APP_BASE_URL", "https://app.school.test")
            .withProperty("S3_ENDPOINT", "https://oss.storage.test")
            .withProperty("S3_BUCKET", "private-files")
            .withProperty("SPRING_PROFILES_ACTIVE", "production");
    private ApiSecurityFilter filter() { return new ApiSecurityFilter(new SiderConfig(environment), JsonMapper.builder().build()); }
    @Test void dashboardAllowsOnlyOneRangeAndKeepsNoStore() throws Exception {
        var request=new MockHttpServletRequest("GET","/api/admin/dashboard");request.addParameter("range","7d");
        var response=new MockHttpServletResponse();var called=new AtomicBoolean();
        filter().doFilter(request,response,(req,res)->called.set(true));assertThat(called).isTrue();assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        request.addParameter("range","30d");called.set(false);response=new MockHttpServletResponse();
        filter().doFilter(request,response,(req,res)->called.set(true));assertThat(called).isFalse();assertThat(response.getStatus()).isEqualTo(400);
    }
    private static MockHttpServletRequest json(String path, String text) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
        request.setContentType("application/json"); request.setContent(text.getBytes(StandardCharsets.UTF_8));
        request.addHeader("Origin", "https://app.school.test"); request.addHeader("Sec-Fetch-Site", "same-origin");
        return request;
    }

    @Test void strictOriginBlocksCrossSiteNullAndAbsentBeforeController() throws Exception {
        for (String origin : new String[] {null, "null", "https://evil.test"}) {
            MockHttpServletRequest request = json("/api/resources/upload-status", "{\"ids\":[]}");
            request.removeHeader("Origin"); if (origin != null) request.addHeader("Origin", origin);
            MockHttpServletResponse response = new MockHttpServletResponse();
            AtomicBoolean called = new AtomicBoolean();
            filter().doFilter(request, response, (req, res) -> called.set(true));
            assertThat(response.getStatus()).isEqualTo(403);
            assertThat(called).isFalse();
        }
        MockHttpServletRequest forged = json("/api/resources/upload-status", "{\"ids\":[]}");
        forged.removeHeader("Sec-Fetch-Site"); forged.addHeader("Sec-Fetch-Site", "cross-site");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter().doFilter(forged, response, (req,res) -> fail("should reject forged fetch metadata"));
        assertThat(response.getStatus()).isEqualTo(403);
    }

    @Test void jsonRejectsDuplicateFieldsUnknownFieldsScalarCoercionAndTrailingPayload() throws Exception {
        for (String input : new String[] {
                "{\"accessToken\":\"first\",\"accessToken\":\"second\"}",
                "{\"accessToken\":\"token\",\"role\":\"admin\"}",
                "{\"accessToken\":42}", "{\"accessToken\":null}",
                "{\"accessToken\":\"token\"} {\"role\":\"admin\"}", "[]"}) {
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter().doFilter(json("/api/auth/launchpad/session", input), response, (req,res) -> fail("controller must not receive invalid input"));
            assertThat(response.getStatus()).as(input).isEqualTo(400);
        }
    }

    @Test void jsonLimitIsAppliedBeforeParsingAndBodyRemainsReadableForMvc() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter().doFilter(json("/api/auth/launchpad/session", " ".repeat(65537)), response, (req,res) -> fail("oversize body"));
        assertThat(response.getStatus()).isEqualTo(413);
        String body = "{\"accessToken\":\"opaque_value\"}";
        MockHttpServletResponse allowed = new MockHttpServletResponse();
        filter().doFilter(json("/api/auth/launchpad/session", body), allowed,
                (req,res) -> assertThat(new String(req.getInputStream().readAllBytes(), StandardCharsets.UTF_8)).isEqualTo(body));
        assertThat(allowed.getStatus()).isEqualTo(200);
    }

    @Test void queryRejectsUnsupportedSortAndAmbiguousRepeatedFilters() throws Exception {
        MockHttpServletRequest unsupported = new MockHttpServletRequest("GET", "/api/resources");
        unsupported.addParameter("sort", "newest");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter().doFilter(unsupported, response, (req,res) -> fail("unsupported sort"));
        assertThat(response.getStatus()).isEqualTo(400);
        MockHttpServletRequest repeated = new MockHttpServletRequest("GET", "/api/resources");
        repeated.addParameter("tag", "Notes", "PA");
        response = new MockHttpServletResponse();
        filter().doFilter(repeated, response, (req,res) -> fail("ambiguous tag"));
        assertThat(response.getStatus()).isEqualTo(400);
    }

    @Test void publicShellHasNoStoreAndCspForOnlyExpectedActiveConnections() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter().doFilter(new MockHttpServletRequest("GET", "/login"), response, (req,res) -> {});
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(response.getHeader("Content-Security-Policy")).contains("frame-ancestors 'none'", "https://private-files.oss.storage.test", "script-src 'self' https://challenges.cloudflare.com");
        assertThat(response.getHeader("Strict-Transport-Security")).contains("max-age=31536000");
        assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
    }
    @Test void workspaceQueryIsAllowedOnlyOnTheThreeBoundedWorkspaceCollections() throws Exception {
        for(String path:new String[]{"/api/me/resources","/api/admin/reports","/api/admin/audit"}){
            var request=new MockHttpServletRequest("GET",path);request.addParameter("view","workspace");
            var response=new MockHttpServletResponse();AtomicBoolean called=new AtomicBoolean();
            filter().doFilter(request,response,(req,res)->called.set(true));
            assertThat(response.getStatus()).isEqualTo(200);assertThat(called).isTrue();
        }
        for(String path:new String[]{"/api/resources","/api/resources/tags","/api/resources/00000000-0000-0000-0000-000000000000"}){
            var request=new MockHttpServletRequest("GET",path);request.addParameter("view","workspace");
            var response=new MockHttpServletResponse();
            filter().doFilter(request,response,(req,res)->fail("view is not supported on this collection"));
            assertThat(response.getStatus()).isEqualTo(400);
        }
    }
}
