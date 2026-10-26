export function sanitizeAuditText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40,})\b/g, "[redacted-token]")
    .slice(0, 1000);
}
