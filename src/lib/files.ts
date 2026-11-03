import { z } from "zod";
import { canonicalTag } from "./resource-tags";

export const allowedFileTypes = {
  ".pdf": ["application/pdf"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".txt": ["text/plain"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
} as const;

export const allowedMimeTypes = new Set<string>(Object.values(allowedFileTypes).flat());

export const uploadIntentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  originalFilename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().trim().min(1).max(150),
  botToken: z.string().max(4096).optional(),
});

export const resourceMetadataSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  tags: z.array(z.string().trim().min(1).max(30)).max(10),
});

export function sanitizeFilename(filename: string): string {
  return filename
    .normalize("NFKC")
    .replace(/^.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._()\- ]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255) || "file";
}

export function normalizeTags(tags: string[]): string[] {
  const normalized = tags.map(canonicalTag).filter(Boolean);
  const unique = new Map<string, string>();
  for (const tag of normalized) {
    const key = tag.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, tag);
  }
  return [...unique.values()].slice(0, 10);
}

export function validateDeclaredFile(filename: string, mimeType: string): boolean {
  const dot = filename.lastIndexOf(".");
  const extension = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  const allowed = allowedFileTypes[extension as keyof typeof allowedFileTypes];
  return Boolean(allowed?.includes(mimeType as never));
}

export function validateDetectedFile(filename: string, detectedMimeType: string): boolean {
  return allowedMimeTypes.has(detectedMimeType) && validateDeclaredFile(filename, detectedMimeType);
}

export function uploadedObjectMatches(
  expected: { id: string; sizeBytes: number; mimeType: string },
  actual: { contentLength?: number; contentType?: string; resourceId?: string },
): boolean {
  return actual.contentLength === expected.sizeBytes && actual.contentType === expected.mimeType && actual.resourceId === expected.id;
}
