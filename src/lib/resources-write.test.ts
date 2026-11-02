import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tables = {
    auditLogs: { name: "audit_logs" },
    resources: { id: "resource_id", authorId: "author_id", status: "resource_status" },
  };
  return {
    tables,
    transaction: vi.fn(),
    updateSet: vi.fn(),
    updateWhere: vi.fn(),
    updateReturning: vi.fn(),
    insertValues: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ operator: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ operator: "eq", left, right }),
  gt: vi.fn(),
  inArray: (left: unknown, right: unknown) => ({ operator: "inArray", left, right }),
  isNull: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("@/src/db/schema", () => mocks.tables);
vi.mock("@/src/db", () => ({ getDatabase: () => ({ transaction: mocks.transaction }) }));
vi.mock("@/src/lib/files", () => ({
  normalizeTags: (tags: string[]) => tags.map((tag) => tag.trim().toLowerCase()),
  sanitizeFilename: vi.fn(),
  uploadedObjectMatches: vi.fn(),
  validateDeclaredFile: vi.fn(),
  validateDetectedFile: vi.fn(),
}));
vi.mock("@/src/lib/scanner", () => ({ scanObject: vi.fn() }));
vi.mock("@/src/lib/storage", () => ({
  deleteObject: vi.fn(),
  headObject: vi.fn(),
  moveObject: vi.fn(),
  uploadObject: vi.fn(),
}));
vi.mock("@/src/lib/telemetry", () => ({ recordMetric: vi.fn() }));

import { updateResourceMetadata } from "./resources-write";

const user = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  displayName: "Student",
  email: null,
  avatarUrl: null,
  org: "shsid",
  role: "student" as const,
};
const resourceId = "223e4567-e89b-42d3-a456-426614174000";

describe("resource metadata audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateReturning.mockResolvedValue([{ id: resourceId, status: "active" }]);
    mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.insertValues.mockResolvedValue(undefined);
    const tx = {
      update: vi.fn(() => ({ set: mocks.updateSet })),
      insert: vi.fn(() => ({ values: mocks.insertValues })),
    };
    mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
  });

  it("writes a privacy-safe audit event in the metadata update transaction", async () => {
    const result = await updateResourceMetadata(resourceId, user, {
      title: "Updated title",
      description: "Updated description",
      tags: [" Mathematics "],
    });

    expect(result).toEqual({ id: resourceId, status: "active" });
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      title: "Updated title",
      description: "Updated description",
      tags: ["mathematics"],
      updatedAt: expect.any(Date),
    }));
    expect(mocks.insertValues).toHaveBeenCalledWith({
      actorId: user.id,
      action: "resource.metadata_update",
      targetType: "resource",
      targetId: resourceId,
      metadata: { actorRole: "student", changedFields: "title,description,tags" },
    });
  });

  it("does not write an audit event when no resource was updated", async () => {
    mocks.updateReturning.mockResolvedValue([]);

    await expect(updateResourceMetadata(resourceId, user, {
      title: "Missing",
      description: "",
      tags: [],
    })).resolves.toBeNull();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
