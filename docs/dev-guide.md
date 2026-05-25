# AutomationHub Developer Guide

**App name:** AutomationCenter (branded "Arise" in UI)  
**Repo:** `D:\programming_WINDOWS_ONLY\projects\AutomationHub`

---

## 1. What it is

AutomationCenter is a self-hosted infrastructure management platform. One user account manages many remote machines via SSH, deploys Docker stacks from GitHub repos, exposes services through Cloudflare tunnels, manages secrets via Infisical, and monitors CI/CD pipelines on GitHub Actions.

Everything is scoped per-user. There are no organisations or teams yet — all data belongs to the authenticated user.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Backend | Java 21, Spring Boot 3.3.5, Spring Security (JWT stateless), Spring Data JPA, Spring WebFlux (WebClient) |
| Database | PostgreSQL (managed by Docker Compose) |
| ORM | Hibernate via JPA. Lombok for boilerplate. |
| Async | RabbitMQ (`spring-amqp`): three queues — `deployment.run.queue` (execution), `deployment.queue` (events), `hooks.queue` (post-deploy webhooks) |
| SSH | JSch (com.jcraft.jsch) |
| GitHub API | kohsuke/github-api + WebClient for file content, README, Actions endpoints |
| Frontend | React 19, Vite, TypeScript, Tailwind v4, TanStack Query v5, React Router v7, Zustand |
| UI components | Lucide icons, React Flow (`@xyflow/react`) for topology, Dagre for auto-layout |
| Infra | Docker Compose — postgres, rabbitmq, backend, frontend (nginx) |

---

## 3. Repository layout

```
AutomationHub/
├── backend/                   Spring Boot app
│   └── src/main/java/com/automationcenter/
│       ├── entity/            JPA entities (plain DB tables)
│       ├── repository/        Spring Data repos
│       ├── dto/               Request/response DTOs (never expose entities)
│       ├── service/           All business logic lives here
│       ├── controller/        Thin REST controllers — delegate to services
│       ├── listener/          RabbitMQ listeners (DeploymentRunListener, DeploymentEventListener, PostDeployHookListener)
│       ├── websocket/         SSH terminal (SshTerminalHandler) + WS notifications (NotificationHandler)
│       ├── security/          JwtService, JwtAuthFilter, UserDetailsServiceImpl
│       ├── config/            SecurityConfig, WebSocketConfig, RabbitMQConfig
│       └── exception/         GlobalExceptionHandler, ApiError, custom exceptions
├── frontend/
│   └── src/
│       ├── pages/             One file per page/route
│       ├── components/        Shared UI components
│       ├── hooks/             Custom hooks (useDeploymentNotifications)
│       ├── api/               Axios wrappers per domain
│       ├── stores/            Zustand stores (authStore only)
│       └── types/index.ts     All shared TypeScript types
├── docs/                      Design docs and this guide
└── docker-compose.yml         Production compose file
```

---

## 4. Backend

### 4.1 Entities

All entities have an `owner` (`@ManyToOne User`) — data is always filtered by `owner_id` in service queries, never exposed across users.

| Entity | Table | Key fields |
|---|---|---|
| `User` | `users` | `email`, `password` (BCrypt), `name`, `role`, `githubToken` (encrypted), `cloudflareToken` (encrypted), `cloudflareAccountId`, `infisicalClientId` (encrypted), `infisicalClientSecret` (encrypted), `infisicalBaseUrl`, `infisicalProjectId` |
| `Machine` | `machines` | `name`, `host`, `port`, `sshUser`, `privateKey` (AES-256-GCM encrypted), `tunnelType` (DIRECT/CLOUDFLARE_TCP/PROXY_COMMAND), `proxyCommand`, `status` |
| `Deployment` | `deployments` | `name`, `type` (REPOSITORY/CONTAINER/APPLICATION), `status`, `repositoryUrl`, `branch`, `detectedStack`, `deployDir`, `resolvedCommitSha`, `cloudfareTunnelId/Url`, `tunnelName/Hostname/AppPort`, `webhookUrl`, `applicationServices/Configs/repoConfigs` (JSON blobs) |
| `ContainerDeployment` | `container_deployments` | `name`, `image`, `hostPort`, `containerPort`, `envVars` (element collection), `containerId`, `status` |
| `LogEntry` | `log_entries` | `deploymentId`, `message`, `level`, `createdAt` |

**Encryption:** `Machine.privateKey`, `User.githubToken`, `User.cloudflareToken`, `User.infisicalClientId`, `User.infisicalClientSecret` are encrypted at rest using AES-256-GCM via `AesGcmConverter` (a JPA `AttributeConverter`). The secret is configured in `application.properties` as `encryption.secret` (must be ≥ 32 chars). The converter is applied with `@Convert(converter = AesGcmConverter.class)` on each field.

### 4.2 Repositories

All repos extend `JpaRepository`. Owner-scoped query pattern:

```java
List<Machine> findByOwnerId(Long ownerId);
Optional<Machine> findByIdAndOwnerId(Long id, Long ownerId);
```

`LogEntryRepository` adds:
```java
List<LogEntry> findByDeploymentIdOrderByCreatedAtAsc(Long deploymentId);
void deleteByDeploymentId(Long deploymentId);  // @Transactional required on caller
```

### 4.3 Services

Business rules live exclusively in services. Controllers are thin wrappers.

| Service | Responsibility |
|---|---|
| `AuthService` | Register (unique email), login, issue JWT |
| `MachineService` | CRUD for machines, test SSH ping, `@Scheduled` health check every 5 min |
| `SshService` | Execute a shell command via SSH (`execute`), write a file via base64 shell pipe (`writeFileViaShell`). Handles DIRECT/CLOUDFLARE_TCP/PROXY_COMMAND tunnel modes. Prepends `/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin` to PATH on every command so macOS Homebrew tools are found (JSch ChannelExec skips shell profile). |
| `DeploymentService` | Create deployment (publishes to `deployment.run.queue` via `afterCommit`), `executeAsync` (called by listener), rollback, redeploy, delete, add/remove tunnel. Tears down previous deployment before redeploying. |
| `ContainerDeploymentService` | Deploy a Docker image on a machine via SSH (docker run) |
| `LogService` | Append log entry to DB + broadcast via `LogBroadcaster` |
| `LogBroadcaster` | SSE pub/sub — holds `ConcurrentHashMap<deploymentId, Set<SseEmitter>>`. `publish()` fans out to all connected clients. `complete()` signals stream end. |
| `GitHubService` | List repos (ISO-8601 dates for correct sort), branches, file tree, README (WebClient), file content, env var keys, runner registration token. |
| `CloudflareService` | Save/validate token, list zones, create/configure/delete tunnel, get tunnel token, create DNS CNAME |
| `InfisicalService` | Save credentials, authenticate (get bearer token), list/get secrets |
| `CicdService` | detectWorkflows, getWorkflowRuns (returns `workflowName`, `displayTitle`, `headSha`, `htmlUrl`), rerunWorkflow, triggerWorkflow, getWorkflowJobs, listRunners (per-repo), listAllRunners (aggregated across all repos via parallelStream), deleteRunner, setupRunner (async, SSH) |
| `TopologyService` | Build graph of machines → deployments → tunnels + containers from DB |
| `DockerService` | Docker container lifecycle (stop/start/remove/logs) via SSH |

### 4.4 Controllers

All controllers are under `/api/*`. Every endpoint requires authentication except `/api/auth/**` and `/ws/**`.

The authenticated `User` object is injected via `@AuthenticationPrincipal User user` — the JWT filter populates the security context with the full `User` entity.

```java
// Pattern: always pass user.getId() to service, never trust client-supplied userId
@GetMapping("/machines")
public ResponseEntity<List<MachineResponse>> list(@AuthenticationPrincipal User user) {
    return ResponseEntity.ok(machineService.listByOwner(user.getId()));
}
```

### 4.5 Complete API routes

```
Auth
  POST /api/auth/register
  POST /api/auth/login

Machines
  GET    /api/machines
  POST   /api/machines
  PUT    /api/machines/{id}
  DELETE /api/machines/{id}
  POST   /api/machines/{id}/test
  POST   /api/machines/{id}/ssh

Deployments
  GET    /api/deployments?page=&size=&sort=
  GET    /api/deployments/{id}
  POST   /api/deployments
  POST   /api/deployments/{id}/rollback
  POST   /api/deployments/{id}/redeploy
  DELETE /api/deployments/{id}
  POST   /api/deployments/{id}/tunnel
  DELETE /api/deployments/{id}/tunnel
  GET    /api/deployments/{id}/logs          (SSE stream)

Containers
  GET    /api/containers
  POST   /api/containers
  DELETE /api/containers/{id}
  POST   /api/containers/{id}/stop
  POST   /api/containers/{id}/start

Logs
  GET    /api/logs/{deploymentId}

GitHub
  GET    /api/github/user
  GET    /api/github/repos
  GET    /api/github/repos/{owner}/{repo}/branches
  GET    /api/github/repos/{owner}/{repo}/readme
  GET    /api/github/repos/{owner}/{repo}/tree/{branch}
  GET    /api/github/repos/{owner}/{repo}/file?path=&branch=
  GET    /api/github/repos/{owner}/{repo}/env-vars/{branch}
  POST   /api/github/token

CI/CD
  GET    /api/cicd/workflows/{owner}/{repo}
  GET    /api/cicd/runs/{owner}/{repo}
  POST   /api/cicd/runs/{owner}/{repo}/{runId}/rerun
  POST   /api/cicd/workflows/{owner}/{repo}/{workflowId}/dispatch?ref=
  GET    /api/cicd/jobs/{owner}/{repo}/{runId}
  GET    /api/cicd/runners                          (all repos, aggregated)
  GET    /api/cicd/runners/{owner}/{repo}
  DELETE /api/cicd/runners/{owner}/{repo}/{runnerId}
  POST   /api/cicd/runner/{owner}/{repo}/setup?machineId=

Cloudflare
  GET    /api/cloudflare/zones
  POST   /api/cloudflare/token
  POST   /api/cloudflare/tunnels
  GET    /api/cloudflare/tunnels/{tunnelId}/token
  GET    /api/cloudflare/tunnels

Infisical
  POST   /api/infisical/connect
  GET    /api/infisical/secrets/{projectId}/{env}
  GET    /api/infisical/secret/{projectId}/{env}/{secretName}

Topology
  GET    /api/topology

WebSocket
  WS     /ws/terminal/{machineId}   (SSH terminal relay)
  WS     /ws/notifications          (deployment completion push — invalidates browser caches)
```

### 4.6 Authentication

Stateless JWT. Flow:
1. `POST /api/auth/login` → `AuthService.login()` → validates credentials, calls `JwtService.generateToken(user)` → returns `{ token, user }`
2. Every subsequent request: `JwtAuthFilter` extracts bearer token, calls `JwtService.extractUsername()`, loads `User` from DB, sets `UsernamePasswordAuthenticationToken` in `SecurityContextHolder`
3. Controllers receive `@AuthenticationPrincipal User user` — the full `User` entity, not just claims

**JWT secret:** configured in `application.properties` as `jwt.secret`. **JWT expiration:** 24 hours.

### 4.7 Error handling

`GlobalExceptionHandler` (`@RestControllerAdvice`) maps exceptions to HTTP responses as `{ "status": N, "message": "...", "timestamp": "..." }`:

| Exception | Status |
|---|---|
| `ResourceNotFoundException` | 404 |
| `EmailAlreadyExistsException` | 409 |
| `IllegalArgumentException` | 400 |
| `MethodArgumentNotValidException` | 400 (joins field errors) |
| `Exception` (catch-all) | 500 |

**Pattern for validation errors in services:** throw `IllegalArgumentException("message")`. The handler returns `{ message: "..." }`. Frontend reads `error.response.data.message`.

---

## 5. Frontend

### 5.1 Routing

All authenticated routes are children of `/` which renders `Layout`. `ProtectedRoute` checks `useAuthStore` — redirects to `/login` if no token.

```
/login            Login.tsx
/register         Register.tsx
/                 Dashboard.tsx
/machines         Machines.tsx
/containers       Containers.tsx
/deployments      Deployments.tsx
/cicd             CiCd.tsx
/topology         Topology.tsx
/github           GitHub.tsx
/cloudflare       Cloudflare.tsx
/settings         Settings.tsx
```

### 5.2 State management

**Server state:** TanStack Query. All API calls are `useQuery`/`useMutation`. Query keys:
- `['machines']`, `['containers']`, `['deployments-all']`, `['topology']`
- `['cicd-runs', owner, repo]`, `['cicd-workflows', owner, repo]`, `['cicd-runners', owner, repo]`, `['cicd-runners-all']`
- `['cicd-jobs', owner, repo, runId]`
- `['dep-watch-status', deploymentId]` — polled by `DeploymentWatcher` during active deployment
- `['github-repos']`, `['github-branches', owner, repo]`, `['github-readme', owner, repo]`, `['github-tree', owner, repo, branch]`, `['github-file', owner, repo, path, branch]`

**Cache invalidation:** The `useDeploymentNotifications` hook (active in `Layout.tsx`) connects to `/ws/notifications`. On `DEPLOYMENT_UPDATE` message, it invalidates `['deployments-all']` and `['dep-watch-status', id]` instantly across all open tabs.

**Auth state:** Zustand (`useAuthStore`) — holds `{ user, token, login, logout }`. Token persisted to `localStorage`.

**No Redux.** No global state beyond auth.

### 5.3 API layer (`frontend/src/api/`)

Each file exports typed functions over an Axios `client` instance. The client:
- Base URL: `http://localhost:8080/api`
- Attaches `Authorization: Bearer <token>` from `useAuthStore`
- Interceptor: on 401/403 → calls `logout()` and redirects to `/login`

Files: `auth.ts`, `machines.ts`, `deployments.ts`, `containers.ts`, `github.ts`, `cloudflare.ts`, `infisical.ts`, `cicd.ts`, `topology.ts`

### 5.4 Types (`frontend/src/types/index.ts`)

All shared interfaces live here. Never define types in component files for domain objects. Key types: `Machine`, `Deployment`, `ContainerDeployment`, `LogEntry`, `Page<T>`, `GitHubRepo`, `GitHubBranch`.

### 5.5 CSS / design system

Tailwind v4. Custom classes defined in `index.css`:
- `.btn-primary`, `.btn-ghost` — button variants
- `.input` — form input
- `.nav-item`, `.nav-item.active` — sidebar nav links
- `.status-online`, `.status-error`, `.status-building`, `.status-muted` — colored badges

Dark theme throughout. Colors are CSS variables (`--color-background`, `--color-foreground`, etc.). **Exception:** React Flow SVG attributes (edge `stroke`, node background) must use hardcoded hex — CSS variables don't resolve inside SVG rendering context.

---

## 6. Key business rules

### 6.1 Data isolation
Every service method that queries data takes `ownerId` as a parameter and passes it to the repository. No service ever returns data without filtering by owner. The `ownerId` always comes from the JWT (`user.getId()`), never from the request body.

### 6.2 SSH connection modes

`SshService.openSession(machine)` handles three modes:
- **DIRECT** — standard JSch TCP to `machine.host:machine.port`
- **CLOUDFLARE_TCP** — spawns `cloudflared access tcp` as a subprocess on the server, waits for the local port to bind, then JSch connects to localhost. Cleanup thread kills the cloudflared process when the JSch session closes.
- **PROXY_COMMAND** — JSch `ProxyCommand` socket using `machine.proxyCommand`. Supports `%h` and `%p` substitution (any SSH ProxyCommand style).

### 6.3 Deployment flow

1. `POST /api/deployments` → `DeploymentService.create()` (annotated `@Transactional`) → saves record with `PENDING` → registers `TransactionSynchronization.afterCommit()` to publish deployment ID to `deployment.run.exchange`. Returns immediately.
2. `DeploymentRunListener.onRunDeployment()` picks up the message from `deployment.run.queue` and calls `deploymentService.executeAsync(id)`:
   - Sets status to `BUILDING`
   - Detects OS on remote machine (`uname -s`)
   - Injects GitHub token into clone URL for auth
   - **REPOSITORY type:** Clones repo to `/tmp/deploy_{id}/`. Writes any `repoConfigs` (config files) to the deploy dir before stack detection. Saves `deployDir` on the entity. Tears down the previous successful deployment for the same repo+machine before starting. Detects stack (`compose` / `node` / `maven` / `python` / `static`). Runs stack build command.
   - **APPLICATION type:** Resolves remote `$HOME` via SSH (`echo $HOME`). Clones each service repo to `~/arise-apps/{deploymentId}/{serviceName}/`. Writes config files (scoped by service subfolder prefix). Tears down previous APPLICATION deployment on same machine. Runs `docker compose up --build -d` from `baseDir`.
   - Optionally creates Cloudflare tunnel
   - Sets status to `SUCCESS` or `FAILED`
   - Publishes `"DEPLOYMENT_SUCCESS:id"` or `"DEPLOYMENT_FAILED:id"` to `deployment.exchange`
3. `DeploymentEventListener.onDeploymentEvent()` receives the event:
   - Broadcasts `{"type":"DEPLOYMENT_UPDATE","deploymentId":N,"status":"SUCCESS"}` via `/ws/notifications` WebSocket to all connected browser tabs
   - On SUCCESS: publishes to `hooks.queue` → `PostDeployHookListener` makes HTTP POST to `deployment.webhookUrl` if set
4. Frontend streams logs live via SSE (`GET /api/deployments/{id}/logs/stream`) through `DeploymentWatcher.tsx`
5. On completion, the WS push invalidates `['deployments-all']` — deployment list refreshes automatically

**Race condition prevention:** The `afterCommit()` hook guarantees the deployment row is committed to DB before the RabbitMQ message fires, so the listener can always find the record via `findById`.

**Teardown before redeploy:** `teardownPreviousDeployment()` looks up the most recent `SUCCESS` deployment for the same `repositoryUrl + machineId + type` (or same `machineId + type` for APPLICATION), runs `docker compose down --remove-orphans` in its `deployDir`. This prevents port conflicts when redeploying. Non-fatal — teardown failure logs a WARN and continues.

**Config file injection:** Both REPOSITORY and APPLICATION deployments accept a `repoConfigs` / `configFiles` array of `{path, content}`. Files are written via `SshService.writeFileViaShell()` (base64-encode → `printf | base64 -d > path` on remote). For REPOSITORY, files are written relative to the clone dir. For APPLICATION, files are matched by service subfolder prefix and written into the correct service dir.

**Rollback:** SSH `docker compose down` in `deployDir` of the old deployment, then `docker compose up -d` in the previous deployment's `deployDir`.

**Redeploy:** Creates a new `Deployment` row (same `repositoryUrl` so it groups in the UI), carries over `repoConfigs` and `webhookUrl` from the source, runs `executeAsync` again.

**Delete:** SSH `docker compose down`, delete Cloudflare tunnel via API, delete all `LogEntry` records, delete `Deployment` row.

### 6.4 Log streaming (SSE)

`LogBroadcaster` is a singleton Spring bean:
- `subscribe(deploymentId)` → returns an `SseEmitter`, registers it in `ConcurrentHashMap<Long, Set<SseEmitter>>`
- `publish(deploymentId, message)` → fans out to all registered emitters for that deployment
- `complete(deploymentId)` → sends `EVENT: complete` signal, removes emitters

`DeploymentService.appendLog()` calls `logService.save()` + `logBroadcaster.publish()` on every log line. Existing logs are replayed on new SSE connections so late joiners catch up.

### 6.5 CI/CD runners

`setupRunner` is `@Async` — it returns 202 immediately. The actual work:
1. Gets a runner registration token from GitHub API (requires GitHub token with `repo` + `workflow` scope + repo admin)
2. Fetches latest runner version from `api.github.com/repos/actions/runner/releases/latest`
3. SSHs into the machine and runs the full install script (`curl | tar`, `config.sh`, `svc.sh install && start`)

Runner setup requires the target machine user to have `sudo` without password for the `svc.sh` commands.

**Mac Mini runner (live):** Runner named `Mac-Mini` is registered and running on the Mac Mini for the `arise` repo (labels: `self-hosted, macOS, ARM64, Mac-Mini`). It was installed as a LaunchAgent so it auto-starts on login. GitHub token must have `workflow` scope for runner registration to succeed.

### 6.6 Cloudflare tunnels

`CloudflareService` uses the Cloudflare v4 API (`https://api.cloudflare.com/client/v4`). Flow for a new tunnel in a deployment:
1. `createTunnel` → POST to `/accounts/{accountId}/cfd_tunnel`
2. `configureTunnelIngress` → PUT ingress rules (maps hostname to local service URL)
3. `createDnsCname` → POST to `/zones/{zoneId}/dns_records` (CNAME → tunnel UUID.cfargotunnel.com)
4. `getTunnelToken` → GET token → run `cloudflared tunnel run --token` in Docker on the machine

### 6.7 Topology graph

`TopologyService.buildGraph(ownerId)` assembles nodes and edges from three DB queries (machines, deployments, containers). Nodes are typed as `machine | deployment | tunnel | container`. Edges are `deployed on`, `exposes`, `running on`. The frontend renders this with React Flow + Dagre auto-layout.

---

## 7. How to add a new feature

The pattern is always the same:

### Backend
1. Add entity fields or create new entity if needed
2. Add repository method if querying by new criteria
3. Add DTO for request/response — never expose entity directly
4. Add service method with `(ownerId, ...)` signature
5. Add controller method: `@AuthenticationPrincipal User user` → call `service.method(user.getId(), ...)`
6. Throw `IllegalArgumentException("message")` for user errors, `ResourceNotFoundException` for missing records

### Frontend
1. Add API function in the relevant `api/*.ts` file
2. Add type to `types/index.ts` if needed
3. Use `useQuery` for fetches, `useMutation` for writes
4. Display errors with `(error as any)?.response?.data?.message ?? 'Fallback message'`
5. Add page to `pages/`, register route in `App.tsx`, add nav item in `Layout.tsx`

---

## 8. Local development setup

### Prerequisites
- Java 21, Maven
- Node 20+, npm
- Docker Desktop

### Start infrastructure
```bash
docker compose up -d postgres rabbitmq
```

### Backend
```bash
cd backend
./mvnw spring-boot:run
# Runs on :8080
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Runs on :5173
```

CORS is configured for `localhost:3000` and `localhost:5173`.

### Full stack (production-like)
```bash
docker compose up --build
# Backend :8080, Frontend :3000 (nginx), Postgres :5432, RabbitMQ :5672/:15672
```

### Infisical self-hosted (optional)
```bash
docker compose -f docker-compose.infisical.yml up -d
# Opens on :8888
```

---

## 9. Database

Schema is managed by Hibernate `ddl-auto=update` — it creates/updates tables on startup. No migration files.

**Gotcha:** `@ElementCollection` (e.g. `ContainerDeployment.envVars`) creates a join table (`container_env_vars`). If you add a new `@ElementCollection`, you need to also add `cascade = CascadeType.ALL, orphanRemoval = true` to clean up on delete.

**Gotcha:** `deleteByDeploymentId` in `LogEntryRepository` is a derived delete query — the calling service method must be `@Transactional`.

---

## 10. Production infrastructure (Mac Mini)

### Connection
- **Host:** `arise-ssh.alcaria.dev` (Cloudflare Access SSH tunnel)
- **User:** `mugen`
- **Tunnel type:** `PROXY_COMMAND` with `cloudflared access ssh --hostname %h`
- **Machine ID in DB:** 4

### Ports in use on Mac Mini
| Port | Service |
|---|---|
| 80 | caddy / system |
| 3030 | existing service |
| 5332, 5432 | postgres instances |
| 8000, 8080, 9000 | existing services |
| 11434 | ollama |
| 4100, 4200 | Absolute app (deployed via arise) |
| 9999, 9090, 3000 | sixeyes app (deployed via arise) |
| 9191 | test-inject nginx (can be removed) |

### Live deployments
| Deployment | Type | Repo | Deploy dir |
|---|---|---|---|
| Absolute | APPLICATION | EduardoAlcaria/Absolute + EduardoAlcaria/retropilot | `~/arise-apps/16/` |
| sixeyes | REPOSITORY | EduardoAlcaria/sixeyes | `/tmp/deploy_19/` |
| test-inject | REPOSITORY | EduardoAlcaria/arise | `/tmp/deploy_23/` (nginx test — can delete) |

### Full deploy flow (end-to-end, no Claude needed)
1. Open arise UI → Deployments → Deploy
2. **Single repo:** pick repo → Step 2 fills env vars from `.env.example` → Step 3: select machine, add config files if repo needs an injected `docker-compose.yml` or Dockerfile, set webhook URL → Deploy
3. **Application (multi-repo):** pick repos → assign subfolder names → Step 3: add config files (shared compose that references all services), select machine → Deploy Application
4. Arise clones repos, writes injected files, runs `docker compose up --build -d`, streams logs
5. On SUCCESS: post-deploy webhook fires (if `webhookUrl` set), WS notification refreshes UI

### Config file injection
Use when a repo has a broken/missing Dockerfile or docker-compose. In the wizard Step 3, use **Add file** to inject any file by path (relative to clone dir). Content is base64-encoded and written via SSH before stack detection. Common use cases:
- Inject `docker-compose.yml` for repos that have none
- Override a broken `Dockerfile` with a fixed version (e.g. add `build-essential` for Python C extensions)
- Inject `nginx/nginx.conf` for frontend services

---

## 11. Known issues / shortcuts

| Issue | Detail |
|---|---|
| No tests | Zero unit or integration tests currently. |
| CORS hardcoded | `SecurityConfig` allows only `localhost:3000` and `localhost:5173`. Production deployments need this updated. |
| Runner setup is fire-and-forget | `setupRunner` returns 202 immediately; there's no way to see the SSH output from the UI. |
| Deployment type APPLICATION | Multi-repo application deploys store services/configs as JSON blobs in `applicationServices` and `applicationConfigs` columns. |
| `~/arise-apps/{id}` not cleaned up | APPLICATION deployment directories on remote machines accumulate — deleting a deployment doesn't SSH to clean the folder. |
| No post-deploy health check | After `docker compose up`, arise doesn't verify containers stay up. Deployment is marked SUCCESS if the compose command exits 0, regardless of container health. |
| Deployment monitoring screen | Log stream UI needs a full redesign — planned but not yet done. |
| Config file injection UX | Single-mode wizard Step 3 config files section works but UX is rough — noted for polish pass. |
| WebClient buffer | Raised to 10MB (`WebClientConfig`). If a GitHub API response exceeds 10MB (very large repos with 1000s of workflow runs), it will still fail. |
