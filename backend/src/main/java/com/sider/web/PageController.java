package com.sider.web;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.util.UriComponentsBuilder;

@Controller
public class PageController {
    @GetMapping({"/", "/login", "/resources", "/resources/new", "/resources/{id}",
            "/me/resources", "/admin/dashboard", "/admin/reports", "/admin/audit", "/privacy", "/terms", "/auth/error"})
    public String page() {
        return "forward:/index.html";
    }

    // The official browser SDK owns PKCE and the code exchange. This adapter
    // only forwards its bounded callback fields to the SDK's login page.
    @GetMapping("/__lp_auth/callback")
    public ResponseEntity<Void> callback(HttpServletRequest request) {
        var target = UriComponentsBuilder.fromPath("/login");
        for (String name : new String[]{"code", "state", "error", "error_description"}) {
            String value = request.getParameter(name);
            if (value != null && !value.isEmpty() && value.length() <= 4096) target.queryParam(name, value);
        }
        return ResponseEntity.status(302).cacheControl(CacheControl.noStore())
                .location(target.build().encode().toUri()).build();
    }
}
