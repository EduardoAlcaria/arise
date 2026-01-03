# Arise — Manual Test Checklist

> **Como usar**: execute o checklist do início ao fim com a conta demo e com uma conta própria real.  
> Conta demo: `demo@automationhub.dev` / `Demo1234!`  
> Para resetar seeds: pare o backend, drope o banco (`docker compose down -v`), suba novamente.

---

## 0. Setup

- [ ] `docker compose up -d postgres rabbitmq`
- [ ] Backend iniciou sem erros no log (`Seeding demo data… / Demo seed complete`)
- [ ] Frontend carregou em `http://localhost:5173`

---

## 1. Auth

- [ ] `/register` — criar conta nova com email válido → redireciona para `/`
- [ ] `/register` — email duplicado → mostra erro inline
- [ ] `/login` — credenciais corretas → entra e exibe nome no sidebar
- [ ] `/login` — senha errada → mensagem de erro
- [ ] Acessar `/machines` sem estar logado → redireciona para `/login`
- [ ] Recarregar página após login → continua autenticado (token no localStorage)
- [ ] Logout → token removido, redireciona para `/login`

---

## 2. Machines

- [ ] Listar máquinas → demo user vê 3 máquinas (Mac Pro, Ubuntu Server, Edge Node)
- [ ] Criar máquina nova com DIRECT tunnel → aparece na lista
- [ ] Criar máquina com PROXY_COMMAND → campo `proxyCommand` aparece no form
- [ ] Editar máquina → salva e atualiza card
- [ ] Deletar máquina → sumiu da lista
- [ ] Botão "Test" numa máquina alcançável → ícone muda para online + spinner durante o teste
- [ ] Botão "Test" numa máquina offline → mostra erro (timeout ou connection refused)
- [ ] "SSH Terminal" num Mac Mini real → abre xterm.js conectado, digitar `ls` funciona
- [ ] Badge de status (ONLINE / OFFLINE) atualiza após o test ping

---

## 3. Deployments

### 3.1 Lista
- [ ] Demo user vê 7 deployments agrupados por repositório
- [ ] Deployment `react-dashboard` aparece com status SUCCESS e stack Node.js
- [ ] Deployment `python-etl` aparece com status FAILED (vermelho)
- [ ] Deployment `next-blog` aparece com status BUILDING (amarelo)
- [ ] Deployment `sixeyes (full stack)` e `sixeyes-api + sixeyes-dashboard` agrupados sob mesmo repo

### 3.2 Deploy novo (requer máquina real + GitHub token)
- [ ] DeployRepoWizard abre → selecionar repo → selecionar branch → enviar
- [ ] Logs SSE aparecem em tempo real na tela de detalhes
- [ ] Stack detectado corretamente (Node.js para `package.json`, Java para `pom.xml`, compose para `docker-compose.yml`)
- [ ] Status muda para SUCCESS ao final

### 3.3 Ações pós-deploy
- [ ] "Redeploy" → cria novo registro com mesmo repo, aparece na lista agrupado
- [ ] "Rollback" → SSH down no dir atual, up no dir anterior
- [ ] "Delete" → remove deployment, SSH down, deleta tunnel se existir
- [ ] Logs históricos carregam ao clicar no deployment (sem SSE, endpoint `/api/logs/{id}`)

### 3.4 Tunnels
- [ ] "Add Tunnel" num deploy existente → dialog, preencher hostname → tunnel criado (requer Cloudflare token)
- [ ] "Remove Tunnel" → remove tunnel da Cloudflare e do registro

---

## 4. Containers

- [ ] Listar → vazio para conta nova
- [ ] Deploy imagem (`nginx:latest`, porta host 8090, porta container 80) → aparece na lista com status RUNNING
- [ ] Stop → status muda para STOPPED
- [ ] Start → status volta para RUNNING
- [ ] Remove → sumiu da lista

> **Req**: máquina alvo precisa ter Docker TCP exposto em `tcp://host:2375`

---

## 5. GitHub

- [ ] Salvar PAT inválido → mensagem de erro
- [ ] Salvar PAT válido → lista de repositórios carrega
- [ ] Selecionar repo → branches carregam no dropdown
- [ ] Aba README → renderiza markdown do repo
- [ ] Aba Tree → lista arquivos e diretórios
- [ ] "Detect env vars" → lê `.env.example` e lista chaves encontradas

---

## 6. Cloudflare

- [ ] Salvar token inválido → erro inline "Invalid Cloudflare token"
- [ ] Salvar token válido → lista de zones carrega
- [ ] Listar tunnels → mostra tunnels da conta
- [ ] Token persiste entre sessões (recarregar página, token ainda está salvo)

---

## 7. Infisical

- [ ] Conectar com credenciais inválidas → "Failed to connect to Infisical"
- [ ] Conectar com credenciais válidas → "Connected" exibido
- [ ] Listar secrets → selecionar project + env → secrets aparecem
- [ ] Secret individual → nome, valor e comentário exibidos

---

## 8. CI/CD

- [ ] Aba Workflows → lista workflows do repo selecionado
- [ ] Aba Runs → lista execuções com status e duração
- [ ] "Trigger" num workflow → dispara `workflow_dispatch`, novo run aparece
- [ ] "Rerun" num run com falha → novo run criado
- [ ] Ver Jobs de um run → expande com steps e status de cada step
- [ ] Aba Runners → lista self-hosted runners
- [ ] "Delete Runner" → runner sumido da lista
- [ ] "Setup Runner" → retorna 202; verificar no GitHub após ~2 min se runner está online

---

## 9. Topology — Infraestrutura (`/topology`)

- [ ] Grafo carrega com os nós: 3 máquinas, 7 deployments, 5 tunnels (react, api, worker, sixeyes×2)
- [ ] Edges corretos: cada deployment conecta à sua máquina, cada tunnel conecta ao deployment
- [ ] Nó `react-dashboard` → click → SidePanel abre com repositoryUrl, branch, hostname, link clicável "Open ↗"
- [ ] Nó tunnel `dashboard.demo.alcaria.dev` → click → SidePanel mostra `url`, porta 3000
- [ ] Nó `python-etl` (FAILED) → cor vermelha no card
- [ ] Nó `next-blog` (BUILDING) → cor amarela
- [ ] Nó `Ubuntu Server` (OFFLINE) → cor vermelha
- [ ] Campo de busca → digitar "react" → outros nós ficam opacos, react-dashboard e suas conexões permanecem
- [ ] Filtro de tipo → desativar "Tunnels" → nós de tunnel desaparecem, nós de deployment ficam
- [ ] MiniMap → panorama correto do grafo
- [ ] Fitview → grafo centralizado após abertura

---

## 10. AWS

### 10.1 Conta Demo
- [ ] Demo user já tem conta "Demo AWS (us-east-1)" listada
- [ ] Conta mostra `✓` verde (reachable=true)
- [ ] Account ID: `123456789012`

### 10.2 EC2
- [ ] 4 instâncias aparecem: web-server-prod, app-server-prod, db-server-prod (stopped), bastion
- [ ] `db-server-prod` mostra badge STOPPED (vermelho), botão "Start" disponível
- [ ] Botão "Stop" em instância running → chama endpoint (demo: não mockado — esperado falhar em demo)
- [ ] Botão "Terminate" → pede confirmação primeiro

### 10.3 S3
- [ ] 4 buckets listados: demo-static-assets, demo-data-lake, demo-backups, demo-terraform-state
- [ ] Data de criação exibida em cada bucket

### 10.4 ECS
- [ ] 2 clusters: demo-prod-cluster, demo-staging-cluster
- [ ] Expandir `demo-prod-cluster` → 3 services: frontend (2/2), backend-api (2/2), worker (0/1 → vermelho)
- [ ] Expandir `demo-staging-cluster` → 1 service: staging-api (1/1)
- [ ] Worker com running < desired → borda vermelha no card

### 10.5 Topology AWS
- [ ] Grafo carrega com VPC, 2 subnets, 2 security groups, 3 EC2, 2 Lambdas, 1 ECS cluster
- [ ] Rank correto: VPC no topo, subnets/SGs no meio, EC2/Lambda/ECS abaixo
- [ ] Edges: vpc → subnet, vpc → sg, subnet → ec2 (instâncias que têm subnet)
- [ ] EC2 `db-server-prod` (stopped) → dot vermelho no card
- [ ] Nodes Lambda → dot amarelo ou verde (sem estado definido → fallback)
- [ ] Badge "11 live" exibido no painel esquerdo
- [ ] Filtro: desativar "lambda" → nós Lambda somem
- [ ] Busca: "web" → card `web-server-prod` fica visível, outros opacos
- [ ] Click em nó EC2 → painel direito abre com: state, instanceType, privateIp, source, service

### 10.6 X-Ray Traces
- [ ] 5 traces aparecem no demo
- [ ] Trace `POST /deploy` → badge "Fault" em vermelho
- [ ] Trace `GET /machines/99` → badge "Error"
- [ ] Dropdown "Last 15 min / 1h / 6h" → muda o intervalo (mock retorna sempre os mesmos 5)

### 10.7 CRUD de conta real
- [ ] "Register Account" → preencher profileName de um perfil SSO real → salvar
- [ ] Se token expirado → badge "Login" vermelho no card
- [ ] Click "Login" → SSO modal abre → "Start SSO Login" → URL + código aparecem
- [ ] Abrir URL, aprovar no browser → após 5–30s backend escreve token no cache
- [ ] Voltar ao app → account agora mostra `✓` verde
- [ ] Editar conta → salvar → dados atualizados
- [ ] Deletar conta → sumiu da lista

---

## 11. Settings

- [ ] Form Infisical: preencher Client ID, Client Secret, Base URL, Project ID → "Save & Connect" → "Connected" 
- [ ] Form Cloudflare: preencher token inválido → erro inline
- [ ] Form Cloudflare: preencher token válido → salva

---

## 12. Regressão rápida (smoke test)

Após qualquer mudança de código, verificar:

- [ ] Login ainda funciona
- [ ] Machines lista carrega
- [ ] Deployments lista carrega
- [ ] Topology infra renderiza grafo (não mostra "No infrastructure data")
- [ ] AWS page carrega e tabs EC2 / Topology funcionam com conta demo
- [ ] Console do browser sem erros vermelhos

---

## 13. Security (new — 2026-05)

- [ ] **WebSocket notification auth** — open `ws://localhost:8080/ws/notifications` without `?token=` → connection immediately closed (policy violation)
- [ ] **WebSocket terminal auth** — open `/ws/terminal/1` without valid token → closed
- [ ] **CORS** — request from unlisted origin returns CORS error (test with `curl -H "Origin: http://evil.com"`)
- [ ] **Runner session isolation** — cannot poll another user's runner setup session (returns 404)
- [ ] **Webhook HMAC** — POST to `/api/webhooks/github/{token}` with wrong `X-Hub-Signature-256` → 401
- [ ] **Webhook HMAC** — POST with correct HMAC → triggers redeploy
- [ ] **Cloudflare tunnel token hidden** — tunnel token NOT visible in `docker exec <backend> ps aux`
- [ ] **Startup warnings** — if `JWT_SECRET` or `ENCRYPTION_SECRET` uses a known-insecure default, WARN appears in backend logs

---

## 14. Dependency Auto-Install (new — 2026-05)

- [ ] Deploy to machine missing `docker` → pre-flight detects it, auto-installs via detected package manager, deploy continues
- [ ] Deploy to machine missing `git` → same auto-install flow
- [ ] Arch Linux target (`pacman`) → `pacman -Sy --noconfirm docker` used (not apt-get)
- [ ] Unknown package manager → deploy fails with clear error (not silent hang)

---

## 15. UX / State Persistence (new — 2026-05)

- [ ] **CI/CD repo** — select repo, navigate away, return → same repo still selected
- [ ] **CI/CD tab** — switch to Runners tab, navigate away, return → Runners tab still active
- [ ] **AWS selection** — expand region + click VPC, navigate away, return → same region/VPC still shown in right panel
- [ ] **Logos** — OS/stack icons render as colored letter badges (no broken image icons, no CDN dependency)
- [ ] **GitHub icon** — renders as inline SVG (not broken img tag)
- [ ] **Docker icon** — renders as inline SVG (not broken img tag)

---

## Bugs conhecidos (não são falhas nos testes)

| Comportamento | Status |
|---|---|
| EC2 start/stop/terminate na conta demo retorna erro AWS (não mockado) | Aceito — só EC2 list é mockado |
| SSO: após aprovar no browser, pode demorar 5–30s para token aparecer | Aceito — polling background sem feedback visual |
| Runner setup retorna 202 sem output SSH na UI | Aceito — async fire-and-forget |
| Containers precisam de Docker TCP (`tcp://host:2375`) na máquina alvo | Requisito de infraestrutura |
| GitHub: file tree pode travar em repos muito grandes | Bug conhecido, não bloqueante |
| SSH host key store in-memory | Resets on backend restart — TOFU re-accepted on reconnect |
| CI/CD all-repos view | Not yet implemented — repo selection still required for runs/workflows tabs |
