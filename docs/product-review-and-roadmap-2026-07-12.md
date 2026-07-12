# Arise — Product Review & Roadmap to a Complete App

*Date: 2026-07-12 — strategic review requested by the owner.*

This doc answers: **is Arise good, what's missing to make it a real usable
product, how does it compare to similar apps, what to improve in the frontend,
how to ship a desktop version with Tauri, and what tech to reuse instead of
reinventing.**

---

## 1. Verdict — is this project good?

**Yes — the idea and the wedge are strong.** Honest read:

**What makes it good / differentiated**
- **Agentless, SSH-native control plane.** Arise controls machines you *already
  own* over pure SSH — no agent installed, no ports opened on the target. That is
  a genuinely different posture from Coolify/Dokploy/CapRover, which want to *be*
  the PaaS installed on a VPS and own that host.
- **Breadth as a cockpit.** Browser SSH terminal + deploy engine + GitHub Actions
  runners + AWS read-only topology + Cloudflare tunnel automation + Infisical, all
  in one dashboard. None of the mainstream PaaS tools try to be an "infra
  workspace / visibility layer" over heterogeneous machines and clouds.
- **The topology graph is the signature feature.** A live map of machines →
  deployments → tunnels (and AWS) is something the competitors don't have. This is
  the thing to lean into.

**The honest weaknesses (why the owner is right that it's "a long road")**
- **Breadth over depth.** Many features are one layer deep; competitors are deeper
  on the core deploy loop (preview envs, backups, S3, one-click apps).
- **Single-user.** No orgs/teams/RBAC/audit log — blocks real team use.
- **Secrets not wired.** Infisical integration exists in code but is **not set up /
  not injected into deploys** yet. Credentials work but the "everything through
  Infisical" vision isn't realized.
- **No backups / restore, no metrics/telemetry** (both are on the roadmap, none
  built).
- **Thin test coverage.** Helper unit tests only; no controller/integration tests;
  the SSH deploy pipeline itself is untested.
- **Reliability pass done** (timeouts, health gate, reconciler) but not
  battle-tested under real load / flaky networks.

**Bottom line:** the concept is fundable-quality. The gap to "complete" is not
more features — it's **depth, trust, and polish** on the core loop.

---

## 2. Competitive landscape (where Arise sits)

| Tool | Model | Strength | Arise's angle vs it |
|---|---|---|---|
| **Coolify** | PaaS installed on a VPS it owns | Most feature-rich: preview envs, S3, backups, polished UI | Arise is agentless over SSH; a *cockpit over many existing machines*, not an owner of one VPS. Topology + terminal + multi-cloud read are things Coolify lacks. |
| **Dokploy** | Lightweight PaaS (Docker Swarm) | Very light (~350MB), clean UI, native compose | Arise does multi-repo Application compose + tunnels + AWS/CF visibility Dokploy doesn't. |
| **CapRover** | Mature single-container PaaS | Stability, one-click apps | Dated UI, weak compose. Arise is more modern and broader. |
| **Portainer** | Docker/K8s management UI | Deep container/cluster ops | Arise adds deploy-from-git + tunnels + topology; Portainer is pure container mgmt. |
| **Termius** | SSH client | Best-in-class terminal UX: tabs, snippets, port-forward wizard, encrypted vault sync, session logs, multiplayer | Arise's browser terminal is basic by comparison — big room to borrow ideas (see §5). |

**Positioning to commit to:** *"The cockpit for infrastructure you already run —
SSH-native deploys, a live topology map, and a browser terminal, over any machine
or cloud, self-hosted."* Not "another VPS PaaS."

---

## 3. What's missing for a "complete", usable app

Grouped by what actually blocks real use, most important first.

### 3.1 Trust & data safety (blockers)
- [ ] **Wire Infisical for real** — inject secrets into deploys instead of pasting
      env values; make it the source of truth for credentials (owner's stated
      preference). The integration exists — connect it end to end.
- [ ] **Backups & restore** — `pg_dump` of Arise's own DB on a schedule; and a
      per-deployment volume backup (restic/borg over SSH). Without this, nobody
      trusts it with real apps.
- [ ] **Audit log** — who deployed/rolled back/changed a machine, when.
- [ ] **Secret redaction everywhere** — already done for git clone URLs; audit
      logs, SSE, and terminal for token leaks.

### 3.2 Multi-user / real deployment (blockers for teams)
- [ ] **Orgs / teams / roles (RBAC)** — even a minimal owner/member split.
- [ ] **Shared machines & environments** with per-resource permissions.

### 3.3 Core-loop depth (what competitors have)
- [ ] **Automatic rollback on failed health gate.**
- [ ] **Deployment templates** (save a repo+branch+config+tunnel as a reusable
      template).
- [ ] **PR preview environments** (webhook receiver already auto-redeploys — extend
      to ephemeral per-PR deploys). This is Coolify's headline feature.
- [ ] **Environment promotion** (staging → prod).

### 3.4 Observability (roadmap, none built)
- [ ] **Machine telemetry** — CPU/RAM/disk sampled over SSH on the existing ping
      schedule; show tiles + sparklines.
- [ ] **Queue depth / worker metrics** from RabbitMQ management API.
- [ ] **Deployment metrics** — success rate, duration, failure feed.

### 3.5 Polish / correctness (small but visible)
- [ ] Loading skeletons across pages (Dashboard flashes `0/0` on load).
- [ ] Consistent error states (Login/Register have almost none; AWS is rich —
      standardize on one pattern).
- [ ] Fix silent failure in `GitHubService.getFileContent` (unchecked cast → `""`).
- [ ] Onboarding flow / empty-state first-run guide.
- [ ] Split monster files: `pages/AWS.tsx` (1478 LOC), `DeployRepoWizard.tsx`
      (1113 LOC).
- [ ] Controller/integration tests for the auth + deploy flow.

---

## 4. Prioritized plan (phases)

**Phase 1 — Make it trustworthy (2–3 focused sessions)**
1. Wire Infisical secret injection into single-repo + Application deploys.
2. Arise DB backup (scheduled `pg_dump`) + documented restore.
3. Audit log entity + interceptor on mutating endpoints.
4. Loading skeletons + standardized error component across all pages.
5. Fix `getFileContent` silent failure; add 2–3 controller tests.

**Phase 2 — Depth on the core loop**
6. Auto-rollback on health-gate failure.
7. Deployment templates.
8. PR preview environments (extend the existing webhook receiver).

**Phase 3 — Observability**
9. SSH machine telemetry (CPU/RAM/disk) on the ping schedule → tiles + sparklines.
10. RabbitMQ queue-depth + deploy-metrics panel.
11. Rebuild the Dashboard as a real ops center (see §6).

**Phase 4 — Teams**
12. Orgs/roles/RBAC + shared resources.

**Phase 5 — Desktop (Tauri)** — see §7. Can start in parallel as a thin client.

*Cut / defer:* the "3D spinning globe" ops center. It's eye-candy that competes
for the time a dense, useful ops dashboard needs. Ship the useful version first,
globe later if ever.

---

## 5. Frontend review — what to improve

Structure is clean: 10 routes, collapsible sidebar, TanStack Query + WS/SSE
realtime, React Flow topology, xterm terminal. Solid base. Gaps:

### Terminal (borrow from Termius)
Current: single-session **modal**, one machine, no tabs, no snippets, no search,
no reconnect.
- **Dedicated terminal page with multi-tab + split view** (not just a modal).
- **Snippets** — saved commands run over SSH with one click (the `exec` endpoint
  already exists; add a snippets store). This is Termius's most-loved feature and
  cheap to add.
- **Port-forwarding UI** — JSch supports `setPortForwardingL`; add a small wizard
  (Termius-style) to open a local tunnel to a remote port.
- xterm addons to add: `@xterm/addon-search` (buffer search),
  `@xterm/addon-web-links`, `@xterm/addon-webgl` (perf), `@xterm/addon-serialize`
  (save/replay a session — Arise already persists deploy logs, extend to terminal).
- Reconnect on drop instead of a dead `[disconnected]` line.

### Topology / AWS / architecture view
Already on React Flow (the right choice — don't reinvent).
- **Unified graph** — merge SSH topology + AWS + Cloudflare onto one canvas with
  layer toggles (roadmap already wants this).
- Add **minimap + controls + node search** (search exists), **VPC grouping
  rectangles**, and **animated edges** for active request/deploy flow tied to SSE
  events.
- **Export to PNG/SVG** and **save layout** per user.
- Consider `elkjs` if dagre layouts get cramped; otherwise keep dagre.

### Dashboard
See §6 — it's the weakest page and the highest-leverage redesign.

### General
- Skeletons + standardized error/empty states.
- A global command palette (⌘K) to jump to any machine/deploy/repo — high
  perceived-quality, low cost (e.g. `cmdk`).

---

## 6. Dashboard — my honest take

Current Dashboard (`pages/Dashboard.tsx`, 118 LOC): 4 stat cards + a Machines list
+ a Recent Deployments list. Empty-states are nicely done. But:

- **No loading state** → shows `0/0` on first paint, reads as broken/empty.
- **No operational signal** — no failure feed, no queue depth, no machine health,
  no activity timeline, no quick actions. It's a summary, not a cockpit.

**Direction:** make it a dense, live **ops center** (skip the globe for now):
- KPI row with **sparklines** (deploys/day, success rate, active tunnels, machines
  online) — not just static numbers.
- **Machine health tiles** — CPU/RAM/disk (once §3.4 telemetry lands).
- **Failure feed** — recent FAILED deploys with one-click "view logs / redeploy".
- **Queue depth** — pending/running deployments from RabbitMQ.
- **Activity timeline** — audit-log stream.
- **Quick actions** — deploy, register machine, open terminal.

This turns the landing page from "numbers" into "what needs my attention right
now," which is the whole point of an ops tool.

---

## 7. Tauri desktop — mapping

Goal: ship Arise as a desktop app (React front + Spring back) via Tauri (Rust
shell). The catch: **Spring is a heavy JVM backend and Arise depends on Postgres +
RabbitMQ + Redis** — you can't casually bundle four servers into a desktop app.
Two realistic modes:

### Mode A — Thin desktop client (recommended first, days not weeks)
Tauri wraps the **existing React frontend** as the webview; it points at a
user-configured Arise backend URL (their self-hosted server). **No backend
bundling.** You immediately gain:
- Native OS **deploy-completion notifications** (Tauri notification API + the
  existing `/ws/notifications` stream).
- **System tray** with machine/deploy status.
- **Multi-window terminals** (each SSH session its own OS window).
- Deep links, native menus, auto-update.

This is a genuine desktop app with almost no backend change — just a Vite build
target + a thin Tauri shell that stores the backend URL and JWT.

### Mode B — Full local single-binary (big, later)
A true "download and run" desktop Arise needs the backend + datastores embedded:
- **Spring as a Tauri sidecar** via `externalBin`. Best packaging:
  **GraalVM `native-image`** → a single native executable, ~sub-second startup, no
  JVM to ship. (Fallback: `jpackage`/`jlink` a trimmed JRE + jar + launcher
  script; heavier, slower start.)
- **Replace the server dependencies for desktop:**
  - Postgres → embedded **SQLite/H2** behind a JPA profile (needs the code to stay
    datastore-agnostic — mostly true via Spring Data).
  - RabbitMQ → an **in-JVM queue** (Spring events / a bounded executor) behind the
    same listener interface.
  - Redis → **Caffeine** in-process cache.
- Tauri spawns the sidecar on launch, waits for `/actuator/health`, then loads the
  UI; kills it on exit.

**Recommendation:** do **Mode A** now (huge UX win, tiny cost), and only invest in
Mode B if "zero-dependency local install" becomes a real requirement. Track the
datastore-abstraction work so Mode B stays possible.

*Reference implementations:* Tauri's own sidecar guide, `Matthew-w56/tauri-with-
java-backend`, and Evil Martians' Rust+Tauri+sidecar writeup (see Sources).

---

## 8. Tech to leverage — don't reinvent the wheel

| Need | Use (already in project or standard) | Don't build |
|---|---|---|
| Terminal emulator | **xterm.js** + addons (search, webgl, serialize) — already in | a custom emulator |
| Infra graph | **React Flow (@xyflow)** + dagre/elkjs — already in | a custom canvas/graph engine |
| SSH + tunnels | **JSch (mwiede)** incl. `setPortForwardingL` for port-forward UI | a new SSH stack |
| Secrets | **Infisical** (integration exists) — wire injection | a custom vault |
| Container mgmt | **docker-java** (already in) / SSH `docker` — fine | a custom Docker client |
| Metrics | sample via SSH (top/free/df) on the existing ping schedule; or Prometheus node_exporter later | a bespoke agent |
| Realtime | existing **WebSocket + SSE** — sufficient | socket.io |
| Desktop shell | **Tauri v2** + externalBin sidecar; GraalVM native-image for the backend | Electron (heavier) |
| Command palette | **cmdk** | custom |
| Auth/teams | extend **Spring Security** (already in) with roles | a new auth framework |
| IaC / `.arise.yml` | keep the **minimal manifest** (documented in `docs/arise-yml.md`) + lean on Compose; optionally *generate* Terraform | a brand-new IaC DSL |

On the `.arise.yml` IaC question (the old TODO): **don't invent a custom IaC
language.** Keep the small manifest for hints, let Compose be the orchestration
truth, and if you want cloud IaC later, *emit* Terraform rather than parse a
homegrown notation.

---

## Sources
- [Tauri — Embedding External Binaries (sidecar)](https://v2.tauri.app/develop/sidecar/)
- [Java sidecar for a Tauri app (ITNEXT)](https://itnext.io/java-sidecar-for-a-tauri-angular-app-781a5d7d6db)
- [Matthew-w56/tauri-with-java-backend](https://github.com/Matthew-w56/tauri-with-java-backend)
- [Evil Martians — Rust + Tauri + sidecar](https://evilmartians.com/chronicles/making-desktop-apps-with-revved-up-potential-rust-tauri-sidecar)
- [Dokploy vs Coolify vs CapRover 2026 (MassiveGRID)](https://massivegrid.com/blog/dokploy-vs-coolify-vs-caprover/)
- [Best Self-Hosted PaaS 2026 (ServerCompass)](https://servercompass.app/blog/best-self-hosted-paas-platforms-2026)
- [Termius — Modern SSH Client](https://termius.com/index.html)
- [Termius documentation — Vaults](https://termius.com/documentation/set-up-vaults)
