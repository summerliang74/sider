import { describe, expect, it } from "vitest";
import { z } from "zod";

import { openJson, pkceChallenge, safeEqual, sealJson } from "./crypto";

describe("auth crypto", () => {
  it("creates the RFC 7636 S256 challenge", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("round-trips and authenticates encrypted JSON", () => {
    const schema = z.object({ state: z.string() });
    const secret = "a".repeat(32);
    const sealed = sealJson({ state: "value" }, secret);
    expect(openJson(sealed, secret, schema)).toEqual({ state: "value" });
    expect(openJson(`${sealed}broken`, secret, schema)).toBeNull();
  });

  it("compares equal strings safely", () => {
    expect(safeEqual("same", "same")).toBe(true);
    expect(safeEqual("same", "different")).toBe(false);
  });
});
