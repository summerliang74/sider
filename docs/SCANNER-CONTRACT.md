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
