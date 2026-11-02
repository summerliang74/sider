# MVP traceability

This matrix tracks the implementation against `SHSID-Online-MVP-PRD.md`. “Implemented” means the repository contains the code path and automated static/unit evidence. “Deployment evidence required” means completion depends on production services or school decisions that cannot be proven from source code alone.

| Requirement group | Repository evidence | Status |
|---|---|---|
| MVP-AUTH-01–04 | `app/api/auth/launchpad/start`, `app/__lp_auth/callback`, `src/lib/auth/*` | Implemented |
| MVP-AUTH-05–10 | protected pages/APIs, hashed sessions, cookie-first session transport, IndexedDB/Service Worker compatibility transport, logout, suspension revocation | Implemented; production session-transport evidence required |
| MVP-SEARCH-01–06, 08 | `src/components/search-hub.tsx`, `src/lib/resources.ts`, stable cursor and collection-filter tests | Implemented |
| MVP-SEARCH-07 | PostgreSQL weighted `tsvector`, `pg_trgm` typo matching, safe structured highlights, file-type filter | Implemented; migration and query verified on an isolated Neon branch |
| MVP-UPLOAD-01–07, 09 | upload intent/complete routes, streaming S3 adapter, HEAD binding, scanner contract, SHA-256, state transitions | Implemented |
| MVP-UPLOAD-08, 10 | cleanup job, documented S3 lifecycle/abort rules, nginx no-buffer upload configuration | Implemented; lifecycle and 50 MB/concurrency deployment evidence required |
| MVP-RESOURCE-01–07 | detail route/page, viewer authorization, signed download, metadata update, soft delete; online preview route and browser renderer removed | Implemented |
| MVP-MOD-01–06 | report route/constraint, admin queue/actions, transactional audit for metadata update/delete/moderation/report dismissal/user suspension, suspension and session revocation | Implemented |
| MVP-SEC-01, 03 | trusted client-IP header contract, security headers, WAF/origin-isolation runbook | Deployment evidence required |
| MVP-SEC-02, 04 | Redis REST atomic counters, pre-auth proxy limits, user/operation limits, 429 responses | Implemented; multi-instance load evidence required |
| MVP-SEC-05–07 | risk thresholds and Turnstile-compatible challenge binding/replay checks | Implemented; accessibility/provider-failure exercise required |
| MVP-SEC-08 | configurable OAuth thresholds/emergency multiplier and structured metrics | Implemented; alert dashboard evidence required |
| MVP-ENV-01–08 | validated environment contract, TLS enforcement, external adapters and operations runbook | Implemented; provider/network/rotation evidence required |
| Pages and routes | login, resources, Peer Advisor tag view, upload, detail, my uploads, reports, audit, auth error, privacy, terms | Implemented |
| TypeScript requirements | strict TypeScript, Zod boundary validation, Drizzle types, CI commands | Implemented |
| Data model | six generated Drizzle migrations covering the MVP entities, search, cleanup state, and removal of retired local-auth tables | Implemented; the unused `oauth_login_transactions` table remains for cleanup-only compatibility and must be dropped before beta |
| Reliability | idempotent completion, fail-closed scanning, health/readiness, cleanup and recovery runbook | Implemented; backup/restore exercise required |
| Accessibility/compatibility | labels, keyboard-native controls, focus styles, reduced motion, mobile layout | Implemented; browser/WCAG manual audit required |

## Release evidence still required

The following are the PRD's M0/M4 gates and cannot be honestly marked complete by repository code:

1. Confirm administrator subject IDs and keep the Launchpad-only-for-SHSID-students boundary documented; restore an additional admission gate before Launchpad admits any external audience.
2. Supply the UCloud production HTTPS domain and verify the Launchpad bridge, callback, site session transport, DNS, TLS, trusted proxy chain, and egress behavior there.
3. Provision PostgreSQL, private S3, Redis REST, challenge verification, malware scanning, edge WAF/DDoS, monitoring, and backups.
4. Apply all committed migrations, remove the retired `oauth_login_transactions` table in a reviewed follow-up migration, and complete an end-to-end upload/scan/search/download test against those services.
5. Run shared-school-IP OAuth load testing, abuse tests, S3 CORS/IAM tests, credential rotation, backup restoration, rollback, browser/mobile, and accessibility acceptance.
6. Approve the privacy notice, acceptable-use rules, retention window, appeal/contact process, data region, and named operational owners.

Student beta remains gated until these items have recorded evidence.
