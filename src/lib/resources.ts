import "server-only";

import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDatabase } from "@/src/db";
import { resources, users } from "@/src/db/schema";
import { decodeResourceCursor, encodeResourceCursor } from "@/src/lib/resource-cursor";
import {
  resourceFileTypeMimeTypes,
  resourceFileTypes,
  type ResourceFileType,
} from "@/src/lib/resource-search";
import type { CurrentUser } from "@/src/lib/auth/session";

const PAGE_SIZE = 20;
const HEADLINE_START = "\uE000";
const HEADLINE_END = "\uE001";

export const resourceSearchSchema = z.object({
  q: z.string().trim().max(120).default(""),
  fileType: z.enum(resourceFileTypes).optional(),
  cursor: z.string().max(1000).optional(),
});

export type SearchHighlightSegment = {
  text: string;
  highlighted: boolean;
};

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
  highlights?: {
    title: SearchHighlightSegment[];
    description: SearchHighlightSegment[];
  };
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

export function parseSearchHeadline(value: unknown, fallback: string): SearchHighlightSegment[] {
  const headline = typeof value === "string" && value.length > 0 ? value : fallback;
  if (!headline) return [];

  const segments: SearchHighlightSegment[] = [];
  let offset = 0;
  while (offset < headline.length) {
    const start = headline.indexOf(HEADLINE_START, offset);
    if (start < 0) {
      segments.push({ text: headline.slice(offset), highlighted: false });
      break;
    }
    if (start > offset) {
      segments.push({ text: headline.slice(offset, start), highlighted: false });
    }
    const end = headline.indexOf(HEADLINE_END, start + HEADLINE_START.length);
    if (end < 0) {
      segments.push({ text: headline.slice(start + HEADLINE_START.length), highlighted: false });
      break;
    }
    segments.push({
      text: headline.slice(start + HEADLINE_START.length, end),
      highlighted: true,
    });
    offset = end + HEADLINE_END.length;
  }

  return segments.filter((segment) => segment.text.length > 0);
}

export async function listActiveResources(input: {
  q: string;
  fileType?: ResourceFileType;
  cursor?: string;
}): Promise<{ items: ResourceListItem[]; nextCursor: string | null }> {
  const q = input.q.trim().slice(0, 120);
  const cursor = decodeResourceCursor(input.cursor);
  const pattern = `%${escapeLike(q)}%`;
  const tsQuery = sql`websearch_to_tsquery('simple', ${q})`;
  const score = q
    ? sql<number>`round((
        ts_rank_cd(${resources.searchVector}, ${tsQuery}, 32)::numeric * 100 +
        word_similarity(${q}, ${resources.searchText})::numeric * 10 +
        CASE WHEN ${resources.title} ILIKE ${pattern} THEN 8 ELSE 0 END +
        CASE WHEN ${resources.originalFilename} ILIKE ${pattern} THEN 4 ELSE 0 END +
        CASE WHEN ${resources.description} ILIKE ${pattern} THEN 2 ELSE 0 END +
        CASE WHEN array_to_string(${resources.tags}, ' ') ILIKE ${pattern} THEN 1 ELSE 0 END
      )::numeric, 6)::double precision`
    : sql<number>`0`;
  const published = sql<Date>`coalesce(${resources.publishedAt}, ${resources.createdAt})`;
  const titleHeadline = q
    ? sql<string>`ts_headline(
        'simple',
        ${resources.title},
        ${tsQuery},
        'StartSel=${sql.raw(HEADLINE_START)}, StopSel=${sql.raw(HEADLINE_END)}, HighlightAll=true, MaxWords=20, MinWords=1, ShortWord=1'
      )`
    : sql<string>`${resources.title}`;
  const descriptionSource = sql<string>`coalesce(nullif(${resources.description}, ''), ${resources.originalFilename})`;
  const descriptionHeadline = q
    ? sql<string>`ts_headline(
        'simple',
        ${descriptionSource},
        ${tsQuery},
        'StartSel=${sql.raw(HEADLINE_START)}, StopSel=${sql.raw(HEADLINE_END)}, MaxWords=24, MinWords=8, ShortWord=2, MaxFragments=2, FragmentDelimiter= … '
      )`
    : descriptionSource;

  const filters = [eq(resources.status, "active")];
  if (input.fileType) {
    filters.push(eq(resources.mimeType, resourceFileTypeMimeTypes[input.fileType]));
  }
  if (q) {
    filters.push(
      or(
        sql`${resources.searchVector} @@ ${tsQuery}`,
        sql`${resources.searchText} %> ${q}`,
        ilike(resources.searchText, pattern),
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

  const rows = await getDatabase().transaction(async (tx) => {
    if (q) {
      // The pg_trgm word-similarity operator reads this threshold. SET LOCAL
      // keeps the lower typo-tolerant value scoped to this pooled transaction.
      await tx.execute(sql`SET LOCAL pg_trgm.word_similarity_threshold = 0.3`);
    }
    return tx
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
        titleHeadline,
        descriptionHeadline,
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
  });

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
      ...(q
        ? {
            highlights: {
              title: parseSearchHeadline(item.titleHeadline, item.title),
              description: parseSearchHeadline(
                item.descriptionHeadline,
                item.description || item.originalFilename,
              ),
            },
          }
        : {}),
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
