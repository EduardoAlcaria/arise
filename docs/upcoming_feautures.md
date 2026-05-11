# Arise — Planned / Discussed Feature Graph

## 1. SSH & Remote Operations

### Existing

✅ SSH terminal via browser
✅ Remote command execution
✅ Machine registration
✅ SSH health checks
✅ Bastion/jump-host support (ProxyCommand per machine — enables cloudflared SSH tunnels, bastion hosts, any `%h/%p` proxy)

### Planned

* SSH multiplexing
* SSH config import (`~/.ssh/config`)
* Session persistence
* Reconnect/recovery
* SSH snippets/macros
* SSH-based Docker management
* SSH-based file pipelines
* SSH transfer acceleration
* Multi-hop SSH support

---

# 2. Deployment System

### Existing

✅ Async deployments
✅ Stack detection
✅ Docker Compose deploys
✅ Rollbacks
✅ Real-time logs
✅ Multi-service deployments

### Planned

* Deployment templates
* Blue/green deployments
* Canary deployments
* Deployment approvals
* Deployment health verification
* Automatic rollback on failure
* Deployment dependency graph
* Deployment history visualization
* Environment promotion flows
* Staging → production pipelines

---

# 3. CI/CD

### Existing

✅ GitHub Actions runner setup backend
✅ Workflow detection
✅ Workflow run listing

### Planned

* CI/CD frontend
* Visual pipeline builder
* Queue visualization
* Artifact management
* Distributed runners
* Self-hosted runner pools
* Pipeline templates
* Trigger system
* Scheduled jobs
* Remote build orchestration
* Deployment pipeline chaining

---

# 4. Cloud Integrations

## AWS

### Planned

* EC2 management
* EC2 provisioning
* SSM integration
* Security group visualization
* VPC visualization
* Subnet visualization
* IAM role visualization
* Load balancer mapping
* Route53 integration
* ECS support
* ECR integration
* CloudWatch integration
* RDS visualization
* Lambda topology visualization
* Runtime AWS architecture graphs

---

## Terraform

### Planned

* Terraform state parsing
* Resource graph visualization
* Dependency mapping
* Drift detection
* Runtime correlation
* Apply visualization
* Plan visualization
* Multi-workspace support

---

## Cloudflare

### Existing

✅ Tunnel creation
✅ DNS automation
✅ Ingress configuration

### Planned

* Full zone visualization
* Tunnel topology mapping
* Traffic visualization
* Access policy integration
* Tunnel health monitoring

---

## Future Providers

### Planned

* Google Cloud
* Azure
* Hetzner
* DigitalOcean
* Oracle Cloud

---

# 5. Infrastructure Graph / Visualization

## Planned Core Feature

### Runtime Infrastructure Graph

Visual representation of:

* services
* machines
* containers
* queues
* databases
* cloud resources
* deployment relationships

---

## Planned Runtime Flow Visualization

### Payload Flow

Animated:

* request flow
* queue movement
* deployment propagation
* worker execution

Example:

```text id="k9v3zn"
Gateway
↓
API
↓
Queue
↓
Worker
↓
Database
```

---

## Planned Failure Visualization

* failed edges turn red
* unhealthy nodes dim
* queue congestion visible
* deployment propagation visible

---

## Planned Architecture Builder

Low-code infra modeling:

* drag/drop infrastructure blocks
* connect services visually
* deploy from topology

---

# 6. Workflow / Process Builder

## Planned

### Workflow DAG Engine

* visual workflows
* dependency graphs
* retries
* rollback chains
* conditional execution

---

## Planned Workflow Types

* deployment workflows
* infrastructure provisioning
* transfer pipelines
* maintenance operations
* scheduled workflows

---

## Planned Triggers

* GitHub webhooks
* schedules
* deployment events
* metrics thresholds
* manual approvals

---

# 7. Observability

## Planned

### Operational Observability

Focus:

* deployments
* runtime relationships
* operational health
* infrastructure cognition

---

## Planned Metrics Integration

* Prometheus ingestion
* queue metrics
* worker metrics
* deployment metrics
* machine metrics

---

## Planned Runtime Correlation

Correlate:

* deployments
* infrastructure
* logs
* failures
* runtime state

---

## Planned Tracing

* OpenTelemetry
* distributed tracing
* request visualization

---

# 8. File Transfer & Sync

## Planned

### Managed Transfer Pipelines

* resumable uploads
* chunked transfers
* transfer validation
* throughput monitoring
* transfer queues

---

## Planned Sync Features

* remote sync
* incremental sync
* scheduled sync
* remote archival
* transfer workflows

---

# 9. Containers & Orchestration

## Existing

✅ Docker deployment
✅ Container lifecycle management

---

## Planned

* SSH-native Docker control
* Compose visualization
* Container topology graph
* Registry management
* Image pipelines
* Remote build cache
* Service dependency graphs

---

# 10. Secrets & Security

## Existing

✅ Infisical integration

---

## Planned

* Secret injection pipelines
* Secret scoping
* RBAC
* Audit logging
* Credential encryption
* Vault support
* KMS integration

---

# 11. Team & Collaboration

## Planned

* Organizations
* Teams
* Shared environments
* Role permissions
* Deployment approvals
* Operational comments
* Shared dashboards

---

# 12. Infrastructure Cognition Layer

## One of the Main Planned Directions

### Goal

Help operators understand:

* what exists
* how it connects
* what changed
* where failures happen
* runtime relationships
* operational dependencies

---

## Planned Unified Model

```text id="x5j8vd"
Terraform
+
Cloud APIs
+
SSH Runtime
+
Deployments
+
Containers
+
Queues
+
Metrics
+
Logs
```

→ unified operational graph

---

# 13. Long-Term Vision

## Arise Eventually Becomes

```text id="h8m2rp"
Infrastructure Workspace
+
Operational Runtime
+
Deployment Engine
+
Workflow Orchestrator
+
Runtime Topology Graph
+
SSH-native Control Plane
```

for:

* local infra
* cloud infra
* hybrid infra
* self-hosted systems
* operational automation
