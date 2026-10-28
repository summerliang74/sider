# SHSID Online

Implementation of the MVP in [`SHSID-Online-MVP-PRD.md`](./SHSID-Online-MVP-PRD.md).

## Implemented

- Next.js App Router, React, strict TypeScript, ESLint, and Vitest.
- Drizzle/PostgreSQL schema and initial migration for users, sessions, OAuth transactions, resources, reports, and audit logs.
- Server-side Launchpad Authorization Code + PKCE flow with state, nonce, single-use callback transactions, `/oauth/userinfo` identity resolution, org/verification/capability admission, and a one-hour maximum local session.
- Protected resource search, stable keyset pagination, active-only detail responses, current-user endpoint, and immediate local logout revocation.
- Private S3-compatible server-streamed uploads and signed downloads, object HEAD verification, fail-closed malware scanning, author metadata/delete controls, and scheduled orphan/deleted-object cleanup.
- Reports, moderation, report dismissal, user suspension with immediate session revocation, and an administrator audit log.
- Shared Redis-backed IP/user/operation limits, risk-triggered bot verification with action/hostname/freshness/replay checks, strict same-origin mutation checks, structured privacy-safe metrics, and security headers.
- Responsive login, search, upload, detail, “my uploads,” report, and administration pages based on the approved quiet document-tool visual direction.
- Startup-time environment validation plus deployment, storage, scanner, lifecycle, recovery, monitoring, and rotation runbooks.

## Local setup

1. Copy `.env.example` to `.env.local` and replace every placeholder.
2. Create PostgreSQL and run `npm run db:migrate`.
3. Configure private S3-compatible storage, Redis REST, a Turnstile-compatible challenge verifier, and the scanner contract in [`docs/SCANNER-CONTRACT.md`](./docs/SCANNER-CONTRACT.md).
4. Run `npm run dev`.

For a self-hosted production server, copy `.env.production.example` to
`.env.production`, set `AUTH_MODE=local`, replace every placeholder, and run
`docker compose --env-file .env.production up -d --build`. The container applies database migrations before
starting the application and listens only on `127.0.0.1:3000`; terminate HTTPS
at Caddy or nginx and proxy to that address.

Create additional non-admin local accounts from the server without putting the
password in shell history:

```bash
read -rsp "New user password: " NEW_USER_PASSWORD && echo
export NEW_USER_PASSWORD
docker compose --env-file .env.production run --rm -e NEW_USER_PASSWORD app \
  node scripts/create-local-user.mjs --username student --display-name Student
unset NEW_USER_PASSWORD
```

Launchpad must allow the local `APP_BASE_URL` while `SHSID_LAUNCHPAD_OIDC_DEV=1`. Production must use an HTTPS `APP_BASE_URL`, TLS PostgreSQL, and `SHSID_LAUNCHPAD_OIDC_DEV=0`.

The application does not silently substitute local or in-memory services for production dependencies. If storage, rate limiting, challenge verification, or scanning is unavailable, the protected operation fails closed. See [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) before deployment.

Implementation coverage and the remaining production acceptance evidence are tracked in [`docs/MVP-TRACEABILITY.md`](./docs/MVP-TRACEABILITY.md).

Launchpad-specific Variables, Secrets, OAuth registration, domain bridge, and release steps are listed in [`docs/LAUNCHPAD-SETUP.md`](./docs/LAUNCHPAD-SETUP.md).

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run db:check
npm run build
```

After deployment, run `VERIFY_BASE_URL=https://your-domain npm run verify:production` for the non-destructive production smoke checks.
