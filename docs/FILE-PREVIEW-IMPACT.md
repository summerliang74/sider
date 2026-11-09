# File preview performance impact

## Decision

Online file preview is removed from the MVP. Authenticated users obtain a short-lived, pre-signed object-storage download URL instead. The application no longer exposes `POST /api/resources/:id/preview` or relays private object bodies for browser rendering.

## Impact of the removed implementation

The previous preview route read each object from S3 through the AWS SDK and streamed it from Next.js to the browser with `Cache-Control: private, no-store`. Its limits were 25 MiB for PDF/images, 15 MiB for DOCX, and 2 MiB for text.

On the current Launchpad application deployment, whose compute and memory budget is shared by pages and APIs:

- Every preview transferred the file twice across application boundaries: object storage to Next.js, then Next.js to the browser. Unlike pre-signed downloads, the second leg consumed application-host bandwidth and held a Node.js request, upstream S3 request, socket, and TLS work for the entire transfer.
- Ten simultaneous maximum-size PDF/image previews represented 250 MiB of application egress and ten long-lived requests. Actual completion time would depend on Launchpad's current per-instance bandwidth and concurrency limits, so the earlier UCloud-specific 30 Mbps estimate is not a valid production baseline.
- Streaming avoided intentionally buffering the complete file, but each concurrent request still required stream buffers, SDK/HTTP state, backpressure queues, file descriptors, and garbage collection. Slow clients kept these resources occupied longer and could increase latency for login, search, upload completion, and administration on the same small instance.
- `no-store` prevented browser/proxy response reuse, so reopening a resource or navigating back repeated the object read and host egress.
- The POST route did not implement HTTP Range handling. PDF viewers could not use normal object-storage range delivery through this endpoint and could require a full transfer before useful navigation.
- DOCX preview added a client bundle dependency and expanded the browser-side CPU/memory and document-parser attack surface. The server still paid the full relay cost before the browser parsed the archive.
- Preview shared the download rate-limit bucket but had no independent byte quota or concurrency cap, so request-count limits did not bound bandwidth consumption.

## Result of removal

Removing preview eliminates application-host file egress for viewing, releases long-lived Next.js connections, removes the DOCX rendering dependency, and leaves byte serving, Range requests, and transfer scaling to object storage. Next.js remains responsible only for authentication, authorization, rate limiting, resource-state checks, and issuing a 120-second download URL.

If preview is reconsidered later, it should use a separate capacity budget and concurrency/byte limits, prefer object-storage delivery or a dedicated preview service, support Range requests where applicable, cache only safely derived artifacts, and undergo load and parser-security testing before release.
