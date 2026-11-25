# Current application

Java 21 / Spring Boot in `backend/`, with native HTML/CSS/JavaScript in
`backend/src/main/resources/static/`. Build with `mvn -f backend/pom.xml verify`.
Run frontend tests with `npm test`. Database schema tooling is in `db/schema.js`
and `drizzle.config.js`; existing SQL migration files must remain unchanged.
The former Next.js application is available in Git history through `a56aa7c`.

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
