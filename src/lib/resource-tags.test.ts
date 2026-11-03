import { describe, expect, it } from "vitest";
import { canAssignTags, canonicalTag, isPaTag } from "./resource-tags";

describe("PA tag authorization", () => {
  it.each(["PA", "pa", "peer advisors", "Peer-Advisor", "ＰＡ", "peer_advisors"])("reserves alias %s for admins", (tag) => {
    expect(isPaTag(tag)).toBe(true);
    expect(canonicalTag(tag)).toBe("PA");
    expect(canAssignTags("student", ["Notes", tag])).toBe(false);
    expect(canAssignTags("admin", [tag])).toBe(true);
  });
  it("permits ordinary student tags", () => {
    expect(canAssignTags("student", ["Notes", "calculus"])).toBe(true);
    expect(isPaTag("past papers")).toBe(false);
  });
});
