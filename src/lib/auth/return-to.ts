const base = "https://sider.invalid";

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 500 || /[\\\r\n]/.test(value)) return "/resources";
  try {
    const url = new URL(value, base);
    if (!value.startsWith("/") || url.origin !== base || !/^\/(?:resources|me\/resources|admin\/(?:reports|audit))(?:\/|$)/.test(url.pathname)) return "/resources";
    return url.pathname + url.search;
  } catch {
    return "/resources";
  }
}

export function loginUrl(path: string, params: Record<string, string | string[] | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, entry);
  }
  const target = safeReturnTo(path + (query.size ? `?${query}` : ""));
  return target === "/resources" ? "/login" : `/login?${new URLSearchParams({ returnTo: target })}`;
}
