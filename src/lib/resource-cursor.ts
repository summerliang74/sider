import { z } from "zod";

export const resourceCursorSchema = z.object({
  score: z.number(),
  publishedAt: z.iso.datetime(),
  id: z.uuid(),
});

export type ResourceCursor = z.infer<typeof resourceCursorSchema>;

export function encodeResourceCursor(value: ResourceCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeResourceCursor(value: string | undefined): ResourceCursor | null {
  if (!value) return null;
  try {
    return resourceCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown,
    );
  } catch {
    return null;
  }
}
