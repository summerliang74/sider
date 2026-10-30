import "server-only";

import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import { getDatabase } from "@/src/db";
import { auditLogs, localAccounts, registrationInvites, sessions, users } from "@/src/db/schema";
import { prepareSession, type PreparedSession } from "@/src/lib/auth/session";
import { hashOpaqueToken, randomToken } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";

export class InvalidInviteError extends Error {
  constructor() { super("invalid_invite"); }
}

export class UsernameTakenError extends Error {
  constructor() { super("username_taken"); }
}

function invitePepper(): string {
  const pepper = getServerEnv().REGISTRATION_INVITE_PEPPER;
  if (!pepper) throw new Error("registration_invite_pepper_missing");
  return pepper;
}

export function hashRegistrationInvite(code: string): string {
  return hashOpaqueToken(`registration-invite:${code.trim()}`, invitePepper());
}

export function generateRegistrationInvite(): string {
  return `sider_invite_${randomToken(32)}`;
}

export type InviteStatus = "active" | "consumed" | "expired" | "revoked";

export function registrationInviteStatus(invite: {
  revokedAt: Date | null;
  consumedAt: Date | null;
  expiresAt: Date;
}, now = new Date()): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.consumedAt) return "consumed";
  if (invite.expiresAt <= now) return "expired";
  return "active";
}

export async function createRegistrationInvite(input: {
  actorId: string;
  expiresInHours: number;
  note: string | null;
}): Promise<{ id: string; code: string; expiresAt: Date }> {
  const code = generateRegistrationInvite();
  const tokenHash = hashRegistrationInvite(code);
  const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);
  return getDatabase().transaction(async (tx) => {
    const [invite] = await tx.insert(registrationInvites).values({
      tokenHash,
      createdBy: input.actorId,
      note: input.note,
      expiresAt,
    }).returning({ id: registrationInvites.id });
    if (!invite) throw new Error("registration_invite_create_failed");
    await tx.insert(auditLogs).values({
      actorId: input.actorId,
      action: "registration_invite.create",
      targetType: "registration_invite",
      targetId: invite.id,
      metadata: { expiresAt: expiresAt.toISOString() },
    });
    return { id: invite.id, code, expiresAt };
  });
}

type InviteCursor = { createdAt: string; id: string };

function encodeCursor(cursor: InviteCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeInviteCursor(value: string | null): InviteCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<InviteCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)
    ) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

export async function listRegistrationInvites(cursor: InviteCursor | null) {
  const createdAt = cursor ? new Date(cursor.createdAt) : null;
  const rows = await getDatabase()
    .select({
      id: registrationInvites.id,
      note: registrationInvites.note,
      createdAt: registrationInvites.createdAt,
      expiresAt: registrationInvites.expiresAt,
      consumedAt: registrationInvites.consumedAt,
      revokedAt: registrationInvites.revokedAt,
      createdById: users.id,
      createdByName: users.displayName,
    })
    .from(registrationInvites)
    .innerJoin(users, eq(registrationInvites.createdBy, users.id))
    .where(cursor && createdAt
      ? or(
        lt(registrationInvites.createdAt, createdAt),
        and(eq(registrationInvites.createdAt, createdAt), lt(registrationInvites.id, cursor.id)),
      )
      : undefined)
    .orderBy(desc(registrationInvites.createdAt), desc(registrationInvites.id))
    .limit(21);

  const page = rows.slice(0, 20);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      status: registrationInviteStatus(row),
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      consumedAt: row.consumedAt?.toISOString() ?? null,
      createdBy: { id: row.createdById, displayName: row.createdByName },
    })),
    nextCursor: rows.length > 20 && last
      ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
      : null,
  };
}

export async function revokeRegistrationInvite(id: string, actorId: string): Promise<boolean> {
  return getDatabase().transaction(async (tx) => {
    const [invite] = await tx.update(registrationInvites)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(registrationInvites.id, id),
        isNull(registrationInvites.consumedAt),
        isNull(registrationInvites.revokedAt),
        gt(registrationInvites.expiresAt, new Date()),
      ))
      .returning({ id: registrationInvites.id });
    if (!invite) return false;
    await tx.insert(auditLogs).values({
      actorId,
      action: "registration_invite.revoke",
      targetType: "registration_invite",
      targetId: id,
      metadata: {},
    });
    return true;
  });
}

function isUsernameConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; constraint_name?: string; constraint?: string };
  const constraint = candidate.constraint_name ?? candidate.constraint ?? "";
  return candidate.code === "23505" && (
    constraint === "users_launchpad_sub_unique" ||
    constraint === "local_accounts_username_unique"
  );
}

export async function registerInvitedUser(input: {
  username: string;
  displayName: string;
  passwordHash: string;
  inviteHash: string;
}): Promise<{ user: { id: string; displayName: string; role: "student" }; session: PreparedSession }> {
  const session = prepareSession();
  try {
    return await getDatabase().transaction(async (tx) => {
      const locked = await tx.execute<{ id: string }>(sql`
        select id
        from registration_invites
        where token_hash = ${input.inviteHash}
          and consumed_at is null
          and revoked_at is null
          and expires_at > now()
        for update
      `);
      const invite = locked[0];
      if (!invite) throw new InvalidInviteError();

      const [user] = await tx.insert(users).values({
        launchpadSub: `local:${input.username}`,
        email: null,
        displayName: input.displayName,
        avatarUrl: null,
        org: "local",
        verified: true,
        role: "student",
        status: "active",
      }).returning({ id: users.id, displayName: users.displayName });
      if (!user) throw new Error("registration_user_create_failed");

      await tx.insert(localAccounts).values({
        userId: user.id,
        username: input.username,
        passwordHash: input.passwordHash,
      });
      await tx.insert(sessions).values({
        userId: user.id,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
      });
      await tx.update(registrationInvites).set({
        consumedBy: user.id,
        consumedAt: new Date(),
      }).where(eq(registrationInvites.id, invite.id));
      await tx.insert(auditLogs).values({
        actorId: user.id,
        action: "user.register",
        targetType: "user",
        targetId: user.id,
        metadata: { source: "local_invite" },
      });
      return { user: { id: user.id, displayName: user.displayName, role: "student" as const }, session };
    });
  } catch (error) {
    if (error instanceof InvalidInviteError) throw error;
    if (isUsernameConflict(error)) throw new UsernameTakenError();
    throw error;
  }
}
