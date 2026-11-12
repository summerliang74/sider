package com.sider.security;

import com.sider.web.ApiException;

public class RateLimitException extends ApiException {
    private final int retryAfter;
    public RateLimitException(int retryAfter) {
        super(429, "rate_limited");
        this.retryAfter = retryAfter;
    }
    public int retryAfter() { return retryAfter; }
}
