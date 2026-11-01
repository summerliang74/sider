import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/src/lib/env", () => ({
  getServerEnv: () => ({ NODE_ENV: "production", SESSION_TTL_SECONDS: 3600 }),
}));

import { setSessionCookie } from "./session";

describe("session cookies", () => {
  it("sets one secure, host-prefixed HttpOnly cookie", () => {
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, {
      token: "opaque-token",
      tokenHash: "opaque-token-hash",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toContain("__Host-shsid_session=opaque-token");
    expect(header).not.toMatch(/(?:^|, )shsid_session=opaque-token/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=lax");
    expect(header).toContain("Max-Age=3600");
  });
});
