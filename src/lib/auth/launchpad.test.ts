import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/src/lib/env", () => ({ getServerEnv: mocks.env }));

import { fetchLaunchpadUser } from "./launchpad";

const profile = {
  sub: "user-1",
  email: "student@example.edu",
  name: "Student",
  picture: null,
  org: "school",
  verified: true,
  allows: {},
};

const bootstrap = {
  client_id: "app_test",
  issuer: "https://launchpad.example.test",
  authorization_endpoint: "https://launchpad.example.test/oauth/authorize",
  token_endpoint: "https://launchpad.example.test/oauth/token",
  userinfo_endpoint: "https://launchpad.example.test/oauth/userinfo",
  redirect_uri: "https://app.example.test/__lp_auth/callback",
  callback_path: "/__lp_auth/callback",
  scopes: ["openid", "profile", "email", "allows"],
};

describe("fetchLaunchpadUser", () => {
  beforeEach(() => {
    mocks.env.mockReturnValue({
      APP_BASE_URL: "https://app.example.test",
      NODE_ENV: "production",
      launchpadOidcDev: "0",
    });
    mocks.fetch
      .mockResolvedValueOnce(Response.json(bootstrap))
      .mockResolvedValueOnce(Response.json(profile));
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("validates an SDK access token against the registered issuer endpoint", async () => {
    await expect(fetchLaunchpadUser("access-token")).resolves.toEqual(profile);
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      "https://launchpad.example.test/oauth/userinfo",
      expect.objectContaining({
        headers: { authorization: "Bearer access-token" },
        cache: "no-store",
      }),
    );
  });

  it("distinguishes invalid tokens from platform outages", async () => {
    mocks.fetch.mockReset();
    mocks.fetch
      .mockResolvedValueOnce(Response.json(bootstrap))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(fetchLaunchpadUser("expired")).rejects.toMatchObject({ reason: "invalid" });

    mocks.fetch
      .mockResolvedValueOnce(Response.json(bootstrap))
      .mockRejectedValueOnce(new Error("offline"));
    await expect(fetchLaunchpadUser("token")).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("scopes a personal workspace to the immutable subject", async () => {
    mocks.fetch.mockReset();
    mocks.fetch
      .mockResolvedValueOnce(Response.json(bootstrap))
      .mockResolvedValueOnce(Response.json({ ...profile, email: "", picture: "", org: null }));

    await expect(fetchLaunchpadUser("access-token")).resolves.toEqual({
      ...profile,
      email: null,
      picture: null,
      org: "personal:user-1",
    });
  });

  it("rejects malformed userinfo responses", async () => {
    mocks.fetch.mockReset();
    mocks.fetch
      .mockResolvedValueOnce(Response.json(bootstrap))
      .mockResolvedValueOnce(Response.json({ ...profile, sub: "" }));

    await expect(fetchLaunchpadUser("access-token")).rejects.toMatchObject({ reason: "invalid_profile" });
  });
});
