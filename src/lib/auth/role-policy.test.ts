import { describe, expect, it } from "vitest";

import { resolveIdentityRole } from "./role-policy";

describe("identity role policy", () => {
  it("limits local administrator access to the configured bootstrap account", () => {
    expect(resolveIdentityRole({
      authMode: "local",
      launchpadSub: "local:admin",
      localAuthSub: "local:admin",
      adminSubs: [],
    })).toBe("admin");
    expect(resolveIdentityRole({
      authMode: "local",
      launchpadSub: "local:student01",
      localAuthSub: "local:admin",
      adminSubs: ["local:student01"],
    })).toBe("student");
  });

  it("uses the administrator subject allow-list for Launchpad identities", () => {
    expect(resolveIdentityRole({
      authMode: "launchpad",
      launchpadSub: "launchpad:administrator",
      localAuthSub: "local:admin",
      adminSubs: ["launchpad:administrator"],
    })).toBe("admin");
  });
});
