import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  values: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  returning: vi.fn(),
}));

vi.mock("@/src/db", () => ({
  getDatabase: () => ({ insert: () => ({ values: mocks.values }) }),
}));
vi.mock("@/src/lib/env", () => ({
  getServerEnv: () => ({ adminSubs: ["launchpad-admin"] }),
}));

import { AdmissionError, admitAndUpsertUser } from "./users";

const profile = {
  sub: "launchpad-student",
  email: "student@school.test",
  name: "Student",
  picture: null,
  org: "any-launchpad-org",
  verified: false,
  allows: {},
};

describe("Launchpad user admission", () => {
  beforeEach(() => {
    mocks.values.mockReset();
    mocks.onConflictDoUpdate.mockReset();
    mocks.returning.mockReset();
    mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.onConflictDoUpdate });
    mocks.onConflictDoUpdate.mockReturnValue({ returning: mocks.returning });
    mocks.returning.mockResolvedValue([{ id: "user-id", status: "active" }]);
  });

  it("accepts any valid Launchpad identity and records its attributes", async () => {
    await expect(admitAndUpsertUser(profile)).resolves.toBe("user-id");
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      launchpadSub: profile.sub,
      org: profile.org,
      verified: false,
      role: "student",
    }));
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      set: expect.objectContaining({ org: profile.org, verified: false, role: "student" }),
    }));
  });

  it("still rejects a locally suspended user", async () => {
    mocks.returning.mockResolvedValue([{ id: "user-id", status: "suspended" }]);
    await expect(admitAndUpsertUser(profile)).rejects.toBeInstanceOf(AdmissionError);
  });
});
