import type { LaunchpadUser } from "./launchpad";

export class AdmissionError extends Error {
  constructor(public readonly code: "not_verified" | "org_not_allowed" | "capability_missing" | "suspended") {
    super(code);
  }
}

export function assertLaunchpadAdmission(
  profile: LaunchpadUser,
  policy: { allowedOrgs: string[]; adminSubs?: string[]; requiredCapability: string | null },
): void {
  if (!profile.verified) throw new AdmissionError("not_verified");
  const explicitlyAllowedAdmin = policy.adminSubs?.includes(profile.sub) ?? false;
  if (!explicitlyAllowedAdmin && !policy.allowedOrgs.includes(profile.org)) {
    throw new AdmissionError("org_not_allowed");
  }
  if (policy.requiredCapability && !profile.allows[policy.requiredCapability]) {
    throw new AdmissionError("capability_missing");
  }
}
