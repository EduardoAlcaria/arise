# Arise — Feature Status

## 1. SSH & Remote Operations

### Existing

✅ SSH terminal via browser (xterm.js + WebSocket relay)
✅ Remote command execution
✅ Machine registration
✅ SSH health checks (scheduled every 5 min)
✅ Bastion/jump-host support (ProxyCommand per machine)
✅ TunnelType per machine: DIRECT / CLOUDFLARE_TCP / PROXY_COMMAND
✅ Test button with per-machine spinner + live card refresh

### Planned

* SSH multiplexing
* SSH config import (`~/.ssh/config`)
* Session persistence / reconnect
* SSH snippets / macros
* SSH-based file pipelines
* Multi-hop SSH support

---

## 2. Deployment System

### Existing

✅ Async deployments via RabbitMQ (transaction-safe publish with `afterCommit`)
✅ Stack detection (Node, Python, Java, Go, Docker Compose, etc.)
✅ Docker Compose deploys
✅ Rollbacks
✅ Real-time log streaming via SSE
✅ Multi-service (Application) deployments
✅ Injected config files (`.env`, `nginx.conf`, etc.) via SSH
✅ Cloudflare Tunnel creation + DNS automation during deploy
✅ DeploymentWatcher — GitHub Actions-style two-panel UI (step sidebar + live log panel)
✅ WebSocket push on completion — all browser tabs update without polling
✅ Post-deploy hooks queue (foundation, placeholder listener)

### Planned

* Deployment templates
* Blue/green deployments
* Canary deployments
* Deployment approvals
* Deployment health verification
* Automatic rollback on failure
* Deployment dependency graph
* Environment promotion flows (staging → production)
* Real webhook invocation for post-deploy hooks

---

## 3. CI/CD

### Existing

✅ GitHub Actions runner setup (SSH-based, runs on any registered machine)
✅ Workflow detection (`.github/workflows/*.yml`)
✅ Workflow run listing per repo
✅ Workflow dispatch (manual trigger)
✅ Workflow re-run
✅ Job step detail view
✅ All runners view (no repo filter required — aggregated across all repos)
✅ Runner deletion from UI

### Redesign (Planned)

* **Repo-card layout** — home view shows cards per repo (no filter required); click card to enter repo context
* Inside repo context: tabs for Runs, Workflows, Runners — identical feel to GitHub Actions
* Run detail view: full step log per job, same two-panel layout as DeploymentWatcher (step sidebar + live log)
* Runners shown per-repo and globally; add/remove from card UI
* No mandatory repo selection — all repos visible at a glance on load

### Other Planned

* Visual pipeline builder
* Queue visualization
* Artifact management
* Self-hosted runner pools
* Pipeline templates
* Scheduled jobs
* Deployment pipeline chaining

---

## 4. GitHub Integration

### Existing

✅ GitHub PAT connection
✅ Repository list (sorted by most recently pushed)
✅ Branch listing
✅ README rendering
✅ File tree browser (recursive)
✅ File content viewer in-panel
✅ Env var key extraction from `.env.example`
✅ Runner registration token generation

### Planned

* Webhook receiver (auto-trigger deploy on push)
* PR preview environments
* Commit status updates

---

## 5. Cloud Integrations

### AWS

#### Existing

✅ AWS account registration (profile-based)
✅ EC2 instance listing per region
✅ ECS cluster listing
✅ Lambda function listing
✅ AWS topology graph (EC2, ECS, Lambda nodes per VPC/region)
✅ Demo mode with mock data (no real credentials needed)

#### Planned

* EC2 provisioning
* SSM integration
* Security group visualization
* IAM role visualization
* Load balancer mapping
* Route53 integration
* ECR integration
* CloudWatch integration
* RDS visualization
* Real-time architecture graphs

---

### Cloudflare

#### Existing

✅ Tunnel creation
✅ DNS automation (CNAME)
✅ Ingress configuration
✅ Token validation on save
✅ Tunnel listing

#### Planned

* Full zone visualization
* Tunnel topology mapping
* Traffic visualization
* Access policy integration
* Tunnel health monitoring

---

### Terraform

#### Planned

* Terraform state parsing
* Resource graph visualization
* Dependency mapping
* Drift detection
* Apply / plan visualization
* Multi-workspace support

---

### Future Providers

* Google Cloud
* Azure
* Hetzner
* DigitalOcean
* Oracle Cloud

---

## 6. Infrastructure Graph / Visualization

### Existing

✅ Runtime topology graph (machines → deployments → tunnels + containers)
✅ AWS topology subgraph (EC2 instances, ECS clusters, Lambda — grouped by VPC)
✅ React Flow with Dagre auto-layout
✅ Node types: machine, deployment, tunnel, container, ec2, ecs-cluster, lambda

### Planned

* Unified graph (merge SSH topology + AWS + Cloudflare into one canvas)
* Animated payload / request flow
* Failed edge highlighting
* Queue congestion visualization
* Low-code architecture builder (drag/drop)

---

## 7. Observability

### Planned

* Prometheus ingestion
* Queue metrics
* Worker metrics
* Deployment metrics
* Machine metrics
* OpenTelemetry / distributed tracing
* Runtime correlation (deployments ↔ infrastructure ↔ logs ↔ failures)

---

## 8. Containers & Orchestration

### Existing

✅ Docker image deployment on remote machines (SSH + docker run)
✅ Container lifecycle management (start / stop / remove)
✅ Container log viewing

### Planned

* SSH-native Docker control (no local daemon required)
* Compose visualization
* Container topology graph
* Registry management
* Image pipelines / remote build cache

---

## 9. Secrets & Security

### Existing

✅ Infisical integration (authenticate, list/get secrets)

### Planned

* Secret injection into deployments from Infisical
* SSH key encryption at rest
* RBAC
* Audit logging
* Vault support / KMS integration

---

## 10. Team & Collaboration

### Planned

* Organizations / Teams
* Shared environments
* Role permissions
* Deployment approvals
* Shared dashboards

---

## 11. Dashboard — Global Ops Center (Planned)

Replace current dashboard with a unified global overview:

* **World globe** (3D, black & white, spinning) as the primary visual — each region lights up with active resources
* Click region → drill into services running in that region
* Click service → full detail view (e.g. S3 → all buckets, EC2 → all instances)
* **Machine telemetry tiles** — per-machine avg CPU, RAM usage, disk I/O
* **Cloudflare status panel** — live Cloudflare service health (from Cloudflare status API)
* **AWS global instability feed** — AWS service health dashboard integration
* **Cloudflare instability feed** — Cloudflare incident tracker
* **Averages bar** — avg CPU/RAM across all registered machines
* **Graph panels** — time-series for deployments, failures, queue depth, SSH sessions

---

## 12. Telemetry Page (Planned)

Dedicated observability page (separate from dashboard):

* Per-machine metrics: CPU, RAM, disk, network (polled via SSH or agent)
* Time-series charts (1h / 24h / 7d / 30d views)
* Deployment correlation overlay (mark deploys on metric timelines)
* AWS CloudWatch metric integration (EC2, ECS, Lambda)
* Queue depth & worker metrics from RabbitMQ
* Alert thresholds with notification via WebSocket push

---

## 13. AWS — Full Service Explorer (Planned)

* **World globe entry point** — click region to see all services in that region
* **Universal service filter** — list every AWS service present in an account, not just EC2/S3/ECS
* Services to add: Lambda, RDS, DynamoDB, CloudFront, SQS, SNS, ElastiCache, API Gateway, ECR, Route53, IAM roles
* Per-service detail views (e.g. RDS → instances + parameter groups, Lambda → function list + invocation metrics)
* Region selector persisted in localStorage (already done)

---

## 14. Long-Term Vision

Arise eventually becomes a unified **Infrastructure Workspace** combining:

* SSH-native control plane
* Deployment engine with workflow DAG
* Runtime topology graph + 3D globe entry point
* Cloud integrations (AWS, GCP, Azure, Hetzner, DO)
* Observability layer (metrics, traces, logs)
* Workflow / process builder
* Secrets management
* Global ops center dashboard

for local, cloud, and hybrid infrastructure.
