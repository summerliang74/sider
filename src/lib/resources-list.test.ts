import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  orderBy: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: mocks.orderBy,
          }),
        }),
      }),
    }),
  }),
}));

import { listActiveResources } from "./resources";

describe("resource listings", () => {
  beforeEach(() => {
    mocks.limit.mockReset();
    mocks.orderBy.mockReset();
    mocks.orderBy.mockReturnValue({ limit: mocks.limit });
  });

  it("normalizes timestamps returned by raw PostgreSQL expressions", async () => {
    mocks.limit.mockResolvedValue([
      {
        id: "123e4567-e89b-42d3-a456-426614174000",
        title: "AP CSP G10S1 Midterm",
        description: "",
        tags: ["AP CSP"],
        originalFilename: "AP CSP.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 276_530,
        publishedAt: "2026-10-28 13:27:46.123+00",
        authorName: "Student",
        score: 8,
      },
    ]);

    const result = await listActiveResources({ q: "AP CSP" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.publishedAt).toBeInstanceOf(Date);
    expect(result.items[0]?.publishedAt.toISOString()).toBe("2026-10-28T13:27:46.123Z");
  });

  it("does not order an empty search by the PostgreSQL positional constant zero", async () => {
    mocks.limit.mockResolvedValue([]);

    await listActiveResources({ q: "" });

    expect(mocks.orderBy).toHaveBeenCalledOnce();
    expect(mocks.orderBy.mock.calls[0]).toHaveLength(2);
  });
});
