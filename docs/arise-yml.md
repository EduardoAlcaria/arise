# `.arise.yml` — Deployment Manifest

`.arise.yml` is an **optional** file you place at the root of a repository to tell
Arise how to deploy it. Without it, Arise auto-detects the stack (Node, Python,
Java, Go, Docker Compose) and deploys with sensible defaults. With it, you pin the
behavior explicitly — most importantly, which compose file to run.

It is read from the repository during deployment (over SSH, from the cloned repo)
and also fetched ahead of time by the deploy wizard to pre-fill the form.

---

## Format

All fields are optional. Unknown fields are ignored.

```yaml
# .arise.yml
compose: docker-compose.prod.yml   # compose file to run (relative to repo root)
port: 3000                         # app port — used to suggest the Cloudflare tunnel target
env:                               # env var keys this service expects
  - DATABASE_URL
  - REDIS_URL
  - API_KEY
name: my-service                   # display name for the deployment
branch: main                       # default branch to deploy
```

| Field | Type | Effect |
|---|---|---|
| `compose` | string | **Server-side, during deploy.** Overrides stack auto-detection: Arise treats the repo as a Compose stack and runs `docker compose -f <compose> up --build -d`. This is the only field that changes what actually runs on the machine. |
| `port` | number | Hint used by the deploy wizard to pre-fill the Cloudflare tunnel target port. |
| `env` | list of strings | Env var **keys** the service expects. The wizard pre-fills these fields so you know what to supply. Values are never stored in the repo — only the key names. |
| `name` | string | Human-readable name shown for the deployment. |
| `branch` | string | Default branch. When set, the wizard auto-selects this branch for the repo. |

> **Note:** during the SSH deploy pipeline only `compose` is honored. `port`,
> `env`, `name`, and `branch` are consumed by the deploy wizard
> (`GET /api/github/repos/{owner}/{repo}/arise-config`) to pre-fill the form —
> they do not change server-side deploy behavior on their own.

---

## Single-repo deploy

For a normal repository deploy, `.arise.yml` lives at the repo root. The most
common use is overriding the compose file when the default `docker-compose.yml`
is not the one you deploy in production:

```yaml
compose: docker-compose.prod.yml
port: 8080
env:
  - DATABASE_URL
  - JWT_SECRET
```

If `compose` is omitted, Arise falls back to file-based stack detection
(`docker-compose.yml` → compose, `Dockerfile` → docker, `package.json` → node,
`pom.xml` → maven, `build.gradle` → gradle, `requirements.txt` → python).

---

## Multi-service (Application) deploy

An **Application** deploy composes several repositories into one running app.
Each service is cloned into its own subfolder under
`~/arise-apps/{deploymentId}/` on the target machine, the injected config files
(a top-level `docker-compose.yml`, `.env`, `nginx.conf`, …) are written, and a
single `docker compose up --build -d` brings the whole app up together.

```
~/arise-apps/42/
├── api/                  # cloned from repo A
├── web/                  # cloned from repo B
├── worker/               # cloned from repo C
├── docker-compose.yml    # injected — wires the services together
├── .env                  # injected
└── nginx.conf            # injected
```

In this mode the orchestration lives in the **injected top-level compose file**,
not in each repo's `.arise.yml`. A per-repo `.arise.yml` is still useful for the
`env` and `branch` hints when picking services in the wizard.

---

## Health gate

Regardless of mode, after `docker compose up` Arise parses `docker compose ps`.
If any service is not `running` (exited / restarting), the deployment is marked
**FAILED** and the failing service's recent logs are appended — a compose file
that starts but crash-loops will not be reported as a false success.

---

## Windows targets

Config-file injection and `.arise.yml` reading are skipped on Windows target
machines (the pipeline is POSIX-shell based). Deploys to Windows hosts rely on
stack auto-detection only.
