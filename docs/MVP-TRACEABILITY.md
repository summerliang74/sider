# MVP traceability

This matrix tracks the implementation against `SHSID-Online-MVP-PRD.md`. “Implemented” means the repository contains the code path and automated static/unit evidence. “Deployment evidence required” means completion depends on production services or school decisions that cannot be proven from source code alone.

Upload changes were reconciled on 2026-11-10 against MVP PRD v0.6 and full PRD v0.7. See [upload acceptance evidence](./UPLOAD-PERFORMANCE-ACCEPTANCE.md) for executed checks and remaining gates. The matrix is not a claim that production acceptance is complete.

| Requirement group | Repository evidence | Status |
|---|---|---|
| MVP-AUTH-01–04 | `app/api/auth/launchpad/start`, `app/__lp_auth/callback`, `src/lib/auth/*` | Implemented |
| MVP-AUTH-05–10 | protected pages/APIs, hashed sessions, cookie-first session transport, IndexedDB/Service Worker compatibility transport, logout, suspension revocation | Implemented; production session-transport evidence required |
| MVP-SEARCH-01–06, 08 | `src/components/search-hub.tsx`, `src/lib/resources.ts`, stable cursor and collection-filter tests | Implemented |
| MVP-SEARCH-07 | PostgreSQL weighted `tsvector`, `pg_trgm` typo matching, safe structured highlights, file-type filter | Implemented; migration and query verified on an isolated Neon branch |
| MVP-UPLOAD-01–07 | five-file queue with two transfers, signed private PUT, ETag-conditional snapshot, atomic completion/job insertion, leased worker, three-attempt retry, fail-closed publication | Unit, isolated PostgreSQL, browser and production direct-upload/automatic-scan/search/download chain checks passed |
| MVP-UPLOAD-08 | cleanup protects live jobs and removes unused copies; pending lifecycle and multipart-abort templates | Database integration check passed; provider lifecycle configuration still needs evidence |
| MVP-UPLOAD-09 | clean scan requires and stores SHA-256 | Hash persistence implemented; duplicate-file prompt is not implemented |
| MVP-UPLOAD-10 | real OSS signature/size/type/snapshot/private-read checks and synthetic 50 MiB upload; browser queue test verifies concurrency | Live storage 4/4, isolated browser batch and production browser single-file flow passed after exact-origin CORS configuration; school-network load acceptance pending |
| MVP-RESOURCE-01–07 | detail route/page, viewer authorization, signed download, metadata update, soft delete; online preview route and browser renderer removed | Implemented |
| MVP-MOD-01–06 | report route/constraint, admin queue/actions, transactional audit for metadata update/delete/moderation/report dismissal/user suspension, suspension and session revocation | Implemented |
| MVP-SEC-01, 03 | trusted client-IP header contract, security headers, WAF/origin-isolation runbook | Deployment evidence required |
| MVP-SEC-02, 04 | Redis REST atomic counters, pre-auth proxy limits, user/operation limits, 429 responses | Implemented; multi-instance load evidence required |
| MVP-SEC-05–07 | risk thresholds and Turnstile-compatible challenge binding/replay checks | Implemented; accessibility/provider-failure exercise required |
| MVP-SEC-08 | configurable OAuth thresholds/emergency multiplier and structured metrics | Implemented; alert dashboard evidence required |
| MVP-ENV-01–08 | validated environment contract, TLS enforcement, external adapters and operations runbook | Implemented; provider/network/rotation evidence required |
| Pages and routes | login, resources, Peer Advisor tag view, upload, detail, my uploads, reports, audit, auth error, privacy, terms | Implemented |
| TypeScript requirements | strict TypeScript, Zod boundary validation, Drizzle types, CI commands | Implemented |
| Data model | seven generated Drizzle migrations (0000–0006), including the durable `upload_scan_jobs` table | Migration 0006 passed on a schema-only branch and was applied to production on 2026-11-10. The unused `oauth_login_transactions` table remains for cleanup-only compatibility and must be dropped before beta |
| Reliability | idempotent completion, immutable scanned content, global scan lease, stale-worker fencing, retry exhaustion, cancellation and suspension checks, restart recovery, cleanup | Isolated database checks and supervised production worker passed; process-kill recovery and backup/restore exercise required |
| Accessibility/compatibility | labels, keyboard-native controls, focus styles, reduced motion, mobile layout | Implemented; browser/WCAG manual audit required |

## Release evidence still required

The following are the PRD's M0/M4 gates and cannot be honestly marked complete by repository code:

1. Confirm administrator subject IDs and keep the Launchpad-only-for-SHSID-students boundary documented; restore an additional admission gate before Launchpad admits any external audience.
2. Verify the Launchpad-hosted production domain `https://siderlearn.com`, bridge, callback, site session transport, DNS, TLS, trusted proxy chain, and egress behavior. UCloud currently hosts the scanner; the root Compose file is a separate application-hosting option.
3. Record deployment evidence for the configured PostgreSQL, private OSS, Redis REST, challenge verifier, UCloud scanner, edge WAF/DDoS, monitoring, and backups. Existing credentials alone do not prove each gate passed.
4. Migration 0006, supervised worker, exact-origin OSS CORS and the production synthetic browser upload/scan/search/download check passed on 2026-11-10. Keep full load and recovery exercises open; separately remove the retired `oauth_login_transactions` table in a reviewed follow-up migration before beta.
5. Run shared-school-IP OAuth load testing, abuse tests, S3 CORS/IAM tests, credential rotation, backup restoration, rollback, browser/mobile, and accessibility acceptance.
6. Approve the privacy notice, acceptable-use rules, retention window, appeal/contact process, data region, and named operational owners.

Student beta remains gated until these items have recorded evidence.
