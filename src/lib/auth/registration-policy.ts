import { z } from "zod";

export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "security",
  "api",
  "sider",
]);

export const registrationRequestSchema = z.object({
  username: z.string().max(128),
  displayName: z.string().max(240),
  password: z.string().max(256),
  inviteCode: z.string().max(256),
  botToken: z.string().max(4096),
  acceptTerms: z.boolean(),
}).strict();

export type RegistrationInput = z.infer<typeof registrationRequestSchema>;

export type RegistrationValidation =
  | { ok: true; value: RegistrationInput & { username: string; displayName: string; inviteCode: string } }
  | { ok: false; error: "invalid_request" | "weak_password" | "terms_required" };

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateRegistrationInput(input: RegistrationInput): RegistrationValidation {
  const username = normalizeUsername(input.username);
  const displayName = input.displayName.trim();
  const inviteCode = input.inviteCode.trim();

  if (!input.acceptTerms) return { ok: false, error: "terms_required" };
  if (unicodeLength(input.password) < 16 || unicodeLength(input.password) > 128) {
    return { ok: false, error: "weak_password" };
  }
  if (
    !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username) ||
    RESERVED_USERNAMES.has(username) ||
    unicodeLength(displayName) < 1 ||
    unicodeLength(displayName) > 120 ||
    /\p{Cc}/u.test(displayName) ||
    !inviteCode
  ) {
    return { ok: false, error: "invalid_request" };
  }

  return { ok: true, value: { ...input, username, displayName, inviteCode } };
}
