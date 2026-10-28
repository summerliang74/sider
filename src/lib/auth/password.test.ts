import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("local password hashing", () => {
  it("accepts the original password and rejects a different one", async () => {
    const encoded = await hashPassword("a-long-test-password");
    await expect(verifyPassword("a-long-test-password", encoded)).resolves.toBe(true);
    await expect(verifyPassword("a-different-password", encoded)).resolves.toBe(false);
  });

  it("rejects malformed or unsupported hashes", async () => {
    await expect(verifyPassword("password", "not-a-password-hash")).resolves.toBe(false);
    await expect(verifyPassword("password", "scrypt$2$8$1$c2FsdA$aGFzaA")).resolves.toBe(false);
  });
});
