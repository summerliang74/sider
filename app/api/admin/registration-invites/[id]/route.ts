import { z } from "zod";

import { getServerEnv } from "@/src/lib/env";
import { noStoreJson } from "@/src/lib/http";
import { revokeRegistrationInvite } from "@/src/lib/registration-invites";
import { authorizeAdminRequest } from "@/src/lib/security/admin";
import { requireSameOrigin } from "@/src/lib/security/request";
import { recordMetric } from "@/src/lib/telemetry";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (getServerEnv().AUTH_MODE !== "local") return noStoreJson({ error: "not_found" }, { status: 404 });
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeAdminRequest(request, "invite_revoke");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return noStoreJson({ error: "invite_unavailable" }, { status: 409 });
  try {
    const revoked = await revokeRegistrationInvite(id, authorization.user.id);
    if (!revoked) return noStoreJson({ error: "invite_unavailable" }, { status: 409 });
    recordMetric("registration_invite.revoked");
    return noStoreJson({ status: "revoked" });
  } catch {
    return noStoreJson({ error: "service_unavailable" }, { status: 503 });
  }
}
