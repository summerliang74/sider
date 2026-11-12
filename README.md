# SHSID Online

## Java version

The Java implementation is in `backend/`: **Java 21 + Spring Boot 4.1.2, native HTML/CSS/JavaScript, and PostgreSQL**. Local Maven verification has passed; the Java container has not been built or published on Launchpad, and production traffic has not been switched.

- [Implementation and verification status](docs/JAVA-IMPLEMENTATION-STATUS.md), including completed local checks and remaining release gates

- [Java migration PRD](docs/JAVA-MIGRATION-PRD.md)
- [API design](docs/API-DESIGN.md) and [OpenAPI contract](docs/openapi.yaml)
- [Database access design](docs/DATABASE-ACCESS.md)
- [Launchpad deployment environment and configuration](docs/DEPLOYMENT-ENVIRONMENT.md), including Java containers, platform quotas, ports, runtime secrets and the independent UCloud scanner
- [Documentation audit and applicability](docs/DOCUMENTATION-AUDIT.md)

Use Java 21 and Maven 3.9; no Maven Wrapper is included. Explicitly inject the [Java environment settings](docs/examples/java-production.env.example) before starting the JAR—Spring does not automatically load `.env` files. For all PostgreSQL integration tests, provide a separate migrated test database using `TEST_DATABASE_URL` and matching `TEST_DATABASE_HOST`; missing test settings can cause those tests to skip.

```text
mvn -B -ntp -f backend/pom.xml verify
node --test scripts/vanilla-*.test.mjs
java -jar backend/target/sider-1.0.0.jar
```

The root `.launchpad/deploy.json` now selects `backend/Dockerfile` on port 8080 with runtime references and no startup/release migration. `node scripts/package-java-launchpad.mjs <release-tag>` creates a local source snapshot only. The previous Node plan is preserved in [infra/legacy](infra/legacy/launchpad-next.deploy.json); Docker/Compose at the repository root remain legacy files.

The commands and implementation notes below describe the **legacy Next.js version** and remain for reference and rollback planning.

Implementation of the MVP in [`SHSID-Online-MVP-PRD.md`](./SHSID-Online-MVP-PRD.md).

## Implemented

- Next.js App Router, React, strict TypeScript, ESLint, and Vitest.
- Drizzle/PostgreSQL schema and initial migration for users, sessions, OAuth transactions, resources, reports, and audit logs.
- Launchpad SDK Authorization Code + PKCE flow with state and nonce validation, server-side `/oauth/userinfo` identity resolution, and a one-hour maximum Sider session.
- Protected resource search, stable keyset pagination, active-only discovery and ordinary-viewer details; authors/admins can inspect non-deleted processing states. Current-user endpoint and server-side logout revocation.
- Private S3-compatible direct signed PUT uploads, immutable snapshots and durable scan jobs, signed downloads, author metadata/delete controls, and scheduled cleanup. The server-streamed upload route is a legacy compatibility path.
- Reports, moderation, report dismissal, user suspension with immediate session revocation, and an administrator audit log.
- Shared Redis-backed IP/user/operation limits, risk-triggered bot verification with action/hostname/freshness/replay checks, strict same-origin mutation checks, structured privacy-safe metrics, and security headers.
- Responsive login, search, upload, detail, “my uploads,” report, and administration pages based on the approved quiet document-tool visual direction.
- Startup-time environment validation plus deployment, storage, scanner, lifecycle, recovery, monitoring, and rotation runbooks.

## Local setup

1. Copy `.env.example` to `.env.local` and replace every placeholder.
2. Create PostgreSQL and run `npm run db:migrate` with the direct connection explicitly injected. The Drizzle CLI may read `.env`, but does not automatically read Next.js's `.env.local`; copying that file alone is insufficient for migration configuration.
3. Configure private S3-compatible storage, Redis REST, a Turnstile-compatible challenge verifier, and the scanner contract in [`docs/SCANNER-CONTRACT.md`](./docs/SCANNER-CONTRACT.md).
4. Run `npm run dev`.

Sider supports Launchpad authentication only. Local username/password login and
invitation registration are not part of the application. For a self-hosted
development proxy, copy `.env.production.example` to `.env.production`, replace
every placeholder, and ensure the application origin exposes Launchpad's
same-origin `/dashboard-api/` bridge before starting the container.

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
