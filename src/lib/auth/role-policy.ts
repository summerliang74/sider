export function resolveIdentityRole(input: {
  launchpadSub: string;
  adminSubs: string[];
}): "student" | "admin" {
  return input.adminSubs.includes(input.launchpadSub) ? "admin" : "student";
}
