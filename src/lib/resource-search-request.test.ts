import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ipLimit: vi.fn(),
  userLimit: vi.fn(),
  bot: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/src/lib/security/rate-limit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/security/rate-limit")>(),
  enforceIpRateLimit: mocks.ipLimit,
  enforceUserRateLimit: mocks.userLimit,
}));
vi.mock("@/src/lib/security/request", () => ({ getClientIp: () => "192.0.2.1" }));
vi.mock("@/src/lib/security/bot", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/security/bot")>(),
  verifyBotChallenge: mocks.bot,
}));
vi.mock("@/src/lib/resources", () => ({ listActiveResources: mocks.list }));
vi.mock("@/src/lib/telemetry", () => ({ recordMetric: vi.fn() }));

import type { CurrentUser } from "@/src/lib/auth/session";
import { BotChallengeError } from "@/src/lib/security/bot";
import { RateLimitError } from "@/src/lib/security/rate-limit";
import { authorizeResourceSearch, getInitialResourceSearch } from "./resource-search-request";

const user: CurrentUser = { id: "student-id", displayName: "Student", email: null, avatarUrl: null, org: "shsid", role: "student" };
const request = { headers: new Headers() };

describe("server-rendered resource search", () => {
  beforeEach(() => {
    mocks.ipLimit.mockResolvedValue({ risky: false });
    mocks.userLimit.mockResolvedValue({ risky: false });
    mocks.bot.mockResolvedValue(undefined);
    mocks.list.mockResolvedValue({ items: [], nextCursor: null });
  });

  it.each([{ q: "guide", tag: "PA" }, { q: "", fileType: "pdf" as const }])(
    "loads filtered results on the server after both rate limits and bot checks: %j",
    async (input) => {
      const result = await getInitialResourceSearch(input, user, request);
      expect(result).toEqual({ items: [], nextCursor: null });
      expect(mocks.ipLimit).toHaveBeenCalledWith("search", "192.0.2.1");
      expect(mocks.userLimit).toHaveBeenCalledWith("search", user.id);
      expect(mocks.bot).toHaveBeenCalledWith({ required: false, token: undefined, action: "search", ip: "192.0.2.1" });
      expect(mocks.list).toHaveBeenCalledExactlyOnceWith(input);
      expect(mocks.bot.mock.invocationCallOrder[0]).toBeLessThan(mocks.list.mock.invocationCallOrder[0]!);
    },
  );

  it("returns the challenge state without reading resources when traffic is risky", async () => {
    mocks.userLimit.mockResolvedValue({ risky: true });
    mocks.bot.mockRejectedValue(new BotChallengeError("required"));
    expect(await getInitialResourceSearch({ q: "guide" }, user, request)).toEqual({
      items: [], nextCursor: null, error: "bot_challenge_required",
    });
    expect(mocks.bot).toHaveBeenCalledWith(expect.objectContaining({ required: true }));
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("stops at the IP gate when rate-limited", async () => {
    mocks.ipLimit.mockRejectedValue(new RateLimitError(60));
    expect(await getInitialResourceSearch({ q: "guide" }, user, request)).toEqual({
      items: [], nextCursor: null, error: "rate_limited",
    });
    expect(mocks.userLimit).not.toHaveBeenCalled();
    expect(mocks.bot).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("fails closed when the rate-limit service is unavailable", async () => {
    mocks.ipLimit.mockRejectedValue(new Error("rate_limit_store_503"));
    expect(await getInitialResourceSearch({ q: "guide" }, user, request)).toMatchObject({
      items: [], error: "search_unavailable",
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("renders a retryable failure when the query fails", async () => {
    mocks.list.mockRejectedValue(new Error("database_unavailable"));
    expect(await getInitialResourceSearch({ q: "guide" }, user, request)).toMatchObject({
      items: [], error: "search_unavailable",
    });
    expect(mocks.list).toHaveBeenCalledOnce();
  });

  it("keeps the existing direct initial listing for an unfiltered library", async () => {
    await getInitialResourceSearch({ q: "", tag: "PA" }, user, request);
    expect(mocks.list).toHaveBeenCalledWith({ q: "", tag: "PA" });
    expect(mocks.ipLimit).not.toHaveBeenCalled();
  });

  it("passes a submitted challenge token to the shared verifier", async () => {
    mocks.ipLimit.mockResolvedValue({ risky: true });
    const resolveUser = vi.fn().mockResolvedValue(user);
    expect(await authorizeResourceSearch({ headers: new Headers({ "x-bot-token": "challenge-token" }) }, resolveUser)).toEqual(user);
    expect(mocks.bot).toHaveBeenCalledWith(expect.objectContaining({ required: true, token: "challenge-token" }));
    expect(resolveUser).toHaveBeenCalledOnce();
  });
});
