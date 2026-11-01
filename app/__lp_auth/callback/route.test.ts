import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => vi.fn());
vi.mock("@/src/lib/env", () => ({ getServerEnv: env }));

import { GET } from "./route";

describe("GET /__lp_auth/callback", () => {
  beforeEach(() => {
    env.mockReturnValue({ APP_BASE_URL: "https://app.school.test" });
  });

  it("forwards only the OAuth callback values to the SDK login page", () => {
    const response = GET(new Request(
      "https://app.school.test/__lp_auth/callback?code=code-1&state=state-1&next=https://evil.test",
    ));
    const location = new URL(response.headers.get("location") ?? "");
    expect(response.status).toBe(307);
    expect(location.origin).toBe("https://app.school.test");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("code")).toBe("code-1");
    expect(location.searchParams.get("state")).toBe("state-1");
    expect(location.searchParams.has("next")).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
