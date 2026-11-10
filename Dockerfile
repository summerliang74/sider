FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_STANDALONE=1 \
    NODE_ENV=production \
    APP_BASE_URL=https://build.invalid \
    SESSION_SECRET=build-only-session-secret-that-is-never-used \
    SESSION_TOKEN_PEPPER=build-only-session-pepper-that-is-never-used \
    DATABASE_URL=postgresql://build:build@database.invalid/app?sslmode=require \
    SHSID_ADMIN_SUBS=launchpad:admin \
    SHSID_LAUNCHPAD_OIDC_DEV=0 \
    S3_ENDPOINT=https://storage.invalid \
    S3_REGION=local \
    S3_BUCKET=build \
    S3_ACCESS_KEY_ID=build-access-key \
    S3_SECRET_ACCESS_KEY=build-secret-key \
    S3_FORCE_PATH_STYLE=false \
    RATE_LIMIT_URL=https://redis.invalid \
    RATE_LIMIT_TOKEN=build-rate-limit-token \
    BOT_VERIFY_URL=https://bot.invalid \
    BOT_VERIFY_SECRET=build-bot-verify-secret \
    MALWARE_SCAN_URL=disabled \
    MALWARE_SCAN_TOKEN=disabled \
    CRON_SECRET=build-only-cron-secret-that-is-never-used
ARG NEXT_PUBLIC_BOT_SITE_KEY
ENV NEXT_PUBLIC_BOT_SITE_KEY=$NEXT_PUBLIC_BOT_SITE_KEY
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build:strict

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/upload-worker.mjs ./scripts/upload-worker.mjs
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
