import { describe, expect, it } from "vitest";

import { generateRegistrationInvite, registrationInviteStatus } from "./registration-invites";

describe("registration invitations", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");

  it("generates prefixed codes with at least 256 bits of random data", () => {
    const first = generateRegistrationInvite();
    const second = generateRegistrationInvite();
    expect(first).toMatch(/^sider_invite_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("derives status in precedence order", () => {
    expect(registrationInviteStatus({ revokedAt: now, consumedAt: now, expiresAt: now }, now)).toBe("revoked");
    expect(registrationInviteStatus({ revokedAt: null, consumedAt: now, expiresAt: now }, now)).toBe("consumed");
    expect(registrationInviteStatus({ revokedAt: null, consumedAt: null, expiresAt: now }, now)).toBe("expired");
    expect(registrationInviteStatus({ revokedAt: null, consumedAt: null, expiresAt: new Date(now.getTime() + 1) }, now)).toBe("active");
  });
});
