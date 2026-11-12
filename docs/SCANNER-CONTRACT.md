# Malware scanner contract

> This language-independent HTTP contract remains applicable to Java. The Node worker commands below apply only to the legacy application; the Java target uses the monitored scheduler described in [deployment environment](DEPLOYMENT-ENVIRONMENT.md). Reusing the scanner contract does not prove its host has capacity for Java plus ClamAV and OpenClaw.

`MALWARE_SCAN_URL` is called by a durable upload worker, independently of the browser's completion request. Completion verifies the ingress object with `HEAD`, conditionally copies it to a server-only snapshot, validates that snapshot, and atomically changes the resource to `scanning` while inserting `upload_scan_jobs`. The completion response is `202`.

Request:

```http
POST /scan
Authorization: Bearer <MALWARE_SCAN_TOKEN>
Content-Type: application/json

{"resourceId":"<uuid>","objectKey":"pending/<uuid>/snapshot-<random>"}
```

The scanner credential must be limited to reading the configured bucket/prefix. It must inspect file signatures, not only extensions or the browser-provided content type.

Clean response:

```json
{"status":"clean","detectedMimeType":"application/pdf","sha256":"<64 lowercase hex>"}
```

Rejected response:

```json
{"status":"infected","detectedMimeType":"application/x-executable","signature":"optional short identifier"}
```

Scanner failures may return `{"status":"error"}` or a non-2xx status. Temporary failures remain non-downloadable in `scanning` and are retried up to three attempts, with 30/60 second backoff. The worker quarantines after exhaustion. Infected files and mismatched types are quarantined immediately. A clean response must include SHA-256 before publication.

The worker scans only the immutable snapshot. A still-valid PUT URL can overwrite the ingress object, but never the snapshot or published key. Five-minute database leases allow recovery after a crash; a stale lease token cannot publish. The deterministic active key makes retry after a storage copy / database commit interruption safe. Deletion or suspension prevents publication.

For the legacy Node application, run `npm run worker:uploads` beside the app, or use the `upload-worker` service in the root Compose file. It calls the cron-secret-protected `POST /api/internal/jobs/uploads` endpoint, processing one job per request. The database enforces one live scan lease across all app instances. Java will retain the same persistent queue/lease contract with its own scheduler; do not run unverified old and new workers together. A supervised worker must be healthy before enabling uploads.

## Included implementation

`services/malware-scanner` implements this contract. It reads only the requested
`pending/<resourceId>/...` object, streams it to a private ClamAV daemon, computes
SHA-256, and detects the supported file type from file signatures. ClamAV port
3310 must never be exposed publicly because the daemon has no authentication.

The current scanner also retains the full object in chunks and concatenates it
for MIME detection; streaming into ClamAV does not mean constant memory usage.
Align `SCANNER_MAX_BYTES`, application upload limits and ClamAV size limits, and
test memory during large scans and signature reloads before co-locating services.

For a container host, copy the scanner's required environment values into a
private deployment environment and run:

```bash
docker compose -f services/malware-scanner/compose.yaml up -d --build
```

The supplied Compose file exposes the authenticated scanner API only on
`127.0.0.1:8081`. If the application runs on another host, place an HTTPS reverse
proxy in front of port 8081 and set `MALWARE_SCAN_URL` to its `/scan` endpoint.
Use the policy in `infra/s3-scanner-policy.example.json` for a separate read-only
OSS/S3 credential; do not reuse the application's write credential in production.
