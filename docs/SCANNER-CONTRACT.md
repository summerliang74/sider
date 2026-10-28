# Malware scanner contract

`MALWARE_SCAN_URL` is called synchronously after the application has verified the private S3 object with `HEAD` and atomically moved the resource from `pending` to `scanning`.

Request:

```http
POST /scan
Authorization: Bearer <MALWARE_SCAN_TOKEN>
Content-Type: application/json

{"resourceId":"<uuid>","objectKey":"pending/<uuid>/<random>"}
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

Scanner failures may return `{"status":"error"}` or a non-2xx status. Timeouts, invalid responses, mismatched types, and service errors all fail closed to `quarantined`.

## Included implementation

`services/malware-scanner` implements this contract. It reads only the requested
`pending/<resourceId>/...` object, streams it to a private ClamAV daemon, computes
SHA-256, and detects the supported file type from file signatures. ClamAV port
3310 must never be exposed publicly because the daemon has no authentication.

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
