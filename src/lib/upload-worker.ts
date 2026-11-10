import "server-only";

import { validateDetectedFile, uploadedObjectMatches } from "@/src/lib/files";
import { copyObject, headObject } from "@/src/lib/storage";
import { scanObject } from "@/src/lib/scanner";
import { recordMetric } from "@/src/lib/telemetry";
import { claimScanJob, MAX_SCAN_ATTEMPTS, scanOutputKey, settleScanJob, type ScanJob, type ScanOutcome } from "@/src/lib/upload-scan-jobs";

async function processSnapshot(job: ScanJob): Promise<ScanOutcome> {
  if (job.resource.status !== "scanning" || !job.authorActive) return { status: "quarantined", reason: "upload_cancelled" };
  if (job.attempts > MAX_SCAN_ATTEMPTS) return { status: "quarantined", reason: "scan_retries_exhausted" };
  const head = await headObject(job.snapshotKey);
  if (!uploadedObjectMatches(job.resource, head) || !head.etag) return { status: "quarantined", reason: "object_mismatch" };
  const scan = await scanObject({ resourceId: job.resourceId, objectKey: job.snapshotKey });
  if (scan.status === "error") return { status: "retry", reason: "scanner_unavailable" };
  if (scan.status === "infected") return { status: "quarantined", reason: "malware_detected" };
  if (!validateDetectedFile(job.resource.originalFilename, scan.detectedMimeType)) return { status: "quarantined", reason: "file_type_mismatch" };
  if (!scan.sha256) return { status: "retry", reason: "invalid_scanner_response" };
  const objectKey = scanOutputKey(job);
  // Deterministic output for this immutable snapshot makes a crash between copy
  // and DB commit recoverable. Never delete it on an uncertain commit or lease loss.
  await copyObject(job.snapshotKey, objectKey, head.etag);
  return { status: "active", objectKey, mimeType: scan.detectedMimeType, sha256: scan.sha256 };
}

export async function processNextUploadScan() {
  const job = await claimScanJob();
  if (!job) return { processed: false };
  const started = performance.now();
  const queueMs = Math.max(0, Date.now() - job.createdAt.getTime());
  let outcome: ScanOutcome;
  try {
    outcome = await processSnapshot(job);
  } catch {
    outcome = { status: "retry", reason: "scan_dependency_unavailable" };
  }
  const committed = await settleScanJob(job, outcome);
  recordMetric("upload.scan_attempt", { outcome: outcome.status, committed, attempt: job.attempts,
    durationMs: Math.round(performance.now() - started), queueMs, sizeBytes: job.resource.sizeBytes,
  });
  return { processed: true, committed };
}
