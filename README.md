# Arise — Self-Hosted Automation Hub

Arise is a self-hosted platform for managing remote servers, deploying applications, and orchestrating infrastructure from a single dashboard. It targets developers and small teams who run their own machines and want a unified control plane without depending on external CI/CD services or cloud providers.

---

## Objectives

- **Centralize remote server management.** Register any Linux machine by SSH key and interact with it through a browser-based terminal or automated commands.
- **Deploy code directly from GitHub.** Connect a personal access token, browse repositories, pick a branch, and trigger a deployment pipeline that runs on the target machine over SSH — no agent installed on the remote, no cloud build runners.
- **Run Docker containers on remote machines.** Pull images, set environment variables, map ports, and manage container lifecycle without touching a terminal.
- **Deploy multi-service applications.** Define a group of repositories that compose an application, inject configuration files (`.env`, `nginx.conf`, custom configs), and have the platform orchestrate the clone-build-compose cycle on the target machine.
- **Expose applications through Cloudflare Tunnels.** Optionally create a tunnel during deployment, configure DNS automatically, and get a public HTTPS URL without opening firewall ports.
- **Monitor CI/CD pipelines.** View GitHub Actions workflow runs and runners across all repositories. Register self-hosted runners on remote machines directly from the UI.
- **Remain fully self-hosted.** The entire platform runs as a set of Docker containers on any machine. No data leaves your infrastructure.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                    │
│  React 19 · Vite · TailwindCSS · TanStack Query            │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / SSE / WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│  Backend  (Spring Boot 3.3.5 · Java 21)                    │
│                                                             │
│  REST API      ──► Spring Security (JWT)                   │
│  SSE stream    ──► Deployment log streaming                 │
│  WS /terminal  ──► SSH terminal relay (JSch)               │
│  WS /notify    ──► Real-time deployment completion push     │
│                                                             │
│  POST /api/deployments                                      │
│      → DB save (PENDING)                                    │
│      → afterCommit: publish to deployment.run.queue         │
│                          │                                  │
│  DeploymentRunListener ◄─┘                                  │
│      → SSH to remote machine                                │
│      → git clone · stack detect · docker build             │
│      → publishes DEPLOYMENT_SUCCESS/FAILED event            │
│                          │                                  │
│  DeploymentEventListener ◄┘                                 │
│      → WS broadcast to all browser tabs                     │
│      → hooks.queue (post-deploy webhook foundation)         │
└──────┬──────────────────────────────────────────────────────┘
       │
       ├── PostgreSQL 16   (persistent state)
       └── RabbitMQ 3.13   (deployment run queue · event queue · hooks queue)
```

The backend is stateless between requests. Deployments are queued into RabbitMQ so the HTTP response returns immediately. The message is only published **after the DB transaction commits** (via `TransactionSynchronizationManager.afterCommit`) — no race condition between the listener reading and the row existing. Deployment logs stream to the browser via SSE. When a deployment finishes, RabbitMQ broadcasts a WebSocket push to all connected browser tabs, invalidating their TanStack Query caches without a page refresh.

Communication with remote machines is purely over SSH — no agent, no open ports on the target.

---

## Tech Stack

### Backend

| Technology | Version | Why |
|---|---|---|
| **Spring Boot** | 3.3.5 | Battle-tested JVM framework with full control over every component. |
| **Java** | 21 | LTS release. |
| **Spring Security + JJWT** | — | Stateless JWT auth. Each request carries a signed token; the backend verifies it without a session store. |
| **Spring Data JPA + Hibernate** | — | Maps entities to PostgreSQL. Schema auto-migrated on startup (`ddl-auto: update`). |
| **Spring AMQP + RabbitMQ** | 3.13 | Three queues: `deployment.run.queue` (execution), `deployment.queue` (events → WS broadcast), `hooks.queue` (post-deploy webhooks). |
| **Spring WebFlux (WebClient)** | — | Non-blocking outbound HTTP to GitHub API and Cloudflare API. |
| **WebSocket** | — | Two endpoints: `/ws/terminal/*` (SSH relay) and `/ws/notifications` (deployment completion push to all tabs). |
| **JSch** | — | Pure-Java SSH client for remote command execution and interactive terminal. |
| **PostgreSQL** | 16 | Primary store. JSON columns hold service and config-file lists inside deployment records. |
| **Lombok** | — | Eliminates getter/setter/constructor boilerplate. |

### Frontend

| Technology | Version | Why |
|---|---|---|
| **React** | 19 | Component model maps naturally to the dashboard's panel-based UI. |
| **Vite** | — | Sub-second HMR, optimized production bundle. |
| **TailwindCSS** | v4 | Utility-first CSS with CSS custom properties for theming. |
| **TanStack Query** | v5 | Server state with automatic background refetch and cache invalidation. Caches are invalidated via WebSocket push on deployment completion — no polling needed. |
| **Zustand** | — | Minimal global store for auth state (JWT token, user info). |
| **React Router** | v7 | Nested routes with a single `<Layout>` wrapper. |
| **React Flow** | — | Powers the topology graph with Dagre auto-layout. |
| **xterm.js** | — | Full terminal emulator connected to the SSH WebSocket relay. |
| **Lucide React** | — | Tree-shaken icon set. |

### Infrastructure

| Component | Why |
|---|---|
| **Docker Compose** | Single command brings up all four services (postgres, rabbitmq, backend, frontend) with health checks and dependency ordering. |
| **nginx** | Serves the React SPA and proxies `/api` requests to the backend — one origin for the browser. |
| **Cloudflare Tunnels** | Zero-trust tunnel for public HTTPS URLs. Backend automates creation, ingress, and DNS. |

---

## Project Structure

```
arise/
├── backend/                    # Spring Boot application
│   ├── src/main/java/
│   │   └── com/automationcenter/
│   │       ├── config/         # Security, RabbitMQ, WebSocket config
│   │       ├── controller/     # REST endpoints
│   │       ├── dto/            # Request / response shapes
│   │       ├── entity/         # JPA entities
│   │       ├── listener/       # RabbitMQ message listeners
│   │       ├── repository/     # Spring Data repositories
│   │       ├── service/        # Business logic
│   │       └── websocket/      # SSH terminal + notification handlers
│   └── Dockerfile
├── frontend/                   # React SPA
│   ├── src/
│   │   ├── api/                # Typed API functions (axios)
│   │   ├── components/         # Shared UI components
│   │   ├── hooks/              # Custom hooks (WS notifications, etc.)
│   │   ├── pages/              # Route-level page components
│   │   ├── stores/             # Zustand stores
│   │   └── types/              # Shared TypeScript interfaces
│   ├── nginx.conf
│   └── Dockerfile
└── docker-compose.yml          # Full-stack orchestration
```

---

## Running Locally

**Prerequisites:** Docker and Docker Compose.

```bash
git clone https://github.com/EduardoAlcaria/arise.git
cd arise
docker compose up --build
```

Frontend: `http://localhost:3000` · Backend API: `http://localhost:8080/api`

Override the JWT secret:

```bash
JWT_SECRET=your-base64-encoded-secret docker compose up
```

---

## Deployment Pipeline — How It Works

1. User selects a repo, branch, and target machine in the UI.
2. `POST /api/deployments` saves a `PENDING` record to PostgreSQL.
3. After the DB transaction commits, the deployment ID is published to `deployment.run.queue` via RabbitMQ.
4. `DeploymentRunListener` picks up the message, opens an SSH session to the target machine, and runs:
   - `git clone` into `/tmp/deploy-<id>/`
   - Stack detection (Node.js, Python, Java, Go, Docker Compose, etc.)
   - The appropriate build command
   - `docker compose up --build -d` for compose-based stacks
5. Each command's stdout/stderr is written as `LogEntry` rows to PostgreSQL and streamed live to the browser via SSE.
6. On completion, the status is set to `SUCCESS` or `FAILED` and a message is published to `deployment.queue`.
7. `DeploymentEventListener` consumes the event and broadcasts a `DEPLOYMENT_UPDATE` WebSocket message to all connected browser tabs, which invalidate their TanStack Query caches — the deployment list updates instantly without polling.
8. On SUCCESS, the event is also published to `hooks.queue`; `PostDeployHookListener` fires the deployment's configured outbound webhook URL.

For **Application** deployments (multi-repo), the platform additionally:
- Clones each service repository into its own subfolder
- Writes injected config files (`.env`, `nginx.conf`, etc.) to the remote via SSH
- Optionally creates a Cloudflare Tunnel, configures ingress rules, and registers a CNAME DNS record

---

## API Overview

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Authenticate, receive JWT |
| `GET` | `/api/machines` | List registered machines |
| `POST` | `/api/machines` | Register a machine |
| `GET` | `/api/deployments` | Paginated deployment list |
| `POST` | `/api/deployments` | Trigger a new deployment |
| `GET` | `/api/deployments/{id}/logs/stream` | SSE log stream |
| `POST` | `/api/deployments/{id}/rollback` | Roll back to previous version |
| `GET` | `/api/containers` | List Docker containers on a machine |
| `POST` | `/api/containers` | Deploy a Docker container |
| `GET` | `/api/github/repos` | List repositories (sorted by push date) |
| `GET` | `/api/github/repos/{owner}/{repo}/readme` | Fetch README markdown |
| `GET` | `/api/github/repos/{owner}/{repo}/tree/{branch}` | Repository file tree |
| `GET` | `/api/github/repos/{owner}/{repo}/file` | File content by path + branch |
| `GET` | `/api/github/me` | Check GitHub connection status |
| `POST` | `/api/github/token` | Save a GitHub PAT |
| `GET` | `/api/cicd/runners` | All runners across all repos |
| `GET` | `/api/cicd/runners/{owner}/{repo}` | Runners for a specific repo |
| `GET` | `/api/cloudflare/zones` | List Cloudflare zones |
| `GET` | `/api/cloudflare/tunnels` | List Cloudflare tunnels |
| `POST` | `/api/cloudflare/tunnels` | Create a Cloudflare tunnel |
| `GET` | `/api/topology` | Infrastructure graph (machines, deployments, tunnels) |
| `POST` | `/api/webhooks/github/{webhookToken}` | Inbound GitHub push webhook (HMAC-verified) → auto-redeploy matching deployments |
| `WS` | `/ws/terminal/{machineId}` | Interactive SSH terminal relay |
| `WS` | `/ws/notifications` | Real-time deployment completion push |
