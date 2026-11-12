package com.sider.web;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(com.sider.security.RateLimitException.class) public ResponseEntity<?> limited(com.sider.security.RateLimitException e) {
        return ResponseEntity.status(429).header("Cache-Control", "no-store").header("Retry-After",String.valueOf(e.retryAfter()))
            .body(Map.of("error",e.code(),"retryAfter",e.retryAfter()));
    }
    @ExceptionHandler(ApiException.class) public ResponseEntity<?> api(ApiException e) { return error(e.status(), e.code()); }
    @ExceptionHandler(HttpMessageNotReadableException.class) public ResponseEntity<?> invalid() { return error(400, "invalid_request"); }
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class) public ResponseEntity<?> media() { return error(415, "unsupported_media_type"); }
    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class) public ResponseEntity<?> missing() { return error(404,"not_found"); }
    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class) public ResponseEntity<?> method() { return error(405,"method_not_allowed"); }
    @ExceptionHandler(Exception.class) public ResponseEntity<?> unavailable(Exception e) {
        org.slf4j.LoggerFactory.getLogger(ApiErrors.class).warn("request_failed type={}", e.getClass().getSimpleName());
        return error(503, "service_unavailable");
    }
    private ResponseEntity<?> error(int status, String code) { return ResponseEntity.status(status).header("Cache-Control", "no-store").body(Map.of("error", code)); }
}
