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

### Planned

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

## 11. Long-Term Vision

Arise eventually becomes a unified **Infrastructure Workspace** combining:

* SSH-native control plane
* Deployment engine with workflow DAG
* Runtime topology graph
* Cloud integrations (AWS, GCP, Azure, Hetzner, DO)
* Observability layer (metrics, traces, logs)
* Workflow / process builder
* Secrets management

for local, cloud, and hybrid infrastructure.
