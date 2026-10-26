import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/src/lib/env";

const scanResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("clean"),
    detectedMimeType: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  }),
  z.object({
    status: z.literal("infected"),
    detectedMimeType: z.string().optional(),
    signature: z.string().max(300).optional(),
  }),
  z.object({ status: z.literal("error"), message: z.string().max(300).optional() }),
]);

export type ScanResult = z.infer<typeof scanResponseSchema>;

export async function scanObject(input: { resourceId: string; objectKey: string }): Promise<ScanResult> {
  const env = getServerEnv();
  const response = await fetch(env.MALWARE_SCAN_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.MALWARE_SCAN_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    cache: "no-store",
    signal: AbortSignal.timeout(env.MALWARE_SCAN_TIMEOUT_MS),
  });
  if (!response.ok) return { status: "error", message: `scanner_http_${response.status}` };
  const parsed = scanResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : { status: "error", message: "invalid_scanner_response" };
}
