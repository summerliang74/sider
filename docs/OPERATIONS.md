# MVP deployment and operations

This file turns the PRD's external-service requirements into an operator checklist. It does not contain credentials.

For the exact Launchpad project Variable/Secret references and OAuth/domain commands used by this repository, follow [LAUNCHPAD-SETUP.md](./LAUNCHPAD-SETUP.md).

## Required topology

Internet traffic must terminate at a managed CDN/WAF/DDoS layer. Only that layer may reach the Launchpad application origin. It must overwrite the header named by `TRUSTED_CLIENT_IP_HEADER`; client-supplied forwarding headers must be discarded. The application must not have another publicly reachable origin address.

Launchpad runs only the Next.js compute process. PostgreSQL, private S3-compatible storage, Redis REST, the bot verifier, and malware scanner must survive application deployment and rollback independently.

## PostgreSQL

- Create a least-privilege application role and require TLS (`sslmode=require`, `verify-ca`, or `verify-full`).
- Set `DATABASE_MAX_CONNECTIONS × maximum Launchpad instances` below the provider connection quota.
- Run `npm run db:migrate` as a controlled release step before activating the new application version.
- Enable encrypted automated backups. Before beta, restore a backup into an isolated database and record the recovery time and result.

## Object storage

The bucket is private. Block public ACLs and policies. The application credential needs only `PutObject`, `GetObject`, `HeadObject`, and `DeleteObject` for the configured bucket. The scanner gets a separate read-only credential.

Start from the reviewed templates in `infra/s3-cors.example.json`, `infra/s3-lifecycle.example.json`, `infra/s3-app-policy.example.json`, and `infra/s3-scanner-policy.example.json`; replace every placeholder and adapt only provider-specific syntax.

CORS must allow only the production application origin, methods `PUT`, `GET`, and `HEAD`, and headers `content-type` and `x-amz-meta-resource`. Expose only headers the upload client requires.

Files are first uploaded under `pending/`. A successful scan promotes them to `active/`; rejected files move to `quarantine/`. Configure lifecycle rules to:

- remove objects under `pending/` after two days as a safety net;
- abort incomplete multipart uploads after one day;
- never make an object public.

Schedule `POST /api/internal/jobs/cleanup` every 15 minutes with `Authorization: Bearer <CRON_SECRET>`. The job marks stale pending rows failed and removes objects whose soft-delete recovery window has elapsed.

## Redis REST and rate limits

`RATE_LIMIT_URL` must accept Redis commands as JSON arrays and return `{ "result": ... }`, compatible with the Upstash Redis REST command endpoint. TLS is mandatory. The token must be restricted to the MVP database/namespace. The application uses atomic `EVAL` for counters and `SET ... NX EX` for challenge replay prevention; an unavailable store fails closed.

Load-test OAuth separately using the expected number of students sharing the school egress IP. The committed OAuth IP thresholds are deliberately broad starting values and must be adjusted from the recorded test without introducing a per-user password-failure rule.

## Bot challenge

The browser widget uses the configured public site key. The verifier must return Cloudflare Turnstile-compatible fields: `success`, `hostname`, `action`, and `challenge_ts`. The server validates all four and stores a token digest in Redis to reject replay. Provide the provider's documented keyboard/audio or non-visual alternative before beta.

## Malware scanning

Deploy the service described in [SCANNER-CONTRACT.md](./SCANNER-CONTRACT.md). Grant it read-only access to the private bucket. Alert on scanner timeouts/errors and quarantine growth. Do not retry an infected file automatically.

## WAF and monitoring

Alert on request rate, WAF blocks, application `429` events, challenge triggered/passed/failed counts, scanner outcomes, PostgreSQL saturation, and external-service latency/errors. Application metrics are emitted as single-line JSON without raw IPs, queries, filenames, emails, tokens, cookies, or signed URLs.

Run an abuse exercise covering forged forwarding headers, state mismatch/replay, repeated callback, upload bursts, forged completion, malicious/MIME-mismatched files, download bursts, duplicate reports, and non-admin moderation calls.

## Secrets and rotation

Store all production values in Launchpad Secrets. Only `NEXT_PUBLIC_BOT_SITE_KEY` is public. Give every credential an owner and expiry/rotation date. Rotation is complete only after the new credential works and the old credential is proven unable to access the service.

`SHSID_ADMIN_SUBS` is the comma-separated, reviewed allow-list of exact Launchpad subject identifiers for administrators. Changes are enforced on the next authenticated request or successful sign-in. Removing a subject demotes it and revokes its current sessions when it next reaches the application.

## Release gate

Do not open student beta until every M0 item in the MVP PRD has an owner and recorded evidence, production `SHSID_LAUNCHPAD_OIDC_DEV=0`, the migration and rollback paths have been rehearsed, S3 CORS rejects an unapproved origin, the database restore test succeeds, and an external credential rotation has been demonstrated.

After deployment, run the non-destructive public verification with `VERIFY_BASE_URL=https://your-domain npm run verify:production`. Add `VERIFY_CRON_SECRET` in the process environment to include authenticated readiness checks; the script never prints the secret. Keep its output with the release evidence.

## Invitation registration

Invitation registration is disabled by default. Configure a distinct secret of
at least 32 characters in `REGISTRATION_INVITE_PEPPER`, run the checked-in
database migration with `DATABASE_URL_UNPOOLED`, and set
`REGISTRATION_MODE=invite` only when registrations should be accepted. Restart
the application after changing the mode.

Administrators create and revoke single-use codes at `/admin/invites`. A code is
shown only in the create response; the database and audit log store no plaintext
or masked copy. Rotating `REGISTRATION_INVITE_PEPPER` invalidates all unused
codes, so revoke or reissue outstanding invitations as part of a rotation.

To stop registration immediately, restore `REGISTRATION_MODE=closed` and restart
the application. Existing accounts and sessions continue to work.
