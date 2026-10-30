import { describe, expect, it } from "vitest";

import {
  normalizeUsername,
  registrationRequestSchema,
  validateRegistrationInput,
} from "./registration-policy";

const valid = {
  username: "student.01",
  displayName: "Alex Chen",
  password: "a long unique password",
  inviteCode: "sider_invite_example",
  botToken: "challenge",
  acceptTerms: true,
};

describe("registration input policy", () => {
  it("normalizes a valid username", () => {
    expect(normalizeUsername("  Student.01 ")).toBe("student.01");
    const result = validateRegistrationInput({ ...valid, username: "  Student.01 " });
    expect(result).toMatchObject({ ok: true, value: { username: "student.01" } });
  });

  it.each(["admin", "administrator", "root", "system", "support", "security", "api", "sider"])(
    "rejects reserved username %s",
    (username) => expect(validateRegistrationInput({ ...valid, username })).toEqual({ ok: false, error: "invalid_request" }),
  );

  it("enforces password Unicode length boundaries", () => {
    expect(validateRegistrationInput({ ...valid, password: "a".repeat(15) })).toEqual({ ok: false, error: "weak_password" });
    expect(validateRegistrationInput({ ...valid, password: "😀".repeat(16) }).ok).toBe(true);
    expect(validateRegistrationInput({ ...valid, password: "a".repeat(129) })).toEqual({ ok: false, error: "weak_password" });
  });

  it("rejects display-name control characters and missing terms", () => {
    expect(validateRegistrationInput({ ...valid, displayName: "Alex\nChen" })).toEqual({ ok: false, error: "invalid_request" });
    expect(validateRegistrationInput({ ...valid, acceptTerms: false })).toEqual({ ok: false, error: "terms_required" });
  });

  it("rejects client-controlled extra fields", () => {
    expect(registrationRequestSchema.safeParse({ ...valid, role: "admin" }).success).toBe(false);
  });

  it("accepts a missing bot token for the initial low-risk request", () => {
    expect(registrationRequestSchema.safeParse({
      username: valid.username,
      displayName: valid.displayName,
      password: valid.password,
      inviteCode: valid.inviteCode,
      acceptTerms: valid.acceptTerms,
    }).success).toBe(true);
  });
});
