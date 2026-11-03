import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), update: vi.fn() }));
vi.mock("@/src/lib/security/user", () => ({ authorizeUserRequest: mocks.authorize }));
vi.mock("@/src/lib/security/request", () => ({ requireSameOrigin: () => true }));
vi.mock("@/src/lib/resources", () => ({ getResourceForViewer: vi.fn() }));
vi.mock("@/src/lib/resources-write", () => ({ updateResourceMetadata: mocks.update, softDeleteResource: vi.fn() }));
import { PATCH } from "./route";

const id = "123e4567-e89b-42d3-a456-426614174000";
function request(tags: string[]) {
  return new Request("https://sider.test/api/resources/" + id, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Guide", description: "", tags }),
  });
}
describe("PA metadata permissions", () => {
  beforeEach(() => {
    mocks.authorize.mockResolvedValue({ user: { id, role: "student" } });
    mocks.update.mockResolvedValue({ id });
  });
  it.each(["PA", "peer advisors", "ＰＡ"])("blocks student editing to reserved tag %s", async (tag) => {
    const response = await PATCH(request([tag]), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("allows ordinary student tags", async () => {
    expect((await PATCH(request(["Notes"]), { params: Promise.resolve({ id }) })).status).toBe(200);
  });
  it("allows admins to assign PA", async () => {
    mocks.authorize.mockResolvedValue({ user: { id, role: "admin" } });
    expect((await PATCH(request(["PA"]), { params: Promise.resolve({ id }) })).status).toBe(200);
  });
});
