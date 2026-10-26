import { BotChallengeError } from "./bot";
import { RateLimitError, rateLimitResponse } from "./rate-limit";
import { NextResponse } from "next/server";

export function securityErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof RateLimitError) return rateLimitResponse(error);
  if (error instanceof BotChallengeError) {
    return NextResponse.json(
      { error: `bot_challenge_${error.reason}` },
      { status: error.reason === "unavailable" ? 503 : 403, headers: { "cache-control": "no-store" } },
    );
  }
  return null;
}
