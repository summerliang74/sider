package com.sider.auth;

import java.util.UUID;

public record CurrentUser(UUID id, String displayName, String email, String avatarUrl, String org, String role) {}
