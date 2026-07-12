# Plan — Turn Arise into a Genuinely Good Product

*Date: 2026-07-12. Execution plan derived from
`docs/product-review-and-roadmap-2026-07-12.md`. Each item is a concrete task
with where/why so it can be picked up directly. Checkboxes track progress.*

> Commit discipline: one file change = one commit = one push (established
> workflow). Pushes use the `EduardoAlcaria` GitHub account.

---

## Test status (answer: weak — this is the #1 quality gap)

| Metric | Now |
|---|---|
| Main Java source files | **107** |
| Backend test files | **6** |
| Controllers tested | **0 / 14** |
| Services meaningfully tested | helpers only (parser, tracker, reconciler, line/utf8); **0** of the big ones (DeploymentService, SshService, GitHubService, CloudflareService, AwsService, CicdService) |
| Frontend tests | **0** (no vitest/jest/testing-library installed) |
| CI pipeline | **none** — no `.github/workflows`, nothing runs tests automatically |
| Local run | **blocked** — no Maven (`mvn`) on PATH and no `mvnw` wrapper; JDK 21 is installed |

**Read:** for a tool whose whole job is CI/CD and remote deploys, the test story
is thin and there is no automation gate. The existing tests are good (they cover
the tricky parsers/streaming), but the risky surfaces — the SSH deploy pipeline,
auth, webhook HMAC — are untested. Fixing this is Workstream 0 below.

---

## Workstream 0 — Testability & CI (do first; unblocks everything)

- [ ] **Add a Maven wrapper** (`mvnw`/`mvnw.cmd`) so the build runs without a
      system Maven. `mvn -N wrapper:wrapper` (once, from a machine with Maven) or
      commit the wrapper files.
- [ ] **GitHub Actions CI** — `.github/workflows/ci.yml`: build + `mvn test` on
      push/PR; frontend `npm ci && npm run build`. Arise is a CI/CD tool with no
      CI — fix the optics and the safety net.
- [ ] **Frontend test setup** — add **Vitest + @testing-library/react**; one smoke
      test per page render to start.
- [ ] **Controller slice tests** — `@WebMvcTest` for `AuthController`,
      `DeploymentController`, `WebhookController` (HMAC verify path is
      security-critical and currently untested).
- [ ] **Service tests with a mocked `SshService`** — cover `DeploymentService`
      happy path + health-gate FAILED path + tunnel-failure-stays-SUCCESS path.
      `SshService` is the seam: inject a fake that returns canned
      `SshCommandResponse`s.

---

## Workstream 1 — Trust & data safety (blockers for real use)

- [ ] **Wire Infisical secret injection** *(owner priority — currently not set
      up)*. `InfisicalService` can auth + list secrets; connect it to the deploy
      path so a deployment can pull env values from Infisical instead of pasted
      text. Files: `InfisicalService.java`, `DeploymentService` config-write step,
      `DeployRepoWizard.tsx` (source = Infisical option).
- [ ] **Arise DB backup** — scheduled `pg_dump` of `automation_db` to a
      configurable location; documented restore. New `BackupService` +
      `@Scheduled`.
- [ ] **Per-deployment volume backup** — restic/borg over SSH before a redeploy /
      rollback, so data survives a bad deploy.
- [ ] **Audit log** — `AuditEntry` entity + an interceptor/aspect on mutating
      endpoints (who/what/when). Surface it in the Dashboard activity feed.
- [ ] **Secret redaction audit** — extend the existing `sanitizeGitOutput`
      approach to audit logs, SSE, and the terminal relay; grep for token leakage.

---

## Workstream 2 — Core-loop depth (match the competition)

- [ ] **Auto-rollback on failed health gate** — when `composeHealthy` returns
      false, optionally re-enter the previous `deployDir` and bring it back up
      (rollback logic already exists in `DeploymentService`).
- [ ] **Deployment templates** — persist a repo+branch+config+tunnel set as a
      reusable template; one-click deploy. New entity + endpoints + wizard entry.
- [ ] **PR preview environments** — extend `WebhookController` (which already
      auto-redeploys on push): on `pull_request` opened/synchronized, spin an
      ephemeral deployment with a per-PR tunnel; tear down on close. This is
      Coolify's headline feature and Arise is one step away.
- [ ] **Environment promotion** — mark a deployment env (dev/staging/prod) and
      support promote (re-deploy same commit to the next env).

---

## Workstream 3 — Observability

- [ ] **Machine telemetry over SSH** — on the existing 60s ping in
      `MachineService.pingAll`, also sample `top`/`free`/`df` and store a rolling
      window. New `MachineMetric` entity (or in-memory ring + Redis).
- [ ] **Telemetry tiles + sparklines** on Machines + Dashboard.
- [ ] **RabbitMQ queue-depth** panel via the management API (pending/running
      deploys).
- [ ] **Deploy metrics** — success rate, duration, failure feed (derive from
      `Deployment` rows).

---

## Workstream 4 — Dashboard redesign (ops center, not a globe)

Rebuild `pages/Dashboard.tsx` from "4 cards + 2 lists" into a live cockpit:

- [ ] **Loading skeletons** (kills the `0/0` flash) — do this repo-wide, not just
      here.
- [ ] KPI row with **sparklines** (deploys/day, success rate, active tunnels,
      machines online).
- [ ] **Machine health tiles** (CPU/RAM/disk — needs Workstream 3).
- [ ] **Failure feed** with one-click view-logs / redeploy.
- [ ] **Queue depth** widget.
- [ ] **Activity timeline** (from the audit log).
- [ ] Defer the 3D globe indefinitely.

---

## Workstream 5 — Frontend / terminal (borrow from Termius)

- [ ] **Dedicated terminal page** with **multi-tab + split view** (today it's a
      single-session modal — `TerminalModal.tsx`).
- [ ] **Snippets** — saved commands run over SSH via the existing `exec` endpoint;
      new snippets store + UI. (Termius's most-loved feature, cheap here.)
- [ ] **Port-forwarding wizard** — JSch `setPortForwardingL` in `SshService`;
      Termius-style form to open a local→remote tunnel.
- [ ] xterm addons: `@xterm/addon-search`, `addon-web-links`, `addon-webgl`,
      `addon-serialize` (session save/replay).
- [ ] **Reconnect on drop** instead of a dead `[disconnected]` line.
- [ ] **Unified topology** — merge SSH + AWS + Cloudflare on one React Flow canvas
      with layer toggles; add minimap, VPC grouping rects, animated edges tied to
      SSE, and PNG/SVG export.
- [ ] **Command palette (⌘K)** via `cmdk` to jump to any machine/deploy/repo.

---

## Workstream 6 — Multi-user (unblocks teams)

- [ ] **Orgs / roles / RBAC** — extend Spring Security (already present) with
      owner/member roles; do not add a new auth framework.
- [ ] **Shared machines & environments** with per-resource permissions.

---

## Workstream 7 — Polish / cleanup

- [ ] Fix `GitHubService.getFileContent` silent failure (`service/GitHubService
      .java:151` — unchecked cast → `""`).
- [ ] Standardize an **error state** component; Login/Register have almost none.
- [ ] Split monster files: `pages/AWS.tsx` (1478 LOC),
      `components/DeployRepoWizard.tsx` (1113 LOC).
- [ ] Onboarding / first-run empty-state guide.
- [ ] Delete stale merged remote branches (`feat/env-injection`, `feat/live-logs`,
      `feat/real-rollback`, `feat/redeploy`, `feat/topology`).

---

## On the `.arise.yml` / IaC direction

Keep the minimal manifest (documented in `docs/arise-yml.md`) and let Compose be
the orchestration truth. **Do not invent a custom IaC DSL.** If cloud IaC is
wanted later, *generate* Terraform from Arise state rather than parse a homegrown
notation — the existing `TerraformParserService` already reads tfstate, so the
read side exists; add a write/emit side if needed.

---

## Suggested order

`Workstream 0` (tests/CI) → `1` (trust) → `4` + `7` (quick UX wins in parallel) →
`2` (depth) → `3` (observability) → `5` (terminal) → `6` (teams). Tauri desktop
(Mode A, see review §7) can start any time — it's independent.
