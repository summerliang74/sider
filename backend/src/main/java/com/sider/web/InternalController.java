package com.sider.web;

import com.sider.config.SiderConfig;
import com.sider.security.SharedRateLimiter;
import com.sider.uploads.*;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
public class InternalController {
    private final SiderConfig env;
    private final JdbcTemplate jdbc;
    private final ObjectStore store;
    private final ScanWorker worker;
    private final CleanupService cleanup;
    private final SharedRateLimiter limiter;
    public InternalController(SiderConfig env,JdbcTemplate jdbc,ObjectStore store,ScanWorker worker,CleanupService cleanup,SharedRateLimiter limiter){this.env=env;this.jdbc=jdbc;this.store=store;this.worker=worker;this.cleanup=cleanup;this.limiter=limiter;}
    @GetMapping("/api/health") public Object health(){return Map.of("status","ok");}
    @PostMapping("/api/internal/jobs/uploads") public Object uploads(HttpServletRequest request){requireCron(request);return worker.processOne();}
    @PostMapping("/api/internal/jobs/cleanup") public Object clean(HttpServletRequest request){requireCron(request);return cleanup.cleanup();}
    @GetMapping("/api/internal/ready") public ResponseEntity<?> ready(HttpServletRequest request){
        requireCron(request);boolean database=false,rateLimit=false,storage=false;
        try{database=Integer.valueOf(1).equals(jdbc.queryForObject("SELECT 1",Integer.class));}catch(Exception ignored){}
        try{store.check();storage=true;}catch(Exception ignored){}
        try{rateLimit="PONG".equals(limiter.command(List.of("PING")));}catch(Exception ignored){}
        boolean ok=database&&rateLimit&&storage;
        return ResponseEntity.status(ok?200:503).body(Map.of("status",ok?"ready":"degraded","services",Map.of("database",database,"rateLimit",rateLimit,"storage",storage)));
    }
    private void requireCron(HttpServletRequest request){
        String token=request.getHeader("Authorization");
        if(token==null||!MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),("Bearer "+env.text("CRON_SECRET")).getBytes(StandardCharsets.UTF_8)))throw new ApiException(401,"unauthorized");
    }
}
