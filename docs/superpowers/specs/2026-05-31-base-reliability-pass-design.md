# Base Reliability Pass — Design

**Date:** 2026-05-31
**Status:** Approved (pending spec review)

## Goal

Harden the three core "base" functions of Arise so they stop hanging, stop
reporting false success, and survive a server restart:

1. **Application/repository deployment**
2. **Local GitHub Actions runner setup**
3. **Cloudflare tunnel exposure**

All three execute shell over SSH and all three share the same two structural
weaknesses (no command timeout, no live output). This pass fixes the shared
root causes once, then adds truthful status and restart resilience per pillar.

Non-goals: deployment-screen UI redesign (separate refactor), AWS, new
features. This is purely making existing base functions reliable.

## Context — current weaknesses found in audit

### Shared root causes (hit all three pillars)

- **No command timeout.** `SshService.execute` loops
  `while(!channel.isClosed()) sleep(100)` with no deadline. `CONNECT_TIMEOUT_MS`
  covers only connect, not run. Any hang blocks the worker thread forever:
  - deploy: `docker compose up --build` stalled on a pull or prompt
  - runner: `curl|tar` download stall; `sudo ./svc.sh install` on Linux waiting
    on a password prompt with no tty
  - tunnel: cloudflared container start
- **No live output.** `execute` buffers all stdout into a `ByteArrayOutputStream`
  and only appends to the log after the command returns. Long steps show a blank
  UI then a wall of text — looks hung even when working. This is the reported
  "says failed but still waiting / no logs" behavior.

### False success (all three)

- **Deploy:** `compose up` exit 0 but a container crash-loops → marked SUCCESS.
  `docker compose ps` is logged but never parsed.
- **Runner:** `svc start` exit 0 does not mean the runner registered and is
  online on GitHub. No post-check.
- **Tunnel:** setup throws → caught as WARN → deploy still SUCCESS, leaving a
  green status with a dead URL (DeploymentService:269 and :397).

### Pillar-specific

- **Runner tracker:** `RunnerSetupTracker` is an in-memory map, never evicted
  (memory leak) and lost on restart (polling returns null → looks failed).
- **Tunnel partial failure:** `createTunnel` may succeed, then ingress/DNS/
  container start throws, leaving an orphan tunnel on the Cloudflare account and
  possibly an orphan cloudflared container.
- **Startup:** no reconciler — a restart mid-operation leaves deployments stuck
  in PENDING/BUILDING/DEPLOYING forever.

## Design

### Theme 1 — SSH timeout + live streaming (`SshService.execute`)

Add overloads; keep the existing zero-arg-timeout signature for the many quick
callers (commandExists, detectStack, etc.):

```java
SshCommandResponse execute(Machine m, String cmd);                                  // default timeout, no stream
SshCommandResponse execute(Machine m, String cmd, long timeoutSec);                 // bounded
SshCommandResponse execute(Machine m, String cmd, long timeoutSec, Consumer<String> onLine); // bounded + live
```

Implementation:

- Replace the `setOutputStream`/`setErrStream` + `while(!closed) sleep` pattern
  with a **deadline read loop** over `channel.getInputStream()` and
  `channel.getExtInputStream()` (stderr).
- Read available bytes, buffer, and on each newline call `onLine` with the
  completed line. Still accumulate the full stdout/stderr text for the returned
  `SshCommandResponse` so existing exit-code/string checks keep working.
- When `System.currentTimeMillis()` passes the deadline: `channel.disconnect()`,
  return exit code `-1`, stderr `"timed out after <N>s"`.
- Default timeouts in `application.yml` (overridable):
  - `ssh.command-timeout-seconds` default `120` (quick checks/clone)
  - `ssh.long-command-timeout-seconds` default `1800` (compose build, runner
    install)

Heavy callers switch to the streaming overload with the long timeout and pass
`line -> appendLog(deployment, line, INFO)` (or the runner output builder):

- DeploymentService: clone, build/`compose up --build`, teardown, cloudflared
  start
- CicdService.setupRunner: the combined install command
- Tunnel: cloudflared `docker run`

Quick internal checks (commandExists, detectStack, package-manager probes,
`docker compose ps`) keep the simple `execute(m, cmd)` form.

### Theme 2 — truthful status

**Deploy health gate** (`DeploymentService`, both repo and application flows):
After the compose up step, parse container state (`docker compose ps`, with the
`-f` flag when `.arise.yml` supplied a compose file). If any service is
`exited` / `restarting` / not `running`, fetch `docker compose logs --tail=50`
for that service, append it, and mark the deployment **FAILED** naming the
service. Mark SUCCESS only when all services are running. Non-compose stacks
keep current behavior (exit code is the signal).

**Runner online-check** (`CicdService.setupRunner`): after `svc start` returns
0, poll `listRunners(owner, repo)` for up to ~30s looking for a runner whose
name matches the machine name and whose `status == "online"`. Found → complete.
Not found within the window → fail with a clear message ("runner installed but
did not come online — check network/labels"). Reuses the existing `listRunners`.

**Tunnel failure** (decision: do NOT fail the deploy):
When containers deployed fine but tunnel setup throws, the deployment stays
**SUCCESS** (the app is running locally). Append a prominent **ERROR**-level log
line: `⚠ App is running locally but the Cloudflare tunnel FAILED — not exposed:
<reason>`. The final summary line must reflect this (do not print a bare
"completed successfully" when the tunnel was requested and failed).

**Tunnel orphan cleanup:** in the tunnel try/catch, track the created tunnel id;
if a later step (ingress/DNS/container) throws after `createTunnel` succeeded,
best-effort `cloudflareService.deleteTunnel(...)` so no orphan tunnel is left on
the Cloudflare account.

### Theme 3 — restart resilience

**Orphan reconciler:** a `@Component` listening for `ApplicationReadyEvent`.
On startup, find deployments with status in `{PENDING, BUILDING, DEPLOYING}`,
set them FAILED with `finishedAt = now`, and append a log line "interrupted by
server restart". Add `DeploymentRepository.findByStatusIn(Collection<...>)`.

**Runner tracker eviction:** add an `Instant createdAt` to
`RunnerSetupTracker.Session`. A `@Scheduled` sweep purges terminal (DONE/FAILED)
sessions older than 1h. Enable scheduling if not already on.

## Data flow (deploy, after changes)

```
create -> RabbitMQ -> DeploymentRunListener -> executeAsync
  clone           (stream, long timeout)
  write configs
  read .arise.yml
  detect stack
  preflight/install
  teardown prev   (stream)
  build/up        (stream, long timeout)
  HEALTH GATE     -> any container down? FAILED + service logs
  tunnel (opt)    -> fail? SUCCESS + loud ERROR warning + orphan cleanup
  SUCCESS
```

## Error handling summary

| Situation | Before | After |
|---|---|---|
| Command hangs | blocks forever | timeout → FAILED "timed out after Ns" |
| Long step running | blank UI then wall | live line-by-line stream |
| Container crash-loop | SUCCESS | FAILED + service logs |
| Runner not online | DONE | FAILED "did not come online" |
| Tunnel setup fails | SUCCESS, silent WARN | SUCCESS + loud ERROR + orphan cleanup |
| Restart mid-deploy | stuck BUILDING forever | FAILED "interrupted by restart" |
| Runner sessions | leak forever | evicted after 1h |

## Testing

- `SshService`: deadline/timeout path returns -1 (mock channel that never
  closes); line callback fires per newline; full text still accumulated.
- Health-gate parser: given sample `docker compose ps` output, correctly flags
  exited/restarting vs all-running.
- Reconciler: given deployments in non-terminal states, marks them FAILED.
- Tracker eviction: terminal session older than threshold is removed; running
  session is kept.
- Existing `GitHubServiceAriseConfigTest` stays green.

## Commit discipline

One file change = one commit = one push (per established workflow).
