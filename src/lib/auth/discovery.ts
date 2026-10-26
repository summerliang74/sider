import type { LaunchpadUser } from "./launchpad";

export function isOrgDiscoveryEligible(profile: LaunchpadUser, configuredEmail: string | null): boolean {
  if (!profile.verified || !profile.email || !configuredEmail) return false;
  return profile.email.trim().toLowerCase() === configuredEmail;
}
