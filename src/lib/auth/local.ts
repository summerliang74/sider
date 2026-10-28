import "server-only";

import { hashOpaqueToken, safeEqual } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";

function protectedEqual(left: string, right: string, pepper: string): boolean {
  return safeEqual(hashOpaqueToken(left, pepper), hashOpaqueToken(right, pepper));
}

export function verifyLocalCredentials(username: string, password: string): boolean {
  const env = getServerEnv();
  if (env.AUTH_MODE !== "local" || !env.LOCAL_AUTH_PASSWORD) return false;
  return protectedEqual(username, env.LOCAL_AUTH_USERNAME, env.SESSION_SECRET) &&
    protectedEqual(password, env.LOCAL_AUTH_PASSWORD, env.SESSION_SECRET);
}
