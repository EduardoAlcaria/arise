# AutomationHub — Device Setup Guide

This guide covers setting up AutomationHub from scratch on a new machine (Mac, Linux, or Windows with WSL2).

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Docker Desktop | latest | Enable file sharing for the home directory |
| Git | 2.x+ | For cloning the repo |
| AWS CLI | 2.x | Optional — only needed for real AWS profiles |

---

## 1. Clone the Repository

```bash
git clone https://github.com/EduardoAlcaria/AutomationHub.git
cd AutomationHub
```

---

## 2. AWS Credentials (optional — skip for demo account)

The backend mounts `~/.aws` read-write so it can write SSO token caches.

If you have real AWS profiles, just make sure they exist at `~/.aws/config`.

For the built-in **demo account** (`demo-profile`) no real credentials are needed — all AWS data is mocked.

The `docker-compose.yml` mounts the host credentials directory:
```yaml
volumes:
  - ~/.aws:/root/.aws:rw
```

On a new machine, create an empty directory if it doesn't exist:
```bash
mkdir -p ~/.aws
```

---

## 3. Environment Variables

All defaults are baked into `docker-compose.yml`. No `.env` file is required to get started.

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | (base64 of "automationcenter-jwt-secret-key-32+") | Override in production |
| `VITE_LOGO_DEV_TOKEN` | empty | Optional logo.dev API token for company logos |

To override, create a `.env` file at the repo root:
```env
JWT_SECRET=your_custom_base64_secret
VITE_LOGO_DEV_TOKEN=your_logo_dev_token
```

---

## 4. Fix the AWS Mount Path

The `docker-compose.yml` has an absolute Windows path for the AWS mount:
```yaml
volumes:
  - C:/Users/Eduardo Alcaria/.aws:/root/.aws:rw
```

**On another machine**, update this line to match your home directory:

```yaml
# Linux / Mac
- ~/.aws:/root/.aws:rw

# Windows (replace with your username)
- C:/Users/YOUR_USERNAME/.aws:/root/.aws:rw
```

---

## 5. Start Everything

```bash
docker compose up --build
```

This starts (in order):
1. **PostgreSQL** — application database
2. **Redis** — session cache
3. **RabbitMQ** — deployment event queue
4. **Backend** (Spring Boot) — waits for all three to be healthy
5. **Frontend** (React + nginx) — waits for backend

First build takes ~3–5 minutes. Subsequent starts are fast.

---

## 6. Access

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8080 |
| RabbitMQ Management | http://localhost:15672 (user: `automation` / `automation`) |

---

## 7. Demo Login

The backend seeds a demo account on first startup:

| Field | Value |
|-------|-------|
| Email | `demo@automationhub.dev` |
| Password | `Demo1234!` |

The demo account includes:
- 2 machines (Mac Pro ONLINE, Ubuntu OFFLINE)
- 4 deployments (react-dashboard, express-api, python-etl, next-blog)
- 2 SixEyes demo deployments (monorepo + 2-repo)
- 1 AWS account using `demo-profile` (all data mocked — no real AWS needed)

---

## 8. Register Your Own Account

Click **"Register"** on the login page and create a personal account.

### Add a Machine

Go to **Machines → Add Machine** and enter:
- Name (e.g. "My Mac Mini")
- SSH host (IP or hostname)
- SSH port (default 22)
- SSH user
- Private key (paste the contents of your `~/.ssh/id_rsa` or similar)

For Cloudflare tunnel access, set **Tunnel Type** to `cloudflared` and paste the proxy command shown in your Cloudflare Zero Trust dashboard.

### Add GitHub Integration

Go to **Settings → GitHub** and paste a Personal Access Token with `repo` scope.
This allows the deployment service to clone private repositories.

### Add a Cloudflare Account (for tunnels)

Go to **Settings → Cloudflare** and enter:
- API Token (with Zone:Edit + Tunnel:Edit permissions)
- Account ID
- Zone ID

---

## 9. Add an AWS Account

Go to **AWS → Accounts → Add Account** and enter:
- Display name
- AWS profile name (must match a profile in `~/.aws/config`)
- Default region

For SSO profiles, click **SSO Login** after adding the account. A browser window opens for authentication.

---

## 10. Deploy the SixEyes Demo App

For a live tunnel demonstration:

1. Add your Mac Mini as a machine (Cloudflare tunnel type for remote access)
2. Go to **Deployments → New Deployment**
3. Select:
   - Repo: `https://github.com/EduardoAlcaria/sixeyes`
   - Branch: `demonstration`
   - Machine: your Mac Mini
4. The system detects `docker-compose.yml` and runs `docker compose up --build -d`
5. After deploy, add a Cloudflare tunnel to expose port `4000` (the React dashboard)

See `sixeyes/DEMO.md` for environment variable requirements before deploying.

---

## Troubleshooting

**Backend won't start — can't connect to postgres/redis/rabbitmq**
→ The backend waits for all three to be healthy. Let Docker Compose finish starting them (can take 30–60 seconds on first run).

**"Demo seed already present — skipping" in logs**
→ Normal. The seeder only runs once. If you want to re-seed, delete the `demo@automationhub.dev` row from the `users` table and restart.

**AWS profile not reachable**
→ Check that `~/.aws/config` and `~/.aws/credentials` are mounted correctly (see step 4). For SSO profiles, run SSO login from the app.

**SSH connection refused when adding machine**
→ Verify the host/port are reachable from the Docker container. For local machines, use the host's Docker gateway IP (`172.17.0.1` on Linux) instead of `localhost`.
