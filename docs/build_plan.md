# AutomationCenter — Technical Build Plan

## Stack

### Backend
| Layer | Technology | Version |
|---|---|---|
| Runtime | Java | 21 |
| Framework | Spring Boot | 3.3.5 |
| Security | Spring Security + JJWT | 3.3.5 / 0.12.3 |
| Persistence | Spring Data JPA + Hibernate | 3.3.5 |
| Database | PostgreSQL | 16 |
| Cache | Spring Data Redis | 3.3.5 |
| Messaging | Spring AMQP + RabbitMQ | 3.3.5 / 3.13 |
| SSH client | JSch (com.github.mwiede) | 0.2.19 |
| Docker API | docker-java + httpclient5 | 3.3.6 |
| GitHub API | org.kohsuke:github-api | 1.321 |
| Utilities | Lombok, MapStruct | latest |
| Build | Maven | 3.x |

### Frontend
| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 20+ |
| Bundler | Vite | 5 |
| Language | TypeScript | 5 |
| UI library | React | 18 |
| Components | shadcn/ui + Radix UI | latest |
| State | Zustand | 4 |
| Data fetching | TanStack Query | 5 |
| HTTP client | Axios | 1.x |
| Routing | React Router | 6 |
| Styling | Tailwind CSS | 3 |

### Infrastructure (docker-compose)
- PostgreSQL 16 — single DB automation_db
- Redis 7.2 — session cache, rate limiting
- RabbitMQ 3.13 — async deployment events

---

## Repository Structure


AutomationCenter/
├── backend/
│   ├── pom.xml
│   └── src/main/java/com/automationcenter/
│       ├── AutomationCenterApplication.java
│       ├── config/
│       │   ├── SecurityConfig.java
│       │   └── RabbitMQConfig.java           (pending)
│       ├── controller/
│       │   ├── AuthController.java
│       │   ├── MachineController.java
│       │   ├── ContainerController.java
│       │   ├── DeploymentController.java
│       │   ├── LogController.java
│       │   ├── GitHubController.java         (pending)
│       │   └── CloudflareController.java     (pending)
│       ├── service/
│       │   ├── AuthService.java
│       │   ├── MachineService.java
│       │   ├── SshService.java
│       │   ├── ContainerDeploymentService.java
│       │   ├── DockerService.java
│       │   ├── DeploymentService.java
│       │   ├── LogService.java
│       │   ├── GitHubService.java            (pending)
│       │   └── CloudflareService.java        (pending)
│       ├── entity/
│       │   ├── User.java + Role.java
│       │   ├── Machine.java + MachineStatus.java
│       │   ├── ContainerDeployment.java + ContainerStatus.java
│       │   ├── Deployment.java + DeploymentStatus.java + DeploymentType.java
│       │   └── LogEntry.java + LogLevel.java
│       ├── repository/
│       │   ├── UserRepository.java
│       │   ├── MachineRepository.java
│       │   ├── ContainerDeploymentRepository.java
│       │   ├── DeploymentRepository.java
│       │   └── LogEntryRepository.java
│       ├── dto/
│       │   ├── auth/       RegisterRequest, LoginRequest, AuthResponse
│       │   ├── machine/    MachineRequest, MachineResponse, SshCommandRequest, SshCommandResponse
│       │   ├── container/  ContainerDeployRequest, ContainerDeploymentResponse
│       │   ├── deployment/ DeploymentRequest, DeploymentResponse
│       │   ├── github/     (pending)
│       │   └── cloudflare/ (pending)
│       ├── security/
│       │   ├── JwtService.java
│       │   └── JwtAuthFilter.java
│       └── exception/
│           ├── GlobalExceptionHandler.java
│           ├── ResourceNotFoundException.java
│           └── EmailAlreadyExistsException.java
├── frontend/                                  (pending)
├── docker-compose.yml
└── docs/build_plan.md


---

## Data Model

### User

id, email (unique), password (bcrypt), name, role (USER|ADMIN), created_at

Implements UserDetails. JWT auth, stateless session.

### Machine

id, name, host, port, ssh_user, private_key (TEXT), status (ONLINE|OFFLINE|UNKNOWN|ERROR),
last_seen, created_at, owner_id → users

SSH connectivity tested via echo ok. Scheduled ping every 60s.

### ContainerDeployment

id, name, image, host_port, container_port, env_vars (collection table),
container_id, status (PENDING|PULLING|RUNNING|STOPPED|FAILED|REMOVED),
machine_id → machines, owner_id → users, created_at, updated_at

Deployed via Docker Engine REST API on target machine (tcp://host:2375).

### Deployment

id, name, type (REPOSITORY|CONTAINER), status (PENDING|BUILDING|DEPLOYING|SUCCESS|FAILED|ROLLED_BACK),
repository_url, branch, logs (TEXT), version, machine_id → machines,
owner_id → users, started_at, finished_at, created_at

Async execution via @Async. Repository deploy uses SSH to git clone/pull.

### LogEntry

id, deployment_id, message (TEXT), level (INFO|WARN|ERROR|DEBUG), created_at

Indexed on deployment_id and created_at.

---

## API Endpoints

### Auth — /api/auth
| Method | Path | Description |
|---|---|---|
| POST | /register | Register user, return JWT |
| POST | /login | Authenticate, return JWT |

### Machines — /api/machines
| Method | Path | Description |
|---|---|---|
| POST | / | Register machine |
| GET | / | List own machines |
| GET | /{id} | Get machine |
| PUT | /{id} | Update machine |
| DELETE | /{id} | Delete machine |
| POST | /{id}/test | SSH connectivity check |
| POST | /{id}/exec | Run arbitrary SSH command |

### Containers — /api/containers
| Method | Path | Description |
|---|---|---|
| POST | / | Deploy container image to machine |
| GET | / | List own container deployments |
| GET | /{id} | Get container deployment |
| POST | /{id}/stop | Stop container |
| POST | /{id}/restart | Restart container |
| DELETE | /{id} | Remove container |
| GET | /{id}/logs | Tail 200 lines of container logs |

### Deployments — /api/deployments
| Method | Path | Description |
|---|---|---|
| POST | / | Create deployment (async execution) |
| GET | / | List own deployments (paginated) |
| GET | /{id} | Get deployment |
| POST | /{id}/rollback | Mark as rolled back |

### Logs — /api/deployments/{deploymentId}/logs
| Method | Path | Description |
|---|---|---|
| GET | / | Get all log entries for deployment |

### GitHub — /api/github (pending)
| Method | Path | Description |
|---|---|---|
| POST | /token | Save GitHub token |
| GET | /repos | List user repositories |
| GET | /repos/{owner}/{repo}/branches | List branches |

### Cloudflare — /api/cloudflare (pending)
| Method | Path | Description |
|---|---|---|
| POST | /token | Save Cloudflare token |
| GET | /zones | List zones/domains |
| POST | /tunnels | Create tunnel |
| GET | /tunnels | List tunnels |

---

## Execution Model

*SSH-based (current MVP).* All remote operations go through SshService.execute():
- Opens JSch session with private key
- Runs command via ChannelExec
- Returns stdout, stderr, exit code
- 30s connection timeout

*Docker API.* DockerService builds a DockerClient against tcp://host:2375 (Docker daemon must have TCP enabled on target). Sequence: pull image → create container with port bindings and env → start.

*Async deployments.* DeploymentService.executeAsync() runs @Async — clones repo via SSH, appends logs to LogEntry table.

*Machine health.* @Scheduled(fixedDelay=60_000) pings all machines with echo ok via SSH, updates MachineStatus.

---

## Security

- JWT HS256, 24h expiry, secret via jwt.secret property
- JwtAuthFilter validates token on every request
- All endpoints except /api/auth/** and /actuator/** require valid JWT
- User owns resources — all queries filter by owner_id
- Private keys stored as plaintext TEXT in DB (TODO: encrypt at rest with AES before prod)
- CORS allows localhost:3000 and localhost:5173

---

## Remaining Work

### Backend (pending)
- [ ] RabbitMQConfig — queues for deployment events
- [ ] GitHubService — list repos/branches via org.kohsuke:github-api
- [ ] GitHubController — CRUD for GitHub token + repo listing
- [ ] CloudflareService — zones + tunnel management via Cloudflare REST API (WebClient)
- [ ] CloudflareController
- [ ] Stack auto-detection for repo deploys (detect package.json, pom.xml, Dockerfile)
- [ ] Credential encryption at rest
- [ ] SSE endpoint for streaming live deployment logs

### Frontend (pending)
- [ ] Scaffold — npm create vite, TypeScript, React 18
- [ ] shadcn/ui init + Tailwind
- [ ] Axios client with JWT interceptor (src/api/client.ts)
- [ ] Zustand auth store (src/stores/authStore.ts)
- [ ] Pages: Login, Register
- [ ] Pages: Dashboard (deployment summary + machine status)
- [ ] Pages: Machines (list, register, test connection)
- [ ] Pages: Containers (deploy form, list, stop/restart/remove, logs)
- [ ] Pages: Deployments (create, list, detail, rollback)
- [ ] Pages: GitHub (connect token, browse repos)
- [ ] Pages: Cloudflare (connect token, zones, tunnels)

### Infra (pending)
- [ ] Dockerfiles for backend and frontend
- [ ] Add backend + frontend services to docker-compose.yml
- [ ] application-prod.yml with env-var overrides

---

## Dev Setup

bash
# Start infra
docker-compose up -d

# Run backend
cd backend && mvn spring-boot:run

# Run frontend (once scaffolded)
cd frontend && npm run dev


Backend runs on :8080. Frontend dev server on :5173.