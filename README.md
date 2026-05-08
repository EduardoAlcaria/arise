# Arise — Self-Hosted Automation Hub

Arise is a self-hosted platform for managing remote servers, deploying applications, and orchestrating infrastructure from a single dashboard. It targets developers and small teams who run their own machines and want a unified control plane without depending on external CI/CD services or cloud providers.

---

## Objectives

- **Centralize remote server management.** Register any Linux machine by SSH key and interact with it through a browser-based terminal or automated commands.
- **Deploy code directly from GitHub.** Connect a personal access token, browse repositories, pick a branch, and trigger a deployment pipeline that runs on the target machine over SSH — no agent installed on the remote, no cloud build runners.
- **Run Docker containers on remote machines.** Pull images, set environment variables, map ports, and manage container lifecycle without touching a terminal.
- **Deploy multi-service applications.** Define a group of repositories that compose an application, inject configuration files (`.env`, `nginx.conf`, custom configs), and have the platform orchestrate the clone-build-compose cycle on the target machine.
- **Expose applications through Cloudflare Tunnels.** Optionally create a tunnel during deployment, configure DNS automatically, and get a public HTTPS URL without opening firewall ports.
- **Remain fully self-hosted.** The entire platform runs as a set of Docker containers on any machine. No data leaves your infrastructure.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                    │
│  React 18 · Vite · TailwindCSS · TanStack Query            │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│  Backend  (Spring Boot 3.3 · Java 21)                      │
│                                                             │
│  REST API  ──►  Spring Security (JWT)                      │
│  WebSocket ──►  SSH Terminal relay (JSch)                  │
│  Async tasks ─► RabbitMQ queue ──► Deployment worker       │
│                                       │                     │
│                                       ▼                     │
│                              SSH to remote machine          │
│                              (git clone · docker build)     │
└──────┬──────────────────────────────────────────────────────┘
       │
       ├── PostgreSQL 16   (persistent state)
       ├── Redis 7         (session cache / token store)
       └── RabbitMQ 3.13   (async deployment queue)
```

The backend is stateless between requests. Every deployment is queued into RabbitMQ so the HTTP response returns immediately and the work runs in a thread pool. Deployment logs are written to PostgreSQL in real time and streamed to the browser via SSE.

Communication with remote machines is purely over SSH — no agent, no open ports on the target. The platform holds the private key in the database (encrypted at rest) and opens an SSH session for each operation.

---

## Tech Stack

### Backend

| Technology | Version | Why |
|---|---|---|
| **Spring Boot** | 3.3.5 | Battle-tested JVM framework. Auto-configuration reduces boilerplate while keeping full control over every component. |
| **Java** | 21 | LTS release with virtual threads (Project Loom), enabling high SSH concurrency without tuning a thread pool manually. |
| **Spring Security + JJWT** | — | Stateless JWT auth. Each request carries a signed token; the backend verifies it without a session store. |
| **Spring Data JPA + Hibernate** | — | Maps entities to PostgreSQL with schema auto-migration on startup (`ddl-auto: update`). Avoids a separate migration tool for a project at this stage. |
| **Spring AMQP + RabbitMQ** | 3.13 | Deployment pipelines are slow (git clone, docker build). Queuing them decouples the HTTP layer from the execution layer and makes it easy to add workers later. |
| **Spring WebFlux (WebClient)** | — | Used only for outbound HTTP to the GitHub API and Cloudflare API. Non-blocking, avoids spawning a thread per external call. |
| **WebSocket (STOMP)** | — | Powers the browser-based SSH terminal. The backend relays stdin/stdout between the browser and the remote machine's SSH session. |
| **JSch** | — | Pure-Java SSH client. Executes commands on remote machines and powers the interactive terminal channel without requiring a native SSH binary. |
| **Docker Java** | — | Manages Docker containers on the local host (for the Containers page). Talks to the Docker daemon socket directly. |
| **PostgreSQL** | 16 | Primary store for users, machines, deployments, and logs. Chosen over lighter alternatives because JSON column support is used to store service and config-file lists inside deployment records. |
| **Redis** | 7.2 | Fast key-value store used for token invalidation and caching GitHub API responses to stay within rate limits. |
| **Lombok + MapStruct** | — | Eliminate boilerplate getters/setters/constructors and DTO mapping code without reflection overhead at runtime. |

### Frontend

| Technology | Version | Why |
|---|---|---|
| **React 18** | — | Component model maps naturally to the dashboard's panel-based UI. Concurrent rendering keeps the terminal and data tables responsive simultaneously. |
| **Vite** | — | Sub-second HMR during development, optimized production bundle. No Webpack config to maintain. |
| **TailwindCSS** | — | Utility-first CSS eliminates naming collisions and keeps styles co-located with components. The design system uses CSS custom properties for theming so the entire palette can be swapped at one variable. |
| **TanStack Query** | — | Server state management with automatic background refetch, deduplication, and optimistic updates. Removes the need for Redux or any global state library for API data. |
| **Zustand** | — | Minimal global store used only for auth state (JWT token, user info). Small API, no boilerplate. |
| **React Router v6** | — | Nested routes with a single `<Layout>` wrapper. `<ProtectedRoute>` redirects unauthenticated users without any context hacks. |
| **Lucide React** | — | Consistent icon set with tree-shaking — only imported icons end up in the bundle. |
| **xterm.js** | — | Full terminal emulator in the browser. Handles ANSI escape codes, resize events, and clipboard. Connected to the WebSocket relay for the SSH terminal feature. |

### Infrastructure

| Component | Why |
|---|---|
| **Docker Compose** | Single command brings up all five services (postgres, redis, rabbitmq, backend, frontend) with health checks and dependency ordering. |
| **nginx** | Serves the compiled React SPA inside the frontend container and proxies `/api` requests to the backend, so the browser only talks to one origin. |
| **Cloudflare Tunnels** | Zero-trust tunnel that creates a public HTTPS URL for a deployed application without exposing any port on the remote machine. The backend automates tunnel creation, ingress configuration, and DNS via the Cloudflare API. |

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
│   │       ├── repository/     # Spring Data repositories
│   │       ├── service/        # Business logic
│   │       └── websocket/      # SSH terminal relay
│   └── Dockerfile
├── frontend/                   # React SPA
│   ├── src/
│   │   ├── api/                # Typed API functions (axios)
│   │   ├── components/         # Shared UI components
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

The frontend is available at `http://localhost:3000`. The backend API is at `http://localhost:8080/api`.

To override the JWT secret:

```bash
JWT_SECRET=your-base64-encoded-secret docker compose up
```

---

## Deployment Pipeline — How It Works

1. The user selects a repository and branch in the UI and picks a target machine.
2. A `POST /api/deployments` request is saved to PostgreSQL with status `PENDING`.
3. The request is published to a RabbitMQ queue and the HTTP response returns immediately.
4. A worker thread picks up the message, opens an SSH session to the target machine using the stored private key, and runs:
   - `git clone` (or `git pull` on redeploy) into `/apps/<deployment-id>/`
   - Stack detection (Node.js, Python, Java, Go, Docker Compose, etc.)
   - The appropriate build command for the detected stack
   - `docker compose up --build -d` for compose-based stacks
5. Each command's stdout/stderr is written as `LogEntry` rows to PostgreSQL.
6. The deployment status is updated to `SUCCESS` or `FAILED`.
7. The browser polls the logs endpoint and renders output in real time.

For **Application** deployments (multi-repo), the platform additionally:
- Clones each service repository into its own subfolder
- Writes injected config files (`.env`, `nginx.conf`, etc.) to the remote via base64-encoded SSH commands
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
| `GET` | `/api/deployments/{id}/logs` | Fetch deployment logs |
| `POST` | `/api/deployments/{id}/rollback` | Roll back to previous version |
| `GET` | `/api/containers` | List Docker containers on a machine |
| `POST` | `/api/containers` | Deploy a Docker container |
| `GET` | `/api/github/repos` | List repositories for connected token |
| `GET` | `/api/github/me` | Check GitHub connection status |
| `POST` | `/api/github/token` | Save a GitHub PAT |
| `GET` | `/api/cloudflare/zones` | List Cloudflare zones |
| `GET` | `/api/cloudflare/tunnels` | List Cloudflare tunnels |
| `POST` | `/api/cloudflare/tunnels` | Create a Cloudflare tunnel |
| `WS` | `/ws/ssh` | Interactive SSH terminal relay |
