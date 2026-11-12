package com.sider.web;

public class ApiException extends RuntimeException {
    private final int status;
    private final String code;
    public ApiException(int status, String code) { super(code); this.status = status; this.code = code; }
    public int status() { return status; }
    public String code() { return code; }
    public int getStatus() { return status; }
    public String getCode() { return code; }
}
