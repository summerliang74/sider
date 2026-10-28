import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import { promisify } from "node:util";

import postgres from "postgres";

const scrypt = promisify(nodeScrypt);
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,63}$/;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", 16_384, 8, 1, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

const username = argument("username")?.trim().toLowerCase();
const displayName = argument("display-name")?.trim();
const password = process.env.NEW_USER_PASSWORD;
const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!username || !usernamePattern.test(username)) throw new Error("--username must be 3-64 lowercase letters, numbers, dots, underscores, or hyphens");
if (!displayName || displayName.length > 120) throw new Error("--display-name is required and must be at most 120 characters");
if (!password || password.length < 16) throw new Error("NEW_USER_PASSWORD must contain at least 16 characters");
if (!databaseUrl) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required");

const passwordHash = await hashPassword(password);
const client = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const userId = await client.begin(async (sql) => {
    const existing = await sql`SELECT 1 FROM local_accounts WHERE username = ${username} LIMIT 1`;
    if (existing.length > 0) throw new Error(`Local username already exists: ${username}`);

    const [user] = await sql`
      INSERT INTO users (launchpad_sub, email, display_name, avatar_url, org, verified, role, status)
      VALUES (${`local:${username}`}, NULL, ${displayName}, NULL, 'local', TRUE, 'student', 'active')
      RETURNING id
    `;
    await sql`
      INSERT INTO local_accounts (user_id, username, password_hash)
      VALUES (${user.id}, ${username}, ${passwordHash})
    `;
    return user.id;
  });
  process.stdout.write(`${JSON.stringify({ id: userId, username, displayName, role: "student" })}\n`);
} finally {
  await client.end();
}
