import { describe, expect, it } from "vitest";
import { loginUrl, safeReturnTo } from "./return-to";

describe("login return path", () => {
  it("preserves a detail path and search filters through a login URL", () => {
    const location = new URL(loginUrl("/resources/abc", { source: "search", q: "a & b" }), "https://sider.invalid");
    expect(location.pathname).toBe("/login");
    expect(safeReturnTo(location.searchParams.get("returnTo"))).toBe("/resources/abc?source=search&q=a+%26+b");
  });

  it.each(["//evil.test", "https://evil.test", "/\\evil.test", "/resources/../../dashboard-api/oauth", "/login", "/api/me", "/resources\r\nLocation: evil"])("rejects unsafe or unrelated destination %s", (value) => {
    expect(safeReturnTo(value)).toBe("/resources");
  });

  it("keeps the default login location and supports admin and uploads", () => {
    expect(loginUrl("/resources")).toBe("/login");
    expect(safeReturnTo("/admin/reports")).toBe("/admin/reports");
    expect(safeReturnTo("/me/resources?status=scanning")).toBe("/me/resources?status=scanning");
  });
});
