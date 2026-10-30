export function resolveIdentityRole(input: {
  authMode: "launchpad" | "local";
  launchpadSub: string;
  localAuthSub: string;
  adminSubs: string[];
}): "student" | "admin" {
  const administrator = input.authMode === "local"
    ? input.launchpadSub === input.localAuthSub
    : input.adminSubs.includes(input.launchpadSub);
  return administrator ? "admin" : "student";
}
