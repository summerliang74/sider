import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function hashOpaqueToken(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value, "utf8").digest("base64url");
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function pkceChallenge(verifier: string): string {
  return sha256(verifier);
}

export function sealJson(value: unknown, secret: string): string {
  const key = createHash("sha256").update(secret, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", base64url(iv), base64url(ciphertext), base64url(tag)].join(".");
}

export function openJson<T>(sealed: string, secret: string, schema: z.ZodType<T>): T | null {
  try {
    const [version, ivValue, ciphertextValue, tagValue] = sealed.split(".");
    if (version !== "v1" || !ivValue || !ciphertextValue || !tagValue) return null;

    const key = createHash("sha256").update(secret, "utf8").digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return schema.parse(JSON.parse(plaintext) as unknown);
  } catch {
    return null;
  }
}
