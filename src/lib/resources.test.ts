import { describe, expect, it } from "vitest";

import { decodeResourceCursor, encodeResourceCursor } from "./resource-cursor";

describe("resource cursors", () => {
  it("round-trips a stable pagination cursor", () => {
    const cursor = {
      score: 8,
      publishedAt: "2026-10-26T12:00:00.000Z",
      id: "123e4567-e89b-42d3-a456-426614174000",
    };
    expect(decodeResourceCursor(encodeResourceCursor(cursor))).toEqual(cursor);
  });

  it("rejects malformed cursors", () => {
    expect(decodeResourceCursor("not-a-cursor")).toBeNull();
  });
});
