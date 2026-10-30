import { NextResponse } from "next/server";

import { hashPassword } from "@/src/lib/auth/password";
import {
  registrationRequestSchema,
  validateRegistrationInput,
} from "@/src/lib/auth/registration-policy";
import { setSessionCookie } from "@/src/lib/auth/session";
import { getServerEnv } from "@/src/lib/env";
import { noStoreJson } from "@/src/lib/http";
import {
  hashRegistrationInvite,
  InvalidInviteError,
  registerInvitedUser,
  UsernameTakenError,
} from "@/src/lib/registration-invites";
import { BotChallengeError, verifyBotChallenge } from "@/src/lib/security/bot";
import {
  enforceIpRateLimit,
  enforceRegistrationIdentityRateLimit,
} from "@/src/lib/security/rate-limit";
import { getClientIp, requireSameOrigin } from "@/src/lib/security/request";
import { securityErrorResponse } from "@/src/lib/security/responses";
import { recordMetric } from "@/src/lib/telemetry";

function denied(reason: "invalid_request" | "closed" | "invalid_invite" | "username_taken" | "bot_failed") {
  recordMetric("registration.denied", { reason });
}

export async function POST(request: Request): Promise<NextResponse> {
  const env = getServerEnv();
  if (env.AUTH_MODE !== "local") return noStoreJson({ error: "not_found" }, { status: 404 });
  if (env.REGISTRATION_MODE !== "invite") {
    denied("closed");
    return noStoreJson({ error: "registration_closed" }, { status: 403 });
  }
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });

  recordMetric("registration.attempted");
  const parsed = registrationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    denied("invalid_request");
    return noStoreJson({ error: "invalid_request" }, { status: 400 });
  }
  const validation = validateRegistrationInput(parsed.data);
  if (!validation.ok) {
    denied("invalid_request");
    return noStoreJson({ error: validation.error }, { status: 400 });
  }

  const { username, displayName, password, inviteCode, botToken } = validation.value;
  try {
    const ip = getClientIp(request);
    const ipLimit = await enforceIpRateLimit("register", ip);
    const [usernameLimit, inviteLimit] = await Promise.all([
      enforceRegistrationIdentityRateLimit("username", username),
      enforceRegistrationIdentityRateLimit("invite", inviteCode),
    ]);
    const challengeRequired = env.REGISTRATION_FORCE_CHALLENGE || ipLimit.risky || usernameLimit.risky || inviteLimit.risky;
    if (challengeRequired) {
      recordMetric("registration.challenge_required");
      if (!botToken) {
        return noStoreJson(
          { error: "bot_challenge_required", challengeRequired: true },
          { status: 403 },
        );
      }
      await verifyBotChallenge({ required: true, token: botToken, action: "register", ip });
      recordMetric("registration.challenge_passed");
    }

    const passwordHash = await hashPassword(password);
    const result = await registerInvitedUser({
      username,
      displayName,
      passwordHash,
      inviteHash: hashRegistrationInvite(inviteCode),
    });
    const response = noStoreJson({
      user: result.user,
      redirectUrl: "/resources",
    }, { status: 201 });
    setSessionCookie(response, result.session);
    recordMetric("registration.succeeded");
    recordMetric("registration_invite.consumed");
    return response;
  } catch (error) {
    if (error instanceof BotChallengeError) {
      if (error.reason === "unavailable") {
        recordMetric("registration.platform_error");
        return noStoreJson({ error: "service_unavailable" }, { status: 503 });
      }
      denied("bot_failed");
      return noStoreJson({ error: "bot_challenge_invalid", challengeRequired: true }, { status: 403 });
    }
    if (error instanceof InvalidInviteError) {
      denied("invalid_invite");
      return noStoreJson({ error: "invalid_invite" }, { status: 403 });
    }
    if (error instanceof UsernameTakenError) {
      denied("username_taken");
      return noStoreJson({ error: "username_taken" }, { status: 409 });
    }
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) {
      if (securityResponse.status === 429) recordMetric("registration.denied", { reason: "rate_limited" });
      else recordMetric("registration.denied", { reason: "bot_failed" });
      return securityResponse;
    }
    recordMetric("registration.platform_error");
    return noStoreJson({ error: "service_unavailable" }, { status: 503 });
  }
}
