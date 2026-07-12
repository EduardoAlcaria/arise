# Arise — Project State
*Last audited: 2026-07-12*
*(Factual sections below re-audited against code on this date. The dated
"Current Work in Progress (2026-05-10)" note near the end is kept as a historical
snapshot.)*

---

## What the app is
Self-hosted platform branded **Arise**. Manages remote servers via SSH, deploys code from GitHub, manages Docker containers, orchestrates multi-service apps, and exposes them via Cloudflare Tunnels. Runs as a Docker Compose stack.

---

## Stack (actual, as built)
| Layer | Planned | Actual |
|---|---|---|
| Runtime | Java 21 | Java 21 |
| Framework | Spring Boot 3.3.5 | Spring Boot 3.3.5 |
| Frontend lib | React 18 | React 19 |
| Bundler | Vite 5 | Vite 8 |
| Language | TypeScript 5 | TypeScript ~6 |
| CSS | Tailwind 3 | Tailwind v4 via `@tailwindcss/vite` (no tailwind.config.js) |
| State | Zustand 4 | Zustand 5 |
| Router | React Router 6 | React Router 7 |
| Query | TanStack Query 5 | TanStack Query 5 |

---

## ✅ Working & Usable

### Auth
- Register / Login with JWT (HS256, 24h expiry)
- All endpoints except `/api/auth/**` require a valid JWT
- Frontend: Login, Register pages + Zustand auth store + ProtectedRoute

### Machines
- Register machines with SSH private key, full CRUD
- Test SSH connectivity, run arbitrary SSH commands
- Scheduled health ping every 60s
- Browser SSH terminal via WebSocket + xterm.js

### Deployments
- Async deploy triggered via RabbitMQ queue, returns immediately
- Stack auto-detection: Dockerfile / package.json / pom.xml / build.gradle
- SSH-based: git clone → build → docker compose up on remote
- SSE log streaming at `GET /api/deployments/{id}/logs/stream`
- Rollback endpoint
- Grouped card UI, Watch button for in-progress runs
- `DeployRepoWizard` — multi-step wizard for single-repo and multi-service (Application) deploys

### GitHub Integration
- Save PAT, list repos + branches + file tree + README
- Frontend: repo browser with file tree and README rendering

### Cloudflare Integration
- Save API token + accountId
- List zones and tunnels, create tunnels
- **Add tunnel to any existing deployment**: `POST /api/deployments/{id}/tunnel` — creates tunnel and writes ingress config on remote machine via SSH
- Token can be saved from `/cloudflare` page or `/settings` page

### Containers
- Deploy Docker images to remote machines via Docker TCP API (`tcp://host:2375`)
- Stop / restart / remove / tail logs

### Infisical Secrets *(beyond build_plan)*
- Connect with client ID + secret to any Infisical instance
- List secrets by project / environment / path
- Credentials stored on user account, configurable from Settings page

### CI/CD *(beyond build_plan — backend only)*
- Detect GitHub Actions workflows for a repo
- Setup a self-hosted GitHub Actions runner on a registered machine (async)
- List workflow runs
- **No frontend page yet** — API exists at `/api/cicd` but no UI route

---

## ❌ Missing / Not Done

| Gap | Notes |
|---|---|
| **No controller / integration tests** | Unit tests exist for helpers (`GitHubServiceAriseConfigTest`, `ComposePsParserTest`, `RunnerSetupTrackerTest`, `DeploymentReconcilerTest`, `LineBufferTest`, `Utf8StreamDecoderTest`). No web-layer / integration tests; the SSH deploy pipeline in `DeploymentService` is not directly tested. |
| **JWT secret default** | `application.yml` has a hardcoded fallback secret — must be overridden via `JWT_SECRET` env var in production |
| **`GitHubService.getFileContent`** | `.block().get("content")` unchecked cast can NPE / ClassCastException on an unexpected response; swallowed by a broad catch that returns `""` — a silent failure. |

---

## ⚠️ Known Issues / Concerns

**Docker TCP requirement** — The Containers page uses `DockerService` which connects to `tcp://host:2375`. The Docker daemon on target machines must have TCP enabled — this is not the default and will silently fail if not configured.

**Duplicate Cloudflare token form** — Cloudflare API token can be saved from both the `/cloudflare` page and the `/settings` page. Minor UX duplication, functionally identical.

### Resolved since this audit

**SSE thread leak — FIXED.** `DeploymentController.streamLogs()` no longer spawns a per-request executor. Live logs now go through `LogBroadcaster`, an in-memory pub/sub that fans each `appendLog` line out to all connected `SseEmitter`s for that deployment (with a DB replay on connect). No polling, no per-request thread pool.

**RabbitMQ event consumption — RESOLVED.** `DEPLOYMENT_SUCCESS/FAILED` events are consumed by `DeploymentEventListener`, which broadcasts a WebSocket notification (tabs invalidate their TanStack Query caches) and re-publishes to the hooks exchange, where `PostDeployHookListener` fires the deployment's outbound webhook. Poison messages are dropped, not requeued forever (`default-requeue-rejected: false`).

---

## How to Run

```bash
# Full stack (recommended)
docker compose up --build
# Frontend → http://localhost:3000
# Backend API → http://localhost:8080/api

# Dev mode (infra via Docker, services locally)
docker-compose up -d                  # postgres + redis + rabbitmq
cd backend && mvn spring-boot:run     # :8080
cd frontend && npm run dev            # :5173, proxies /api to :8080
```

Override the JWT secret in production:
```bash
JWT_SECRET=your-base64-encoded-secret docker compose up
```

---

## Current Work in Progress (2026-05-10)

### ProxyCommand / SSH Bastion Support — IMPLEMENTED, connection blocked

All 7 tasks were completed and committed:

- `ProcessProxy.java` — implements `com.jcraft.jsch.Proxy`, spawns a subprocess (e.g. `cloudflared access ssh --hostname %h`) and pipes its stdin/stdout as the SSH transport
- `SshService.java` — refactored to `openSession(Machine)`, `execute(Machine, cmd)`, `writeFileViaShell(Machine, path, content)` — ProxyCommand is applied automatically when the field is set
- `Machine.java` / `MachineRequest` / `MachineResponse` — added `proxyCommand` field (optional TEXT column, nullable, Hibernate auto-migrated)
- `DeploymentService`, `CicdService`, `SshTerminalHandler` — migrated all call sites to Machine-based API
- `Dockerfile` — cloudflared binary installed in runtime image
- Frontend — Machines form has Proxy Command input, machine cards show "via proxy" badge

**Current blocker:** First test with Mac Mini behind Cloudflare Access SSH tunnel (`ssh.arise.alcaria.dev`, proxyCommand `cloudflared access ssh --hostname %h`) returned HTTP 403. Cloudflare Access requires client authentication — non-interactive `cloudflared` inside a Docker container cannot do browser-based auth. A service token (CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET env vars) would solve it, but no service token has been created yet.

**Better approach being designed:** The user noted that the whole "route SSH through Cloudflare Access" model is a band-aid. A cleaner solution (WireGuard mesh, or direct SSH with port forwarding without Cloudflare Access gating) is planned to be designed and implemented.

---

## What's Next (suggested)

1. **Mac Mini SSH connectivity** — decide on the right NAT traversal approach (WireGuard mesh, Cloudflare service token, direct port forward, etc.) and implement it
2. ~~**Credential encryption**~~ — DONE. AES-GCM at rest via `AesGcmConverter` (`encryption.secret`). Optional follow-up: route creds through Infisical instead of DB columns.
3. ~~**CI/CD frontend page**~~ — DONE. `/cicd` page wired to `/api/cicd`.
4. ~~**Fix SSE thread leak**~~ — DONE. `LogBroadcaster` pub/sub fan-out.
5. **Tests** — helper unit tests exist; still missing controller / integration tests for the auth + deployment flow.

For the full forward roadmap see `docs/upcoming_feautures.md`.
