import { z } from "zod";

import { getServerEnv } from "@/src/lib/env";
import { noStoreJson } from "@/src/lib/http";
import {
  createRegistrationInvite,
  decodeInviteCursor,
  listRegistrationInvites,
} from "@/src/lib/registration-invites";
import { authorizeAdminRequest } from "@/src/lib/security/admin";
import { requireSameOrigin } from "@/src/lib/security/request";
import { recordMetric } from "@/src/lib/telemetry";

const createSchema = z.object({
  expiresInHours: z.number().int().min(1).max(168),
  note: z.string().trim().max(120).optional(),
}).strict();

export async function GET(request: Request) {
  if (getServerEnv().AUTH_MODE !== "local") return noStoreJson({ error: "not_found" }, { status: 404 });
  const authorization = await authorizeAdminRequest(request);
  if (authorization.response) return authorization.response;
  const cursorValue = new URL(request.url).searchParams.get("cursor");
  const cursor = decodeInviteCursor(cursorValue);
  if (cursorValue && !cursor) return noStoreJson({ error: "invalid_request" }, { status: 400 });
  try {
    return noStoreJson(await listRegistrationInvites(cursor));
  } catch {
    return noStoreJson({ error: "service_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (getServerEnv().AUTH_MODE !== "local") return noStoreJson({ error: "not_found" }, { status: 404 });
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeAdminRequest(request, "invite_create");
  if (authorization.response) return authorization.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "invalid_request" }, { status: 400 });
  try {
    const invite = await createRegistrationInvite({
      actorId: authorization.user.id,
      expiresInHours: parsed.data.expiresInHours,
      note: parsed.data.note || null,
    });
    recordMetric("registration_invite.created");
    return noStoreJson({ invite: { ...invite, expiresAt: invite.expiresAt.toISOString() } }, { status: 201 });
  } catch {
    return noStoreJson({ error: "service_unavailable" }, { status: 503 });
  }
}
