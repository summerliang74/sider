# Launchpad setup for SHSID Online

This checklist is derived from the Launchpad Manual pages “Sign in with Launchpad,” “Deploy configuration,” “Domains,” and “Data & storage (for apps).” The repository now contains `.launchpad/deploy.json`, so Launchpad can resolve the build, migration, start command, health path, rollback policy, and environment references.

## What the Manual confirms

- Deployed apps self-register as public PKCE clients through `POST /oauth/bootstrap`; there is no OAuth client secret to create or store.
- The production bootstrap body is empty. `devOrigin` is only for local development while `SHSID_LAUNCHPAD_OIDC_DEV` is enabled.
- Authorization codes are single-use and last about 60 seconds. Access and ID tokens last about one hour.
- Identity must come from `/oauth/userinfo`, which returns `sub`, `email`, `name`, `picture`, `org`, `verified`, and `allows`. Rows must be keyed by `sub`, not email.
- HS256 tokens cannot be verified locally because `/oauth/jwks` is intentionally empty; call `/oauth/userinfo` instead.
- Default app hostnames receive the same-origin `/dashboard-api` bridge automatically. A custom-domain nginx vhost must proxy `/dashboard-api/` to the host-server on port 5180; re-provision an older binding if the bridge returns 404.
- Launchpad owns `/__lp_auth/callback` and its SDK keeps PKCE state in `sessionStorage`. Start sign-in with the SDK; after `LaunchpadAuth.ready()` returns a user, send the SDK access token to Sider's same-origin session endpoint. The server validates it through `/oauth/userinfo` and creates the Sider session. The legacy Launchpad proxy currently does not persist application `Set-Cookie` headers, so the JSON response also returns the opaque, one-hour Sider token and its expiry. The login client stores that Sider token in IndexedDB, a same-origin Service Worker injects it as `x-sider-session` on protected requests, `/api/me` verifies the resulting session, and the Launchpad SDK token is then cleared. Never store the Sider token in `localStorage`, `sessionStorage`, a URL, or logs. Remove this compatibility transport and return to an `HttpOnly` cookie when the deployment worker preserves application cookies. A separate server-generated PKCE state at the reserved callback path will fail with `state mismatch`.
- `.launchpad/deploy.json` contains configuration and environment references, never plaintext credentials. Runtime references are available to `releaseCommand` and the running release.
- Launchpad does not provide managed PostgreSQL, Redis, or object storage. Apps connect to those services using their own network endpoints and credentials.

Launchpad is restricted to SHSID students, so Sider treats a valid Launchpad identity as the student-membership boundary. Sider records `org`, `verified`, and `allows` for diagnostics but does not repeat those checks at login. Administrator subjects still come from the SHSID/Launchpad administrator or a controlled `/oauth/userinfo` discovery flow.

## Create Launchpad Variables

The current Runway project stores all existing runtime values as encrypted uppercase secrets. The committed deploy file references them as `secret://KEY`; discovery uses the existing `secret://LAUNCHPAD_ORG_DISCOVERY_EMAIL` alias and the upload limit uses the validated 50 MiB default when unset. Secret values are never written to the source snapshot or logs. For a new project, create the following names with the same build/runtime scopes before deploying:

```text
APP_BASE_URL
SESSION_TTL_SECONDS
DATABASE_MAX_CONNECTIONS
SHSID_LAUNCHPAD_ORG_DISCOVERY_EMAIL
SHSID_LAUNCHPAD_OIDC_DEV
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_FORCE_PATH_STYLE
UPLOAD_MAX_BYTES
RATE_LIMIT_URL
RATE_LIMIT_MULTIPLIER
OAUTH_START_IP_LIMIT
OAUTH_CALLBACK_IP_LIMIT
TRUSTED_CLIENT_IP_HEADER
NEXT_PUBLIC_BOT_SITE_KEY
BOT_VERIFY_URL
MALWARE_SCAN_URL
MALWARE_SCAN_TIMEOUT_MS
RESOURCE_DELETE_RETENTION_DAYS
```

Production values must include `SHSID_LAUNCHPAD_OIDC_DEV=0`, an HTTPS `APP_BASE_URL`, and TLS endpoints. `NEXT_PUBLIC_BOT_SITE_KEY` is deliberately referenced at both build and runtime because Next.js inlines public variables during the build.

The `build` and `build:launchpad` scripts normalize `NODE_ENV=production`, disable telemetry, skip Next.js's duplicate TypeScript check, disable the throwaway Turbopack filesystem cache, and disable startup route preloading for the constrained runner. GitHub CI remains the release gate and runs `typecheck`, lint, tests, schema validation, and `build:strict`. Do not declare `LAUNCHPAD_FAST_BUILD` in the deploy environment: that name is reserved by Launchpad.

For initial domain and Launchpad sign-in verification before the malware scanner is available, set both `MALWARE_SCAN_URL=disabled` and `secret://project/malware-scan-token=disabled`. This mode fails closed: upload-intent and completion endpoints return `503`, and the upload page explains that uploads are unavailable. Configure the real HTTPS scanner endpoint and token before enabling uploads or starting the student beta.

### One-time administrator subject discovery

When the exact administrator subject is not known yet:

1. Set `secret://project/shsid-admin-subs=__discovery__` until the real administrator subject is known.
2. Set `SHSID_LAUNCHPAD_ORG_DISCOVERY_EMAIL` to one exact verified test-account email.
3. Deploy and sign in with that account. The callback redirects to `/auth/discovery`, which displays the exact `org` and `sub` for five minutes.
4. Put the displayed subject in `secret://project/shsid-admin-subs` if this account should be an administrator.
5. Set `SHSID_LAUNCHPAD_ORG_DISCOVERY_EMAIL=disabled` and redeploy.

Discovery does not create a user, persist the profile, or issue an application session. The temporary discovery route remains limited to the configured verified email; ordinary login does not require Launchpad's optional `verified` flag.

## Create Launchpad Secrets

Legacy installations may still use these older project-scoped secret aliases. Do not create duplicate aliases for the current project; its reviewed uppercase `secret://KEY` references are authoritative:

```text
secret://project/session-secret
secret://project/session-token-pepper
secret://project/database-url
secret://project/database-url-unpooled
secret://project/shsid-admin-subs
secret://project/s3-access-key-id
secret://project/s3-secret-access-key
secret://project/rate-limit-token
secret://project/bot-verify-secret
secret://project/malware-scan-token
secret://project/cron-secret
```

Generate independent random values for the session secret, token pepper, and cron secret. `shsid-admin-subs` is a comma-separated allow-list of exact Launchpad `sub` values.

## OAuth and domain verification

1. Deploy or bind the intended hostname first; bootstrap refuses an origin that is not a known deployed site or bound domain.
2. Run `lp oidc <project-id> --enable` to register before release if desired.
3. Run `lp oidc <project-id>` and record its deployed/integrated/registered status, client ID, and callback URL.
4. Confirm the callback is exactly `https://<production-origin>/__lp_auth/callback`.
5. From the deployed origin, verify `POST /dashboard-api/oauth/bootstrap` succeeds. Do not send `devOrigin` in production.
6. If a custom domain returns `/dashboard-api/*` 404, re-provision the domain or add the documented nginx bridge to `http://127.0.0.1:5180/`.

Start with the default Launchpad app hostname when possible; it removes the custom-domain bridge variable from the first authentication test. Bind the final custom hostname after the default-host flow succeeds.

## Deployment behavior

The committed deploy file performs:

1. `npm ci --no-audit --no-fund --prefer-offline`
2. `npm run build:launchpad`
3. `npm run db:migrate` as the one-per-deployment release command
4. `npm start`
5. readiness probing at `/api/health`

Automatic rollback observes the release for five minutes. Database migrations are not automatically undone by a failed release, so every migration still needs a reviewed forward-fix or rollback procedure.

Source deployments run `npm start`, which supervises both Next.js and the upload worker. Generate the snapshot with `node scripts/package-launchpad.mjs <tag>`; it excludes the root Dockerfile and Compose file, which are intended for self-hosting and otherwise trigger the legacy Compose detector. The current CLI excludes `package-lock.json`; the packager converts the committed lock into npm's native `npm-shrinkwrap.json` in the snapshot and checks that its dependency tree is identical. The deployment pins npm 11.18.0 and keeps `npm ci` for deterministic installs. Publish the returned staging path to the existing project ID.

A proxy 504 is not a terminal build result: use the Runway build/deployment view to follow the accepted operation before retrying. The 2026-11-10 release passed readiness and the production browser upload/automatic-scan/search/download check, with build `01M72TNAP3EX4FK590FMQ2ZE4A` and live deployment `01M72TVMA5FG2AHXP0QXNNTDPE`.

For standalone archives, include `scripts/launchpad-bootstrap.mjs` as `bootstrap.mjs`, and `scripts/upload-worker.mjs` as `upload-worker.mjs`. Its bootstrap supervises both processes as well. Apply migration 0006 before this release. This additive migration can remain when rolling back to the previous application; do not delete queued jobs during an application rollback.
