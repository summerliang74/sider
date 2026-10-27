import { randomUUID } from "node:crypto";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import postgres from "postgres";

const hasExplicitS3Config = Boolean(process.env.S3_ENDPOINT);
const storage = {
  endpoint: hasExplicitS3Config ? process.env.S3_ENDPOINT : process.env.AWS_ENDPOINT_URL_S3,
  region: hasExplicitS3Config ? process.env.S3_REGION : process.env.AWS_REGION,
  accessKeyId: hasExplicitS3Config ? process.env.S3_ACCESS_KEY_ID : process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: hasExplicitS3Config
    ? process.env.S3_SECRET_ACCESS_KEY
    : process.env.AWS_SECRET_ACCESS_KEY,
  bucket: process.env.S3_BUCKET,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
};

const rateLimit = {
  url: process.env.RATE_LIMIT_URL,
  token: process.env.RATE_LIMIT_TOKEN,
};

for (const [name, value] of Object.entries({
  DATABASE_URL: process.env.DATABASE_URL,
  ...storage,
  RATE_LIMIT_URL: rateLimit.url,
  RATE_LIMIT_TOKEN: rateLimit.token,
})) {
  if (value === undefined || value === "") throw new Error(`${name} is required`);
}

async function redisCommand(command) {
  const response = await fetch(rateLimit.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rateLimit.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Redis REST request failed with ${response.status}`);
  const payload = await response.json();
  if (!("result" in payload)) throw new Error("Redis REST response is missing result");
  return payload.result;
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
const s3 = new S3Client({
  endpoint: storage.endpoint,
  region: storage.region,
  forcePathStyle: storage.forcePathStyle,
  credentials: {
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
  },
});

const prefix = `diagnostics/${randomUUID()}`;
const sourceKey = `${prefix}/source.txt`;
const copyKey = `${prefix}/copy.txt`;
const rateLimitKey = `diagnostics:rate-limit:${randomUUID()}`;
const payload = Buffer.from(`sider-service-check-${randomUUID()}`, "utf8");

try {
  const [{ connected, usersTable }] = await sql`
    select 1 as connected, to_regclass('public.users')::text as "usersTable"
  `;
  if (connected !== 1 || usersTable !== "users") throw new Error("Postgres schema verification failed");
  console.log("PASS Postgres connection and migrated schema");

  await s3.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: sourceKey,
    Body: payload,
    ContentType: "text/plain",
  }));
  const head = await s3.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: sourceKey }));
  if (head.ContentLength !== payload.length) throw new Error("Object size verification failed");

  await s3.send(new CopyObjectCommand({
    Bucket: storage.bucket,
    Key: copyKey,
    CopySource: `${storage.bucket}/${sourceKey}`,
  }));
  const downloaded = await s3.send(new GetObjectCommand({ Bucket: storage.bucket, Key: copyKey }));
  const bytes = await downloaded.Body?.transformToByteArray();
  if (!bytes || !Buffer.from(bytes).equals(payload)) throw new Error("Object content verification failed");

  const listed = await s3.send(new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: prefix }));
  if ((listed.Contents?.length ?? 0) < 2) throw new Error("Object listing verification failed");
  console.log("PASS Object Storage put, head, copy, get, and list");

  const pong = await redisCommand(["PING"]);
  if (pong !== "PONG") throw new Error("Redis PING verification failed");
  const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; local t=redis.call('TTL',KEYS[1]); return {n,t}";
  const first = await redisCommand(["EVAL", script, 1, rateLimitKey, 60]);
  const second = await redisCommand(["EVAL", script, 1, rateLimitKey, 60]);
  if (!Array.isArray(first) || Number(first[0]) !== 1 || !Array.isArray(second) || Number(second[0]) !== 2) {
    throw new Error("Redis atomic counter verification failed");
  }
  console.log("PASS Redis REST ping and atomic rate-limit counter");
} finally {
  await Promise.allSettled([
    s3.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: sourceKey })),
    s3.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: copyKey })),
    redisCommand(["DEL", rateLimitKey]),
    sql.end({ timeout: 5 }),
  ]);
}

console.log("PASS Diagnostic objects cleaned up");
