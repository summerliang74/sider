import "server-only";

import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDatabase } from "@/src/db";
import { resources, users } from "@/src/db/schema";
import { decodeResourceCursor, encodeResourceCursor } from "@/src/lib/resource-cursor";
import type { CurrentUser } from "@/src/lib/auth/session";

const PAGE_SIZE = 20;

export const resourceSearchSchema = z.object({
  q: z.string().trim().max(120).default(""),
  cursor: z.string().max(1000).optional(),
});

export type ResourceListItem = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  publishedAt: Date;
  authorName: string;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizeDatabaseDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid_resource_timestamp");
  }
  return date;
}

export async function listActiveResources(input: {
  q: string;
  cursor?: string;
}): Promise<{ items: ResourceListItem[]; nextCursor: string | null }> {
  const q = input.q.trim().slice(0, 120);
  const cursor = decodeResourceCursor(input.cursor);
  const pattern = `%${escapeLike(q)}%`;
  const score = q
    ? sql<number>`(
        CASE WHEN ${resources.title} ILIKE ${pattern} THEN 8 ELSE 0 END +
        CASE WHEN ${resources.originalFilename} ILIKE ${pattern} THEN 4 ELSE 0 END +
        CASE WHEN ${resources.description} ILIKE ${pattern} THEN 2 ELSE 0 END +
        CASE WHEN array_to_string(${resources.tags}, ' ') ILIKE ${pattern} THEN 1 ELSE 0 END
      )`
    : sql<number>`0`;
  const published = sql<Date>`coalesce(${resources.publishedAt}, ${resources.createdAt})`;

  const filters = [eq(resources.status, "active")];
  if (q) {
    filters.push(
      or(
        ilike(resources.title, pattern),
        ilike(resources.description, pattern),
        ilike(resources.originalFilename, pattern),
        sql`array_to_string(${resources.tags}, ' ') ILIKE ${pattern}`,
      )!,
    );
  }
  if (cursor) {
    const cursorDate = new Date(cursor.publishedAt);
    filters.push(
      or(
        lt(score, cursor.score),
        and(
          eq(score, cursor.score),
          or(
            lt(published, cursorDate),
            and(eq(published, cursorDate), lt(resources.id, cursor.id)),
          ),
        ),
      )!,
    );
  }

  const rows = await getDatabase()
    .select({
      id: resources.id,
      title: resources.title,
      description: resources.description,
      tags: resources.tags,
      originalFilename: resources.originalFilename,
      mimeType: resources.mimeType,
      sizeBytes: resources.sizeBytes,
      publishedAt: published,
      authorName: users.displayName,
      score,
    })
    .from(resources)
    .innerJoin(users, eq(resources.authorId, users.id))
    .where(and(...filters))
    .orderBy(...(
      q
        ? [desc(score), desc(published), desc(resources.id)]
        : [desc(published), desc(resources.id)]
    ))
    .limit(PAGE_SIZE + 1);

  const hasNextPage = rows.length > PAGE_SIZE;
  // postgres.js returns raw SQL expressions such as COALESCE as strings even
  // when Drizzle's TypeScript annotation describes them as Date instances.
  const page = rows.slice(0, PAGE_SIZE).map((item) => ({
    ...item,
    publishedAt: normalizeDatabaseDate(item.publishedAt),
  }));
  const last = page.at(-1);
  const nextCursor =
    hasNextPage && last
      ? encodeResourceCursor({
          score: Number(last.score),
          publishedAt: last.publishedAt.toISOString(),
          id: last.id,
        })
      : null;

  return {
    items: page.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      tags: item.tags,
      originalFilename: item.originalFilename,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      publishedAt: item.publishedAt,
      authorName: item.authorName,
    })),
    nextCursor,
  };
}

export async function getActiveResource(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [resource] = await getDatabase()
    .select({
      id: resources.id,
      title: resources.title,
      description: resources.description,
      tags: resources.tags,
      originalFilename: resources.originalFilename,
      mimeType: resources.mimeType,
      sizeBytes: resources.sizeBytes,
      publishedAt: resources.publishedAt,
      authorName: users.displayName,
      authorId: users.id,
    })
    .from(resources)
    .innerJoin(users, eq(resources.authorId, users.id))
    .where(and(eq(resources.id, id), eq(resources.status, "active")))
    .limit(1);
  return resource ?? null;
}

export async function getResourceForViewer(id: string, viewer: CurrentUser) {
  if (!z.uuid().safeParse(id).success) return null;
  const visibility = viewer.role === "admin"
    ? sql`${resources.status} <> 'deleted'`
    : or(eq(resources.status, "active"), and(eq(resources.authorId, viewer.id), sql`${resources.status} <> 'deleted'`));
  const [resource] = await getDatabase()
    .select({
      id: resources.id,
      title: resources.title,
      description: resources.description,
      tags: resources.tags,
      originalFilename: resources.originalFilename,
      mimeType: resources.mimeType,
      sizeBytes: resources.sizeBytes,
      status: resources.status,
      publishedAt: resources.publishedAt,
      authorName: users.displayName,
      authorId: users.id,
    })
    .from(resources)
    .innerJoin(users, eq(resources.authorId, users.id))
    .where(and(eq(resources.id, id), visibility))
    .limit(1);
  return resource ?? null;
}
