# Sider — Java / Spring Boot

Sider is a learning-resource hub built with **Java 21, Spring Boot 4.1.2, PostgreSQL and a native HTML/CSS/JavaScript frontend**. The application, including the preloaded administrator Dashboard, lives in `backend/`.

The former Next.js/TypeScript application was removed from `main` on 2026-11-25. It remains available in Git history through commit `a56aa7c`; see [cleanup and recovery notes](docs/LEGACY-CLEANUP.md). The last recorded production verification was release v9 at [siderlearn.com](https://siderlearn.com) on 2026-11-13, from `1ce8c91`. This is a historical record, not a current availability check.

## Project layout

| Path | Purpose |
| --- | --- |
| `backend/src/main/java/` | Java APIs, authentication, uploads, moderation and statistics |
| `backend/src/main/resources/static/` | Native frontend and admin Dashboard |
| `backend/pom.xml`, `backend/Dockerfile` | Application build and container |
| `.launchpad/deploy.json` | Existing Launchpad deployment, Java on port 8080 |
| `db/schema.js`, `drizzle.config.js` | JavaScript database schema tooling |
| `drizzle/` | Unchanged SQL migrations and migration history |
| `services/malware-scanner/` | Independent Node.js scanner |
| `scripts/`, `package.json` | Frontend tests, migration and verification tools |

## Build and run

Install Java 21 and Maven 3.9. No Maven Wrapper is included.

```text
mvn -B -ntp -f backend/pom.xml verify
java -jar backend/target/sider-1.0.0.jar
```

Configure process environment variables from [the Java template](docs/examples/java-production.env.example) before starting the JAR. Spring does not automatically load `.env` files. The root example files use the same Java settings. Never commit populated credentials.

Node.js 20.9–24 is used only for tooling and the independent scanner. Root `npm run build` and `npm start` delegate to the Java commands above.

```text
npm ci
npm test
npm run lint
npm run db:check
npm run scanner:test
```

Full Java database integration tests require an explicitly isolated, migrated PostgreSQL database through `TEST_DATABASE_URL` and matching `TEST_DATABASE_HOST`. Without them, database tests skip; a successful build alone does not prove database integration.

## Database migrations

The SQL files and Drizzle journal in `drizzle/` are preserved unchanged. The schema definition was converted to JavaScript in `db/schema.js` without changing table definitions.

`npm run db:migrate` uses `scripts/migrate.mjs` and the existing Drizzle migration journal. Explicitly inject `DATABASE_URL_UNPOOLED` (preferred) or `DATABASE_URL` for the intended database. Do not pass the SQL history through another migration engine or run it on production without a reviewed migration plan. Schema generation uses `npm run db:generate`; checking migration metadata uses `npm run db:check`. Neither command belongs to application startup.

## Deployment and checks

`node scripts/package-java-launchpad.mjs <release-tag>` creates a local Java source snapshot; it does not publish. The Launchpad plan selects `backend/Dockerfile`, references runtime secrets by name and does not run migrations at startup. UCloud hosts the independent scanner; preserve its OpenClaw installation.

For read-only HTTP smoke checks, explicitly set `VERIFY_BASE_URL` and run `npm run verify:production`. Service diagnostics (`npm run verify:services`) create temporary storage objects and Redis keys and require separate authorization for the target environment.

## Documentation

- [API design](docs/API-DESIGN.md) and [OpenAPI contract](docs/openapi.yaml)
- [Deployment environment](docs/DEPLOYMENT-ENVIRONMENT.md) and [database access](docs/DATABASE-ACCESS.md)
- [Navigation preloading and Dashboard](docs/NAVIGATION-PREFETCH.md)
- [Scanner contract](docs/SCANNER-CONTRACT.md)
- [Legacy cleanup and historical-document scope](docs/LEGACY-CLEANUP.md)

Older PRDs, operations notes and test reports record earlier migration checkpoints. Their removed Next.js paths and npm commands are historical references; use this README and the current Java workflow for active build instructions.
