import { describe, expect, it } from "vitest";

import { isValidBotVerification } from "./bot-policy";

const now = Date.parse("2026-10-27T00:00:00.000Z");

describe("bot verification policy", () => {
  it("accepts only fresh, action-bound, host-bound successes", () => {
    expect(isValidBotVerification({ success: true, hostname: "app.school.test", action: "upload", challenge_ts: "2026-10-26T23:59:00.000Z" }, { hostname: "app.school.test", action: "upload", now })).toBe(true);
  });

  it.each([
    { success: false, hostname: "app.school.test", action: "upload", challenge_ts: "2026-10-26T23:59:00.000Z" },
    { success: true, hostname: "evil.test", action: "upload", challenge_ts: "2026-10-26T23:59:00.000Z" },
    { success: true, hostname: "app.school.test", action: "report", challenge_ts: "2026-10-26T23:59:00.000Z" },
    { success: true, hostname: "app.school.test", action: "upload", challenge_ts: "2026-10-26T23:40:00.000Z" },
  ])("rejects invalid verification", (verification) => {
    expect(isValidBotVerification(verification, { hostname: "app.school.test", action: "upload", now })).toBe(false);
  });
});
