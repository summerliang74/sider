import { describe, expect, it } from "vitest";

import type { LaunchpadUser } from "./launchpad";
import { isOrgDiscoveryEligible } from "./discovery";

const profile: LaunchpadUser = {
  sub: "launchpad-subject",
  email: "student@school.test",
  name: "Student",
  picture: null,
  org: "unknown-school-org",
  verified: true,
  allows: {},
};

describe("Launchpad organization discovery", () => {
  it("allows only the configured verified email", () => {
    expect(isOrgDiscoveryEligible(profile, "student@school.test")).toBe(true);
    expect(isOrgDiscoveryEligible({ ...profile, email: "STUDENT@SCHOOL.TEST" }, "student@school.test")).toBe(true);
  });

  it("stays closed for another, missing, or unverified identity", () => {
    expect(isOrgDiscoveryEligible(profile, null)).toBe(false);
    expect(isOrgDiscoveryEligible({ ...profile, email: "other@school.test" }, "student@school.test")).toBe(false);
    expect(isOrgDiscoveryEligible({ ...profile, verified: false }, "student@school.test")).toBe(false);
    expect(isOrgDiscoveryEligible({ ...profile, email: null }, "student@school.test")).toBe(false);
  });
});
