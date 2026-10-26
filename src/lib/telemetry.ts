import "server-only";

type MetricValue = string | number | boolean | null;

export function recordMetric(name: string, fields: Record<string, MetricValue> = {}): void {
  // Never pass tokens, cookies, URLs, raw IPs, filenames, email addresses, or free-form user text.
  console.info(JSON.stringify({ type: "metric", name, at: new Date().toISOString(), ...fields }));
}
