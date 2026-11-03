export const suggestedTags = ["Notes", "Revision", "Worksheets", "Guides", "PA"] as const;

export function isPaTag(tag: string): boolean {
  const key = tag.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ["pa", "peeradvisor", "peeradvisors"].includes(key);
}

export function canonicalTag(tag: string): string {
  return isPaTag(tag) ? "PA" : tag.trim();
}

export function canAssignTags(role: string, tags: string[]): boolean {
  return role === "admin" || !tags.some(isPaTag);
}
