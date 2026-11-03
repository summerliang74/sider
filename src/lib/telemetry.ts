import "server-only";

type MetricValue = string | number | boolean | null;

export function startPageTiming(page: "resources" | "uploads") {
  const started = performance.now();
  return (fields: Record<string, MetricValue>) => recordMetric("page.timing", { ...fields, page, dataMs: Math.round(performance.now() - started) });
}

export async function timeOperation<T>(operation: () => PromiseLike<T>): Promise<{ value: T; durationMs: number }> {
  const started = performance.now();
  const value = await operation();
  return { value, durationMs: Math.round(performance.now() - started) };
}

export function recordMetric(name: string, fields: Record<string, MetricValue> = {}): void {
  // Never pass tokens, cookies, URLs, raw IPs, filenames, email addresses, or free-form user text.
  console.info(JSON.stringify({ type: "metric", name, at: new Date().toISOString(), ...fields }));
}
