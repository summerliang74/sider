<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Deployment server

When the user asks to deploy this project to "my server", use this UCloud
lightweight cloud host instead of Launchpad unless the user says otherwise.

- Provider: UCloud ULHost
- Region: Hong Kong, Availability Zone B
- Resource ID: `ulhost-1ojf85f0boea`
- Resource name: `ulh.c2m4s80b30t3072`
- Public IP: `101.36.126.8`
- Private IP: `10.7.133.171`
- VPC: `DefaultVPC`
- SSH endpoint: `root@101.36.126.8:22`
- Allowed firewall ports: `22`, `3389`, `80`, `443`
- Capacity: 2 vCPU, 4 GB RAM, 80 GB system disk, 30 Mbps peak bandwidth
- Preinstalled application: OpenClaw
- OpenClaw installation path: `/root/.openclaw`

Do not overwrite `/root/.openclaw` unless the user explicitly requests it.
Never commit server passwords, SSH private keys, or application secrets. Before
performing destructive server operations, verify that the connected host is
`101.36.126.8`.
