import { describe, expect, it } from "vitest";

import { AdmissionError, assertLaunchpadAdmission } from "./admission";
import type { LaunchpadUser } from "./launchpad";

const eligible: LaunchpadUser = {
  sub: "launchpad-user",
  email: "student@school.test",
  name: "Student",
  picture: null,
  org: "shsid",
  verified: true,
  allows: { resources: true },
};

describe("Launchpad admission", () => {
  it("accepts a verified allow-listed user with the required capability", () => {
    expect(() => assertLaunchpadAdmission(eligible, { allowedOrgs: ["shsid"], requiredCapability: "resources" })).not.toThrow();
  });

  it.each([
    [{ ...eligible, verified: false }, "not_verified"],
    [{ ...eligible, org: "other" }, "org_not_allowed"],
    [{ ...eligible, allows: {} }, "capability_missing"],
  ] as const)("rejects ineligible identity", (profile, code) => {
    try {
      assertLaunchpadAdmission(profile, { allowedOrgs: ["shsid"], requiredCapability: "resources" });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AdmissionError);
      expect((error as AdmissionError).code).toBe(code);
    }
  });
});
