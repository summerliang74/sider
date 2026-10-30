import { randomUUID } from "node:crypto";

import { eq, inArray, like, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabaseForTests, getDatabase } from "@/src/db";
import { localAccounts, registrationInvites, users } from "@/src/db/schema";
import {
  createRegistrationInvite,
  hashRegistrationInvite,
  InvalidInviteError,
  registerInvitedUser,
  UsernameTakenError,
} from "./registration-invites";

const integrationEnabled = process.env.REGISTRATION_DB_INTEGRATION === "isolated-branch";
const integrationDescribe = integrationEnabled ? describe : describe.skip;
const runId = randomUUID().replaceAll("-", "");
const identityPrefix = `registration-test-${runId}`;
let administratorId = "";

async function newInvite() {
  return createRegistrationInvite({
    actorId: administratorId,
    expiresInHours: 1,
    note: `integration-${runId}`,
  });
}

integrationDescribe("registration invitation database transactions", () => {
  beforeAll(async () => {
    const [administrator] = await getDatabase().insert(users).values({
      launchpadSub: `${identityPrefix}-administrator`,
      displayName: "Registration integration administrator",
      org: "local",
      verified: true,
      role: "admin",
      status: "active",
    }).returning({ id: users.id });
    if (!administrator) throw new Error("integration_administrator_create_failed");
    administratorId = administrator.id;
  });

  afterAll(async () => {
    try {
      if (administratorId) {
        await getDatabase().delete(registrationInvites).where(eq(registrationInvites.createdBy, administratorId));
      }
      await getDatabase().delete(users).where(or(
        like(users.launchpadSub, `${identityPrefix}%`),
        like(users.launchpadSub, `local:${identityPrefix}%`),
      ));
    } finally {
      await closeDatabaseForTests();
    }
  });

  it("allows only one concurrent consumer for the same invitation", async () => {
    const invite = await newInvite();
    const inviteHash = hashRegistrationInvite(invite.code);
    const results = await Promise.allSettled([
      registerInvitedUser({
        username: `${identityPrefix}-invite-a`,
        displayName: "Invite contender A",
        passwordHash: "integration-password-hash",
        inviteHash,
      }),
      registerInvitedUser({
        username: `${identityPrefix}-invite-b`,
        displayName: "Invite contender B",
        passwordHash: "integration-password-hash",
        inviteHash,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection?.status === "rejected" ? rejection.reason : null).toBeInstanceOf(InvalidInviteError);
  }, 30_000);

  it("allows only one concurrent registration for the same username", async () => {
    const [firstInvite, secondInvite] = await Promise.all([newInvite(), newInvite()]);
    const username = `${identityPrefix}-same-username`;
    const results = await Promise.allSettled([
      registerInvitedUser({
        username,
        displayName: "Username contender A",
        passwordHash: "integration-password-hash",
        inviteHash: hashRegistrationInvite(firstInvite.code),
      }),
      registerInvitedUser({
        username,
        displayName: "Username contender B",
        passwordHash: "integration-password-hash",
        inviteHash: hashRegistrationInvite(secondInvite.code),
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection?.status === "rejected" ? rejection.reason : null).toBeInstanceOf(UsernameTakenError);

    const inviteRows = await getDatabase().select({ consumedAt: registrationInvites.consumedAt })
      .from(registrationInvites)
      .where(inArray(registrationInvites.id, [firstInvite.id, secondInvite.id]));
    expect(inviteRows.filter((invite) => invite.consumedAt !== null)).toHaveLength(1);
    expect(inviteRows.filter((invite) => invite.consumedAt === null)).toHaveLength(1);
  }, 30_000);

  it("rolls back the user and invitation when local account insertion fails", async () => {
    const username = `${identityPrefix}-account-conflict`;
    const [holder] = await getDatabase().insert(users).values({
      launchpadSub: `${identityPrefix}-conflict-holder`,
      displayName: "Conflict holder",
      org: "local",
      verified: true,
      role: "student",
      status: "active",
    }).returning({ id: users.id });
    if (!holder) throw new Error("integration_conflict_holder_create_failed");
    await getDatabase().insert(localAccounts).values({
      userId: holder.id,
      username,
      passwordHash: "integration-password-hash",
    });
    const invite = await newInvite();

    await expect(registerInvitedUser({
      username,
      displayName: "Must roll back",
      passwordHash: "integration-password-hash",
      inviteHash: hashRegistrationInvite(invite.code),
    })).rejects.toBeInstanceOf(UsernameTakenError);

    const rolledBackUsers = await getDatabase().select({ id: users.id })
      .from(users)
      .where(eq(users.launchpadSub, `local:${username}`));
    const [unchangedInvite] = await getDatabase().select({ consumedAt: registrationInvites.consumedAt })
      .from(registrationInvites)
      .where(eq(registrationInvites.id, invite.id));
    expect(rolledBackUsers).toHaveLength(0);
    expect(unchangedInvite?.consumedAt).toBeNull();
  }, 30_000);
});
