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

describe("fetchLaunchpadUser", () => {
  beforeEach(() => {
    mocks.env.mockReturnValue({ APP_BASE_URL: "https://app.example.test" });
    mocks.fetch.mockResolvedValue(Response.json(profile));
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("validates an SDK access token through the same-origin Launchpad bridge", async () => {
    await expect(fetchLaunchpadUser("access-token")).resolves.toEqual(profile);
    expect(mocks.fetch).toHaveBeenCalledWith(
      new URL("https://app.example.test/dashboard-api/oauth/userinfo"),
      expect.objectContaining({
        headers: { authorization: "Bearer access-token" },
        cache: "no-store",
      }),
    );
  });

  it("distinguishes invalid tokens from platform outages", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(fetchLaunchpadUser("expired")).rejects.toMatchObject({ reason: "invalid" });

    mocks.fetch.mockRejectedValueOnce(new Error("offline"));
    await expect(fetchLaunchpadUser("token")).rejects.toMatchObject({ reason: "unavailable" });
  });
});
