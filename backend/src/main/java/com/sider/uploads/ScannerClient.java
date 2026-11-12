package com.sider.uploads;

import com.sider.config.SiderConfig;
import com.sider.security.RemoteJson;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class ScannerClient {
    public record Result(String status, String mime, String sha256) {}
    private final SiderConfig env;
    private final ObjectMapper json;
    private final RemoteJson remote;
    public ScannerClient(SiderConfig env, ObjectMapper json, RemoteJson remote) { this.env=env; this.json=json; this.remote=remote; }
    public Result scan(UUID id, String snapshot) {
        if (!env.scannerEnabled()) return new Result("error",null,null);
        try {
            var req=HttpRequest.newBuilder(URI.create(env.text("MALWARE_SCAN_URL"))).timeout(Duration.ofMillis(env.number("MALWARE_SCAN_TIMEOUT_MS",30000)))
                .header("Authorization","Bearer "+env.text("MALWARE_SCAN_TOKEN")).header("Content-Type","application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("resourceId",id,"objectKey",snapshot)))).build();
            var response=remote.call(req,(env.number("MALWARE_SCAN_TIMEOUT_MS",30000)+999)/1000,"scanner_unavailable");
                if (response.status()!=200) return new Result("error",null,null);
                var root=response.body();
                String status=root.get("status") instanceof String v?v:"";
                if (status.equals("infected")) return new Result("infected",null,null);
                String mime=root.get("detectedMimeType") instanceof String v?v:"";
                String hash=root.get("sha256") instanceof String v?v:"";
                if (status.equals("clean") && !mime.isBlank() && hash.matches("(?i)[a-f0-9]{64}")) return new Result("clean",mime,hash.toLowerCase(Locale.ROOT));
        } catch (Exception e) { /* No response/token/URL is logged. A dependency error is retryable. */ }
        return new Result("error",null,null);
    }
}
