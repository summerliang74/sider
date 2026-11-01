import { describe, expect, it } from "vitest";

import { resolveIdentityRole } from "./role-policy";

describe("identity role policy", () => {
  it("uses the administrator subject allow-list for Launchpad identities", () => {
    expect(resolveIdentityRole({
      launchpadSub: "launchpad:administrator",
      adminSubs: ["launchpad:administrator"],
    })).toBe("admin");
    expect(resolveIdentityRole({
      launchpadSub: "launchpad:student",
      adminSubs: ["launchpad:administrator"],
    })).toBe("student");
  });
});
