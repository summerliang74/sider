import "server-only";

import { z } from "zod";

import { sha256 } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";
import { redisCommand } from "./rate-limit";
import { recordMetric } from "@/src/lib/telemetry";
import { isValidBotVerification } from "./bot-policy";

const verifySchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  challenge_ts: z.string().optional(),
});

export class BotChallengeError extends Error {
  constructor(public readonly reason: "required" | "invalid" | "unavailable") {
    super(`bot_challenge_${reason}`);
  }
}

export async function verifyBotChallenge(input: {
  required: boolean;
  token?: string;
  action: string;
  ip: string;
}): Promise<void> {
  if (!input.required) return;
  recordMetric("bot_challenge.triggered", { action: input.action });
  if (!input.token) throw new BotChallengeError("required");
  const env = getServerEnv();
  let response: Response;
  try {
    response = await fetch(env.BOT_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: env.BOT_VERIFY_SECRET, response: input.token, remoteip: input.ip }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new BotChallengeError("unavailable");
  }
  if (!response.ok) throw new BotChallengeError("unavailable");
  const result = verifySchema.safeParse(await response.json());
  const expectedHost = new URL(env.APP_BASE_URL).hostname;
  if (
    !result.success ||
    !isValidBotVerification(result.data, { hostname: expectedHost, action: input.action })
  ) {
    recordMetric("bot_challenge.failed", { action: input.action });
    throw new BotChallengeError("invalid");
  }
  const replay = await redisCommand(["SET", `shsid:bot:${sha256(input.token)}`, "1", "EX", 600, "NX"]);
  if (replay !== "OK") throw new BotChallengeError("invalid");
  recordMetric("bot_challenge.passed", { action: input.action });
}
