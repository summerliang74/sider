# MVP deployment and operations

> Scope: legacy Next.js/Launchpad commands. The Launchpad-app/UCloud-scanner separation remains the selected topology for Java. For target container/port/quotas/secrets use [deployment environment](DEPLOYMENT-ENVIRONMENT.md) and [migration PRD](JAVA-MIGRATION-PRD.md). The root Dockerfile, Compose and Node commands below do not deploy Java; UCloud capacity is only the scanner budget, and OpenClaw must be preserved.

This file turns the PRD's external-service requirements into an operator checklist. It does not contain credentials.

For Launchpad OAuth/domain registration and bridge requirements, follow [LAUNCHPAD-SETUP.md](./LAUNCHPAD-SETUP.md). The Next.js application, custom domain, and application secrets are managed in the Launchpad project. UCloud is used only for the isolated malware scanner.

## Required topology

Internet traffic reaches the Launchpad-hosted application through its managed HTTPS custom domain and edge. The trusted edge must overwrite the header named by `TRUSTED_CLIENT_IP_HEADER`; client-supplied forwarding headers must be discarded.

Launchpad runs the Next.js compute process, HTTPS custom domain, and OAuth bridge. The UCloud host runs only the isolated `sider-scanner` Compose project. PostgreSQL, private S3-compatible storage, Redis REST, and the bot verifier remain external and must survive application deployment and rollback independently. Never modify `/root/.openclaw` as part of Sider operations.

## PostgreSQL

- Create a least-privilege application role and require TLS (`sslmode=require`, `verify-ca`, or `verify-full`).
- Set `DATABASE_MAX_CONNECTIONS × maximum Launchpad application instances` below the provider connection quota.
- Run `npm run db:migrate` as a controlled release step before activating the new application version.
- Enable encrypted automated backups. Before beta, restore a backup into an isolated database and record the recovery time and result.

## Object storage

The bucket is private. Block public ACLs and policies. The application credential needs scoped `PutObject`, `GetObject`, `DeleteObject` and restricted `ListBucket` for the readiness listing. HEAD is authorized through object-read permission; do not invent a separate AWS IAM `s3:HeadObject` action. Conditional copy needs source read and target write. The scanner gets a separate read-only credential. Adapt exact IAM syntax to the storage provider and reviewed templates.

Start from the reviewed templates in `infra/s3-cors.example.json`, `infra/s3-lifecycle.example.json`, `infra/s3-app-policy.example.json`, and `infra/s3-scanner-policy.example.json`; replace every placeholder and adapt only provider-specific syntax.

CORS must allow only the production application origin, methods `PUT`, `GET`, and `HEAD`, and headers `content-type` and `x-amz-meta-resource`. Expose only headers the upload client requires.

Files are uploaded directly under `pending/` with a 300-second signed PUT bound to one key, length, type and resource metadata. Complete creates a separate server-only `pending/<id>/snapshot-*` copy with an ETag precondition and queues it transactionally. A successful scan copies that snapshot to `active/`; rejected snapshots remain private and non-downloadable until pending retention removes them. Existing legacy `quarantine/` objects remain supported. Configure lifecycle rules to:

- the legacy template expires all `pending/` objects after two days, including immutable snapshots; this is **not safe by itself for live queued/processing jobs** because bucket lifecycle does not inspect PostgreSQL. Do not apply it unchanged to the Java target; first validate a cleanable tag/prefix or retention strategy that excludes live inputs, and use database-aware cleanup meanwhile;
- abort incomplete multipart uploads after one day;
- never make an object public.

Schedule `POST /api/internal/jobs/cleanup` every 15 minutes with `Authorization: Bearer <CRON_SECRET>`. The job marks stale pending rows failed and removes objects whose soft-delete recovery window has elapsed.

Apply migration `0006_upload_scan_queue` before starting this version. Run the root Compose `upload-worker` service, or supervise `npm run worker:uploads` with `UPLOAD_WORKER_BASE_URL` pointing at the local app. The Launchpad standalone package uses `scripts/launchpad-bootstrap.mjs` as its `bootstrap.mjs` and includes `scripts/upload-worker.mjs` alongside it: the bootstrap supervises both app and worker, exits on unexpected child termination, and lets the managed container restart both. It polls every five seconds while idle and processes one task per HTTP request. Do not run it through an HTTP proxy with a timeout shorter than 180 seconds. Multiple workers are safe: database leases allow one active scanner job globally; an expired worker cannot commit. Queue/lease state survives app restarts. No request-scoped `after()` or fire-and-forget promise is used as the queue.

Transient scan/dependency failures retry at 30 and 60 seconds; three failed attempts quarantine. A crash consumes an attempt, and a job found with three exhausted attempts is quarantined without another scan. Alert on the oldest queued task, scanner failure metrics, worker 503s, and absence of worker requests. A pending snapshot lifecycle of two days requires workers to recover well before that deadline.

Cleanup skips resources with queued/processing jobs. For terminal jobs older than 15 minutes it removes ingress/snapshot/output duplicates while preserving the resource's current object key. It rechecks resource state under a database lock before deleting stale resources. Keep the lifecycle rule as a backstop for a crash before snapshot registration; it also handles an ingress recreated with an unexpired URL.

Direct upload deployment gate: configure OSS CORS for the exact production origin, `PUT/GET/HEAD`, and `content-type,x-amz-meta-resource`. Do not wildcard the origin. `infra/s3-cors.example.json` is the provider-neutral template. The application identity intentionally lacks bucket-administration privileges; use the bucket operator's console to configure CORS. Confirm both allowed and denied browser preflights before rollout.

Verification: `TEST_LIVE_STORAGE=1` with the production application origin runs `src/lib/storage-live.integration.test.ts`. It uses only unique synthetic pending keys, checks signed size/type, conditional-copy isolation, private reads and a 50 MiB upload, and removes its objects afterward. Database integration tests require an explicit `TEST_DATABASE_URL` plus matching `TEST_DATABASE_HOST` for an empty schema-only test branch; they never fall back to the application database. See `UPLOAD-PERFORMANCE-ACCEPTANCE.md` for this change's evidence and remaining gates.

## Redis REST and rate limits

`RATE_LIMIT_URL` must accept Redis commands as JSON arrays and return `{ "result": ... }`, compatible with the Upstash Redis REST command endpoint. TLS is mandatory. The token must be restricted to the MVP database/namespace. The application uses atomic `EVAL` for counters and `SET ... NX EX` for challenge replay prevention; an unavailable store fails closed.

Load-test OAuth separately using the expected number of students sharing the school egress IP. The committed OAuth IP thresholds are deliberately broad starting values and must be adjusted from the recorded test without introducing a per-user password-failure rule.

## Bot challenge

The browser widget uses the configured public site key. The verifier must return Cloudflare Turnstile-compatible fields: `success`, `hostname`, `action`, and `challenge_ts`. The server validates all four and stores a token digest in Redis to reject replay. Provide the provider's documented keyboard/audio or non-visual alternative before beta.

## Malware scanning

Deploy the service described in [SCANNER-CONTRACT.md](./SCANNER-CONTRACT.md). Grant it read-only access to the private bucket. Alert on scanner timeouts/errors and quarantine growth. Do not retry an infected file automatically.

## WAF and monitoring

Alert on request rate, WAF blocks, application `429` events, challenge triggered/passed/failed counts, scanner outcomes, PostgreSQL saturation, and external-service latency/errors. Application metrics are emitted as single-line JSON without raw IPs, queries, filenames, emails, tokens, cookies, or signed URLs.

Run an abuse exercise covering forged forwarding headers, invalid/replayed SDK sessions, repeated access-token exchange, upload bursts, forged completion, malicious/MIME-mismatched files, download bursts, duplicate reports, and non-admin moderation calls.

## Secrets and rotation

Store application production values in Launchpad environment variables and scanner-only values in the root-readable UCloud scanner environment or container secret store, always outside the repository and image. Only `NEXT_PUBLIC_BOT_SITE_KEY` is public. Give every credential an owner and expiry/rotation date. Rotation is complete only after the new credential works and the old credential is proven unable to access the service.

`SHSID_ADMIN_SUBS` is the comma-separated, reviewed allow-list of exact Launchpad subject identifiers for administrators. Changes are enforced on the next authenticated request or successful sign-in. Removing a subject demotes it and revokes its current sessions when it next reaches the application.

## Release gate

Do not open student beta until every M0 item in the MVP PRD has an owner and recorded evidence, production `SHSID_LAUNCHPAD_OIDC_DEV=0`, the migration and rollback paths have been rehearsed, S3 CORS rejects an unapproved origin, the database restore test succeeds, and an external credential rotation has been demonstrated.

After deploying this legacy version, run the non-destructive public verification with `VERIFY_BASE_URL=https://your-domain npm run verify:production`. Add `VERIFY_CRON_SECRET` in the process environment to include authenticated readiness checks; the script never prints the secret. Keep its output with the release evidence. Public `/api/health` is liveness only; `/api/internal/ready` checks database/limiter/storage, and neither alone proves scanner, real SDK login or full release acceptance.
