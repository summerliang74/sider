import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tables = {
    auditLogs: { name: "audit_logs" },
    resourceReports: { id: "report_id", resourceId: "report_resource_id", status: "report_status" },
    resources: { id: "resource_id", status: "resource_status", deletedAt: "deleted_at" },
  };
  return {
    tables,
    authorize: vi.fn(),
    sameOrigin: vi.fn(),
    transaction: vi.fn(),
    resourceSet: vi.fn(),
    resourceWhere: vi.fn(),
    resourceReturning: vi.fn(),
    reportSet: vi.fn(),
    reportWhere: vi.fn(),
    insertValues: vi.fn(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ operator: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ operator: "eq", left, right }),
  isNull: (value: unknown) => ({ operator: "isNull", value }),
  ne: (left: unknown, right: unknown) => ({ operator: "ne", left, right }),
}));
vi.mock("@/src/db/schema", () => mocks.tables);
vi.mock("@/src/db", () => ({ getDatabase: () => ({ transaction: mocks.transaction }) }));
vi.mock("@/src/lib/security/admin", () => ({ authorizeAdminRequest: mocks.authorize }));
vi.mock("@/src/lib/security/request", () => ({ requireSameOrigin: mocks.sameOrigin }));

import { POST } from "./route";

const admin = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  displayName: "Administrator",
  email: null,
  avatarUrl: null,
  org: "shsid",
  role: "admin" as const,
};
const resourceId = "223e4567-e89b-42d3-a456-426614174000";

function request(body: unknown) {
  return new Request(`https://app.school.test/api/admin/resources/${resourceId}/moderate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/resources/:id/moderate", () => {
  beforeEach(() => {
    mocks.sameOrigin.mockReturnValue(true);
    mocks.authorize.mockResolvedValue({ user: admin });
    mocks.resourceReturning.mockResolvedValue([{ id: resourceId }]);
    mocks.resourceWhere.mockReturnValue({ returning: mocks.resourceReturning });
    mocks.resourceSet.mockReturnValue({ where: mocks.resourceWhere });
    mocks.reportWhere.mockResolvedValue([]);
    mocks.reportSet.mockReturnValue({ where: mocks.reportWhere });
    mocks.insertValues.mockResolvedValue(undefined);

    const tx = {
      update: vi.fn((table: unknown) => table === mocks.tables.resources
        ? { set: mocks.resourceSet }
        : { set: mocks.reportSet }),
      insert: vi.fn(() => ({ values: mocks.insertValues })),
    };
    mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
  });

  it("rejects a caller who is not authorized as an administrator", async () => {
    mocks.authorize.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });

    const response = await POST(request({ action: "remove", reason: "Policy violation" }), { params: Promise.resolve({ id: resourceId }) });

    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("removes the resource, resolves its reports, and records a sanitized reason", async () => {
    const response = await POST(request({ action: "remove", reason: "Contains private data at https://example.test/secret" }), { params: Promise.resolve({ id: resourceId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "deleted" });
    expect(mocks.resourceSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "deleted",
      moderationReason: "Contains private data at [redacted-url]",
      deletedAt: expect.any(Date),
    }));
    expect(mocks.reportSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved",
      handledBy: admin.id,
      resolutionNote: "Contains private data at [redacted-url]",
    }));
    expect(mocks.insertValues).toHaveBeenCalledWith({
      actorId: admin.id,
      action: "resource.remove",
      targetType: "resource",
      targetId: resourceId,
      metadata: { reason: "Contains private data at [redacted-url]", reportId: null },
    });
  });

  it("does not reset the retention window for an already deleted resource", async () => {
    mocks.resourceReturning.mockResolvedValue([]);

    const response = await POST(request({ action: "remove", reason: "Duplicate request" }), { params: Promise.resolve({ id: resourceId }) });

    expect(response.status).toBe(404);
    expect(mocks.reportSet).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
