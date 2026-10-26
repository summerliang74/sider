import { describe, expect, it } from "vitest";

import { sanitizeAuditText } from "./audit";

describe("audit metadata safety", () => {
  it("redacts URLs and token-like values", () => {
    const result = sanitizeAuditText(`reason https://storage.example/file?sig=secret ${"a".repeat(48)}`);
    expect(result).toBe("reason [redacted-url] [redacted-token]");
    expect(result).not.toContain("secret");
  });
});
