import "server-only";

import { z } from "zod";

const placeholderPattern = /^(replace|change-me|changeme|example|todo)/i;

const secret = z
  .string()
  .min(32, "must contain at least 32 characters")
  .refine((value) => !placeholderPattern.test(value), "must not be a placeholder");

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    AUTH_MODE: z.enum(["launchpad", "local", "hybrid"]).default("launchpad"),
    LOCAL_AUTH_USERNAME: z.string().trim().min(3).max(64).default("admin"),
    LOCAL_AUTH_PASSWORD: secret.optional(),
    LOCAL_AUTH_DISPLAY_NAME: z.string().trim().min(1).max(120).default("Administrator"),
    APP_BASE_URL: z.url(),
    SESSION_SECRET: secret,
    SESSION_TOKEN_PEPPER: secret,
    SESSION_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(3600),
    DATABASE_URL: z.string().min(1),
    DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(20).default(5),
    SHSID_ALLOWED_ORGS: z.string().min(1),
    SHSID_ADMIN_SUBS: z.string().min(1),
    SHSID_REQUIRED_CAPABILITY: z.string().optional(),
    SHSID_LAUNCHPAD_ORG_DISCOVERY_EMAIL: z.union([z.email(), z.literal("disabled")]).default("disabled"),
    SHSID_LAUNCHPAD_OIDC_DEV: z.enum(["0", "1"]),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(500 * 1024 * 1024).default(50 * 1024 * 1024),
    RATE_LIMIT_URL: z.url(),
    RATE_LIMIT_TOKEN: z.string().min(16),
    RATE_LIMIT_MULTIPLIER: z.coerce.number().positive().max(10).default(1),
    OAUTH_START_IP_LIMIT: z.coerce.number().int().min(1).default(300),
    OAUTH_CALLBACK_IP_LIMIT: z.coerce.number().int().min(1).default(600),
    TRUSTED_CLIENT_IP_HEADER: z.string().regex(/^[a-z0-9-]+$/).default("x-real-ip"),
    NEXT_PUBLIC_BOT_SITE_KEY: z.string().min(1),
    BOT_VERIFY_URL: z.url(),
    BOT_VERIFY_SECRET: z.string().min(16),
    MALWARE_SCAN_URL: z.union([z.url(), z.literal("disabled")]),
    MALWARE_SCAN_TOKEN: z.union([z.string().min(16), z.literal("disabled")]),
    MALWARE_SCAN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    CRON_SECRET: z.string().min(32),
    RESOURCE_DELETE_RETENTION_DAYS: z.coerce.number().int().min(0).max(90).default(7),
  })
  .superRefine((env, context) => {
    const appUrl = new URL(env.APP_BASE_URL);
    const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname);
    const scannerUrlDisabled = env.MALWARE_SCAN_URL === "disabled";
    const scannerTokenDisabled = env.MALWARE_SCAN_TOKEN === "disabled";
    if (env.AUTH_MODE !== "launchpad" && !env.LOCAL_AUTH_PASSWORD) {
      context.addIssue({
        code: "custom",
        path: ["LOCAL_AUTH_PASSWORD"],
        message: "is required when local authentication is enabled",
      });
    }
    if (scannerUrlDisabled !== scannerTokenDisabled) {
      context.addIssue({
        code: "custom",
        path: [scannerUrlDisabled ? "MALWARE_SCAN_TOKEN" : "MALWARE_SCAN_URL"],
        message: "must also be disabled when the other malware scanner setting is disabled",
      });
    }
    if (appUrl.pathname !== "/" || appUrl.search || appUrl.hash || appUrl.username || appUrl.password) {
      context.addIssue({ code: "custom", path: ["APP_BASE_URL"], message: "must be an origin without a path, query, fragment, or credentials" });
    }

    if (env.NODE_ENV === "production") {
      if (appUrl.protocol !== "https:") {
        context.addIssue({
          code: "custom",
          path: ["APP_BASE_URL"],
          message: "must use HTTPS in production",
        });
      }
      if (env.SHSID_LAUNCHPAD_OIDC_DEV !== "0") {
        context.addIssue({
          code: "custom",
          path: ["SHSID_LAUNCHPAD_OIDC_DEV"],
          message: "must be 0 in production",
        });
      }
      if (!/sslmode=(require|verify-ca|verify-full)/i.test(env.DATABASE_URL)) {
        context.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "must require TLS in production",
        });
      }
      const productionValues: Array<[keyof typeof env, string]> = [
        ["APP_BASE_URL", env.APP_BASE_URL],
        ["DATABASE_URL", env.DATABASE_URL],
        ["SHSID_ALLOWED_ORGS", env.SHSID_ALLOWED_ORGS],
        ["SHSID_ADMIN_SUBS", env.SHSID_ADMIN_SUBS],
        ["S3_ENDPOINT", env.S3_ENDPOINT],
        ["S3_BUCKET", env.S3_BUCKET],
        ["S3_ACCESS_KEY_ID", env.S3_ACCESS_KEY_ID],
        ["S3_SECRET_ACCESS_KEY", env.S3_SECRET_ACCESS_KEY],
        ["RATE_LIMIT_URL", env.RATE_LIMIT_URL],
        ["RATE_LIMIT_TOKEN", env.RATE_LIMIT_TOKEN],
        ["NEXT_PUBLIC_BOT_SITE_KEY", env.NEXT_PUBLIC_BOT_SITE_KEY],
        ["BOT_VERIFY_URL", env.BOT_VERIFY_URL],
        ["BOT_VERIFY_SECRET", env.BOT_VERIFY_SECRET],
        ["CRON_SECRET", env.CRON_SECRET],
      ];
      if (env.AUTH_MODE !== "launchpad" && env.LOCAL_AUTH_PASSWORD) {
        productionValues.push(["LOCAL_AUTH_PASSWORD", env.LOCAL_AUTH_PASSWORD]);
      }
      if (!scannerUrlDisabled && !scannerTokenDisabled) {
        productionValues.push(["MALWARE_SCAN_URL", env.MALWARE_SCAN_URL]);
        productionValues.push(["MALWARE_SCAN_TOKEN", env.MALWARE_SCAN_TOKEN]);
      }
      for (const [path, value] of productionValues) {
        if (/replace|change-me|\.example/i.test(value)) {
          context.addIssue({ code: "custom", path: [path], message: "must not be a placeholder in production" });
        }
      }
      for (const key of ["S3_ENDPOINT", "RATE_LIMIT_URL", "BOT_VERIFY_URL"] as const) {
        if (new URL(env[key]).protocol !== "https:") {
          context.addIssue({ code: "custom", path: [key], message: "must use HTTPS in production" });
        }
      }
      if (!scannerUrlDisabled && new URL(env.MALWARE_SCAN_URL).protocol !== "https:") {
        context.addIssue({ code: "custom", path: ["MALWARE_SCAN_URL"], message: "must use HTTPS in production" });
      }
    } else if (appUrl.protocol !== "https:" && !(appUrl.protocol === "http:" && isLocalhost)) {
      context.addIssue({
        code: "custom",
        path: ["APP_BASE_URL"],
        message: "must use HTTPS unless running on localhost",
      });
    }
  })
  .transform((env) => ({
    ...env,
    allowedOrgs: env.SHSID_ALLOWED_ORGS.split(",")
      .map((org) => org.trim())
      .filter(Boolean),
    adminSubs: env.SHSID_ADMIN_SUBS.split(",")
      .map((sub) => sub.trim())
      .filter(Boolean),
    requiredCapability: env.SHSID_REQUIRED_CAPABILITY?.trim() || null,
    launchpadOidcDev: env.SHSID_LAUNCHPAD_OIDC_DEV,
    orgDiscoveryEmail: env.SHSID_LAUNCHPAD_ORG_DISCOVERY_EMAIL === "disabled"
      ? null
      : env.SHSID_LAUNCHPAD_ORG_DISCOVERY_EMAIL.toLowerCase(),
    s3ForcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    malwareScanEnabled: env.MALWARE_SCAN_URL !== "disabled",
    localAuthSub: `local:${env.LOCAL_AUTH_USERNAME.toLowerCase()}`,
  }));

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) return cachedEnv;

  // Prefer provider-neutral S3 names so a dedicated object store can override
  // Neon-managed AWS variables that may still exist in a local environment.
  const hasExplicitS3Config = Boolean(process.env.S3_ENDPOINT);
  const resolvedEnv = {
    ...process.env,
    SHSID_LAUNCHPAD_ORG_DISCOVERY_EMAIL:
      process.env.SHSID_LAUNCHPAD_ORG_DISCOVERY_EMAIL ?? process.env.LAUNCHPAD_ORG_DISCOVERY_EMAIL,
    SHSID_LAUNCHPAD_OIDC_DEV:
      process.env.SHSID_LAUNCHPAD_OIDC_DEV ?? process.env.LAUNCHPAD_OIDC_DEV,
    S3_ENDPOINT: hasExplicitS3Config ? process.env.S3_ENDPOINT : process.env.AWS_ENDPOINT_URL_S3,
    S3_REGION: hasExplicitS3Config ? process.env.S3_REGION : process.env.AWS_REGION,
    S3_ACCESS_KEY_ID: hasExplicitS3Config ? process.env.S3_ACCESS_KEY_ID : process.env.AWS_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: hasExplicitS3Config
      ? process.env.S3_SECRET_ACCESS_KEY
      : process.env.AWS_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? (hasExplicitS3Config ? "false" : "true"),
  };
  const result = serverEnvSchema.safeParse(resolvedEnv);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  if (result.data.allowedOrgs.length === 0) {
    throw new Error("Invalid server configuration: SHSID_ALLOWED_ORGS contains no values");
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function resetEnvForTests(): void {
  cachedEnv = undefined;
}
