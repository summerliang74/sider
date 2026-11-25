# Legacy application cleanup — 2026-11-25

`main` now contains the Java application and native frontend. The old Next.js application in `app/` and `src/`, duplicate `public/` assets, prototype, root Next.js configuration, legacy Docker/Compose files, deployment scripts and Next.js CI were removed. React, Next.js, TypeScript and their application-specific npm dependencies are no longer direct root dependencies. Actual current source files determine GitHub language statistics; no language is relabeled.

The former database definition `src/db/schema.ts` is now `db/schema.js`; `drizzle.config.js` points to it. Only TypeScript type annotations were removed. Existing migration SQL and `drizzle/meta/` were not modified. Root example environment files now describe Java. The live application and private local environment files were not changed by this cleanup.

## Verification and historical scope

The current build entry points are `backend/pom.xml` and `backend/Dockerfile`; `.launchpad/deploy.json` still selects `backend/`. Root npm scripts run Java builds or support tasks. CI runs the Java suite against isolated PostgreSQL, native frontend/cache tests, lint, migration metadata checks and scanner tests.

Older PRDs, migration status documents, operations notes and files under `test-results/` are dated records. References in them to `app/`, `src/`, `drizzle.config.ts`, Next.js build scripts or root Docker/Compose describe the pre-cleanup tree. They are not current run instructions. See the root README for the supported commands.

Local cleanup verification: 32 native frontend/cache/session tests and 3 scanner tests passed, lint passed, migration metadata checks passed, and the converted JavaScript schema produced exactly the same Drizzle database definition as the previous TypeScript schema. Maven verification and production JAR packaging passed: 45 Java tests passed and 25 database integration tests skipped because no isolated PostgreSQL test service was configured. Existing migration SQL and journal have no Git changes. No production deployment or live service diagnostics were performed.

## Recovery

The complete pre-cleanup application can be inspected at commit `a56aa7c`. To review it without changing `main`, create a separate worktree with `git worktree add ../sider-legacy a56aa7c`. This restores source only; it does not deploy, recover credentials or roll back a database. For production rollback use a verified retained deployment and its environment configuration.
