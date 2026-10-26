import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["student", "admin"]);
export const userStatus = pgEnum("user_status", ["active", "suspended"]);
export const resourceStatus = pgEnum("resource_status", [
  "pending",
  "scanning",
  "active",
  "hidden",
  "quarantined",
  "deleted",
  "failed",
]);
export const reportReason = pgEnum("report_reason", [
  "copyright_privacy",
  "malware",
  "inappropriate",
  "spam",
  "other",
]);
export const reportStatus = pgEnum("report_status", ["open", "resolved", "dismissed"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    launchpadSub: text("launchpad_sub").notNull(),
    email: text("email"),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    org: text("org").notNull(),
    verified: boolean("verified").notNull(),
    role: userRole("role").notNull().default("student"),
    status: userStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_launchpad_sub_unique").on(table.launchpadSub)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_active_idx").on(table.userId, table.expiresAt),
  ],
);

export const oauthLoginTransactions = pgTable(
  "oauth_login_transactions",
  {
    id: uuid("id").primaryKey(),
    stateHash: text("state_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("oauth_login_transactions_expiry_idx").on(table.expiresAt)],
);

export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    originalFilename: text("original_filename").notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256"),
    status: resourceStatus("status").notNull().default("pending"),
    moderationReason: text("moderation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    objectDeletedAt: timestamp("object_deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("resources_object_key_unique").on(table.objectKey),
    index("resources_active_published_idx")
      .on(table.publishedAt.desc(), table.id.desc())
      .where(sql`${table.status} = 'active'`),
    index("resources_author_created_idx").on(table.authorId, table.createdAt.desc()),
  ],
);

export const resourceReports = pgTable(
  "resource_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: reportReason("reason").notNull(),
    details: text("details").notNull().default(""),
    status: reportStatus("status").notNull().default("open"),
    handledBy: uuid("handled_by").references(() => users.id, { onDelete: "restrict" }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("resource_reports_open_unique")
      .on(table.resourceId, table.reporterId)
      .where(sql`${table.status} = 'open'`),
    index("resource_reports_queue_idx").on(table.status, table.createdAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_logs_target_idx").on(table.targetType, table.targetId, table.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Resource = typeof resources.$inferSelect;
