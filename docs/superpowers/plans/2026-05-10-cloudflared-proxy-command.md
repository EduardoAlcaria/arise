# Cloudflare SSH Proxy Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each machine in Arise to optionally specify a proxy command (e.g. `cloudflared access ssh --hostname %h`) so JSch tunnels its SSH connection through that subprocess instead of opening a raw TCP socket — enabling connectivity to machines behind Cloudflare SSH tunnels.

**Architecture:** A new `ProcessProxy` class implements JSch's `Proxy` interface by spawning the proxy command as a subprocess and piping its stdin/stdout as the socket streams. `SshService` gains a public `openSession(Machine)` factory that wires in the proxy when `machine.proxyCommand` is set. All SSH call sites — `SshService`, `SshTerminalHandler`, `MachineService`, `DeploymentService` — go through this factory so the proxy is transparent everywhere.

**Tech Stack:** Java 21 · Spring Boot 3.3.5 · JSch (com.github.mwiede:jsch 0.2.19) · cloudflared binary · React 19 · TypeScript 6

---

## File Map

| Action | File |
|---|---|
| **Create** | `backend/src/main/java/com/automationcenter/service/ProcessProxy.java` |
| **Modify** | `backend/src/main/java/com/automationcenter/service/SshService.java` |
| **Modify** | `backend/src/main/java/com/automationcenter/entity/Machine.java` |
| **Modify** | `backend/src/main/java/com/automationcenter/dto/machine/MachineRequest.java` |
| **Modify** | `backend/src/main/java/com/automationcenter/dto/machine/MachineResponse.java` |
| **Modify** | `backend/src/main/java/com/automationcenter/service/MachineService.java` |
| **Modify** | `backend/src/main/java/com/automationcenter/service/DeploymentService.java` |
| **Modify** | `backend/src/main/java/com/automationcenter/websocket/SshTerminalHandler.java` |
| **Modify** | `backend/Dockerfile` |
| **Modify** | `frontend/src/types/index.ts` |
| **Modify** | `frontend/src/api/machines.ts` |
| **Modify** | `frontend/src/pages/Machines.tsx` |

---

## Task 1: ProcessProxy — JSch Proxy implementation

**Files:**
- Create: `backend/src/main/java/com/automationcenter/service/ProcessProxy.java`

This class is the entire mechanism. JSch calls `connect()` before the handshake, then reads the SSH wire protocol from `getInputStream()` and writes to `getOutputStream()`. We spawn the proxy command as a subprocess; its stdin/stdout *are* the connection.

- [ ] **Step 1: Create ProcessProxy.java**

```java
package com.automationcenter.service;

import com.jcraft.jsch.Proxy;
import com.jcraft.jsch.SocketFactory;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;

public class ProcessProxy implements Proxy {

    private final String commandTemplate;
    private Process process;

    public ProcessProxy(String commandTemplate) {
        this.commandTemplate = commandTemplate;
    }

    @Override
    public void connect(SocketFactory socketFactory, String host, int port, int timeout) throws Exception {
        String cmd = commandTemplate
                .replace("%h", host)
                .replace("%p", String.valueOf(port));
        // Use sh -c so the command string is parsed by the shell (handles flags correctly)
        process = new ProcessBuilder("sh", "-c", cmd)
                .redirectErrorStream(false)  // keep stderr separate — merging would corrupt the SSH binary stream
                .start();
    }

    @Override
    public InputStream getInputStream() {
        return process.getInputStream();
    }

    @Override
    public OutputStream getOutputStream() {
        return process.getOutputStream();
    }

    @Override
    public Socket getSocket() {
        return null; // not a socket-based proxy
    }

    @Override
    public void close() {
        if (process != null) {
            process.destroy();
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/ProcessProxy.java
git commit -m "feat(ssh): add ProcessProxy — JSch Proxy impl that tunnels via subprocess stdin/stdout"
```

---

## Task 2: Refactor SshService — add openSession(Machine) factory

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/SshService.java`

Add three public Machine-based methods. The old 5-arg `execute` and `writeFileViaShell` stay as private helpers (so existing code compiles while we migrate call sites in later tasks).

`openSession(Machine)` is public so `SshTerminalHandler` can call it directly (it needs a `Session` to open a shell channel, not just run a command).

- [ ] **Step 1: Replace SshService.java with this**

```java
package com.automationcenter.service;

import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.Machine;
import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

@Service
public class SshService {

    private static final int CONNECT_TIMEOUT_MS = 30_000;

    // ── Public Machine-based API (preferred) ─────────────────────────────────

    /**
     * Build a configured, ready-to-connect JSch Session for the given machine.
     * Wires in ProcessProxy when machine.proxyCommand is set.
     * Caller is responsible for calling session.connect(timeout) and session.disconnect().
     */
    public Session openSession(Machine machine) throws Exception {
        JSch jsch = new JSch();
        jsch.addIdentity("key", machine.getPrivateKey().getBytes(StandardCharsets.UTF_8), null, null);
        Session session = jsch.getSession(machine.getSshUser(), machine.getHost(), machine.getPort());
        session.setConfig("StrictHostKeyChecking", "no");
        if (machine.getProxyCommand() != null && !machine.getProxyCommand().isBlank()) {
            session.setProxy(new ProcessProxy(machine.getProxyCommand()));
        }
        return session;
    }

    /** Execute a single command on the machine, return stdout/stderr/exitCode. */
    public SshCommandResponse execute(Machine machine, String command) {
        Session session = null;
        try {
            session = openSession(machine);
            session.connect(CONNECT_TIMEOUT_MS);

            ChannelExec channel = (ChannelExec) session.openChannel("exec");
            channel.setCommand(command);

            ByteArrayOutputStream stdout = new ByteArrayOutputStream();
            ByteArrayOutputStream stderr = new ByteArrayOutputStream();
            channel.setOutputStream(stdout);
            channel.setErrStream(stderr);
            channel.connect();

            while (!channel.isClosed()) {
                Thread.sleep(100);
            }

            int exitCode = channel.getExitStatus();
            channel.disconnect();

            return new SshCommandResponse(
                    stdout.toString(StandardCharsets.UTF_8),
                    stderr.toString(StandardCharsets.UTF_8),
                    exitCode
            );
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new SshCommandResponse("", "Interrupted: " + e.getMessage(), -1);
        } catch (Exception e) {
            return new SshCommandResponse("", e.getMessage(), -1);
        } finally {
            if (session != null) session.disconnect();
        }
    }

    /** Write a file to the remote machine by base64-encoding content through a shell command. */
    public SshCommandResponse writeFileViaShell(Machine machine, String remotePath, String content) {
        String b64 = Base64.getEncoder().encodeToString(content.getBytes(StandardCharsets.UTF_8));
        String cmd = "mkdir -p \"$(dirname '" + remotePath + "')\" && echo '" + b64 + "' | base64 -d > '" + remotePath + "'";
        return execute(machine, cmd);
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/SshService.java
git commit -m "refactor(ssh): add Machine-based execute/writeFileViaShell/openSession with proxy support"
```

---

## Task 3: Machine entity + DTOs + MachineService

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/entity/Machine.java`
- Modify: `backend/src/main/java/com/automationcenter/dto/machine/MachineRequest.java`
- Modify: `backend/src/main/java/com/automationcenter/dto/machine/MachineResponse.java`
- Modify: `backend/src/main/java/com/automationcenter/service/MachineService.java`

- [ ] **Step 1: Add proxyCommand to Machine entity**

In `Machine.java`, add after the `privateKey` field:

```java
    @Column(columnDefinition = "TEXT")
    private String proxyCommand;
```

Full file for reference — only this field is added:

```java
package com.automationcenter.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "machines")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Machine {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String host;

    @Column(nullable = false)
    private Integer port;

    @Column(nullable = false)
    private String sshUser;

    @Column(columnDefinition = "TEXT", nullable = false)
    private String privateKey;

    @Column(columnDefinition = "TEXT")
    private String proxyCommand;

    @Enumerated(EnumType.STRING)
    @Builder.Default
    private MachineStatus status = MachineStatus.UNKNOWN;

    private LocalDateTime lastSeen;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    private User owner;
}
```

- [ ] **Step 2: Add proxyCommand to MachineRequest**

```java
package com.automationcenter.dto.machine;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class MachineRequest {
    @NotBlank
    private String name;
    @NotBlank
    private String host;
    @NotNull @Min(1) @Max(65535)
    private Integer port;
    @NotBlank
    private String sshUser;
    @NotBlank
    private String privateKey;
    private String proxyCommand; // optional — null means direct TCP connection
}
```

- [ ] **Step 3: Add proxyCommand to MachineResponse**

```java
package com.automationcenter.dto.machine;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Builder
public class MachineResponse {
    private Long id;
    private String name;
    private String host;
    private Integer port;
    private String sshUser;
    private String status;
    private String proxyCommand;
    private LocalDateTime lastSeen;
    private LocalDateTime createdAt;
    private Long ownerId;
}
```

- [ ] **Step 4: Update MachineService — wire proxyCommand through + use Machine-based SSH calls**

```java
package com.automationcenter.service;

import com.automationcenter.dto.machine.MachineRequest;
import com.automationcenter.dto.machine.MachineResponse;
import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.Machine;
import com.automationcenter.entity.MachineStatus;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.MachineRepository;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class MachineService {

    private final MachineRepository machineRepository;
    private final UserRepository userRepository;
    private final SshService sshService;

    public MachineResponse create(MachineRequest request, Long ownerId) {
        User owner = userRepository.findById(ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        Machine machine = Machine.builder()
                .name(request.getName())
                .host(request.getHost())
                .port(request.getPort())
                .sshUser(request.getSshUser())
                .privateKey(request.getPrivateKey())
                .proxyCommand(request.getProxyCommand())
                .owner(owner)
                .build();
        return toResponse(machineRepository.save(machine));
    }

    public List<MachineResponse> listByOwner(Long ownerId) {
        return machineRepository.findByOwnerId(ownerId).stream().map(this::toResponse).toList();
    }

    public MachineResponse getById(Long id, Long ownerId) {
        return toResponse(findByIdAndOwner(id, ownerId));
    }

    public MachineResponse update(Long id, MachineRequest request, Long ownerId) {
        Machine machine = findByIdAndOwner(id, ownerId);
        machine.setName(request.getName());
        machine.setHost(request.getHost());
        machine.setPort(request.getPort());
        machine.setSshUser(request.getSshUser());
        if (request.getPrivateKey() != null && !request.getPrivateKey().isBlank()) {
            machine.setPrivateKey(request.getPrivateKey());
        }
        // empty string clears the proxy; null leaves it unchanged
        if (request.getProxyCommand() != null) {
            machine.setProxyCommand(request.getProxyCommand().isBlank() ? null : request.getProxyCommand());
        }
        return toResponse(machineRepository.save(machine));
    }

    public void delete(Long id, Long ownerId) {
        Machine machine = findByIdAndOwner(id, ownerId);
        machineRepository.delete(machine);
    }

    public boolean testConnection(Long machineId, Long ownerId) {
        Machine machine = findByIdAndOwner(machineId, ownerId);
        return ping(machine);
    }

    public SshCommandResponse exec(Long machineId, String command, Long ownerId) {
        Machine machine = findByIdAndOwner(machineId, ownerId);
        return sshService.execute(machine, command);
    }

    @Scheduled(fixedDelay = 60_000)
    public void pingAll() {
        machineRepository.findAll().forEach(machine -> {
            try {
                ping(machine);
            } catch (Exception e) {
                log.warn("Ping failed for machine {}: {}", machine.getId(), e.getMessage());
            }
        });
    }

    private boolean ping(Machine machine) {
        SshCommandResponse response = sshService.execute(machine, "echo ok");
        boolean online = response.getExitCode() == 0 && response.getStdout().contains("ok");
        machine.setStatus(online ? MachineStatus.ONLINE : MachineStatus.ERROR);
        if (online) machine.setLastSeen(LocalDateTime.now());
        machineRepository.save(machine);
        return online;
    }

    public Machine findByIdAndOwner(Long id, Long ownerId) {
        return machineRepository.findByIdAndOwnerId(id, ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("Machine not found: " + id));
    }

    public MachineResponse toResponse(Machine m) {
        return MachineResponse.builder()
                .id(m.getId())
                .name(m.getName())
                .host(m.getHost())
                .port(m.getPort())
                .sshUser(m.getSshUser())
                .status(m.getStatus().name())
                .proxyCommand(m.getProxyCommand())
                .lastSeen(m.getLastSeen())
                .createdAt(m.getCreatedAt())
                .ownerId(m.getOwner().getId())
                .build();
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/automationcenter/entity/Machine.java \
        backend/src/main/java/com/automationcenter/dto/machine/MachineRequest.java \
        backend/src/main/java/com/automationcenter/dto/machine/MachineResponse.java \
        backend/src/main/java/com/automationcenter/service/MachineService.java
git commit -m "feat(machines): add proxyCommand field — stored on entity, exposed via DTOs and MachineService"
```

---

## Task 4: Update DeploymentService — replace all raw SSH call sites

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/DeploymentService.java`

There are 11 `sshService.execute(machine.getHost(), machine.getPort(), machine.getSshUser(), machine.getPrivateKey(), ...)` calls and 1 `sshService.writeFileViaShell(machine.getHost(), ...)` call. Replace every one with the Machine-based API. No logic changes — purely call-site migration.

- [ ] **Step 1: Replace all sshService.execute() and writeFileViaShell() calls**

Use this sed-style rule across the entire file:

Every occurrence of:
```java
sshService.execute(machine.getHost(), machine.getPort(), machine.getSshUser(), machine.getPrivateKey(), 
```
becomes:
```java
sshService.execute(machine, 
```

Every occurrence of:
```java
sshService.writeFileViaShell(machine.getHost(), machine.getPort(), machine.getSshUser(), machine.getPrivateKey(), 
```
becomes:
```java
sshService.writeFileViaShell(machine, 
```

The affected lines are (reference by current line numbers):
- L97–100: `osCheck` (uname)
- L121–123: `cloneResult` (git clone repo deploy)
- L143–145: `buildResult` (build command)
- L169: `cfCmd` (cloudflare tunnel, repo deploy)
- L208–210: `mkdirResult` (mkdir -p, application deploy)
- L226–228: `cloneResult` (clone each service)
- L239–240: `writeFileViaShell` (write config files)
- L253–255: `composeResult` (docker compose up)
- L285–286: `cfCmd` (cloudflare tunnel, application deploy)
- L337: `cfCmd` (addTunnel method)
- L385–386: `detectStack` helper (ls)
- L421: `fixDockerCredentials` helper

After the replacement, every `sshService.execute(` call in the file should have `machine,` as its first argument (not `machine.getHost()`).

- [ ] **Step 2: Verify no old-style calls remain**

```bash
grep -n "sshService.execute(machine.getHost" backend/src/main/java/com/automationcenter/service/DeploymentService.java
grep -n "sshService.writeFileViaShell(machine.getHost" backend/src/main/java/com/automationcenter/service/DeploymentService.java
```

Expected: no output (zero matches).

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/DeploymentService.java
git commit -m "refactor(deployment): use Machine-based SshService API — proxy command now flows through all deploy paths"
```

---

## Task 5: Update SshTerminalHandler — use openSession(Machine)

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/websocket/SshTerminalHandler.java`

The terminal handler currently builds its own `JSch` session inline. Replace that block with `sshService.openSession(machine)` so the proxy command is picked up automatically.

- [ ] **Step 1: Inject SshService into SshTerminalHandler**

Add `private final SshService sshService;` to the field list. Lombok `@RequiredArgsConstructor` handles the constructor injection automatically.

Change the class declaration area from:
```java
public class SshTerminalHandler extends AbstractWebSocketHandler {

    private final MachineService machineService;
    private final JwtService jwtService;
    private final UserDetailsService userDetailsService;
    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;
```
to:
```java
public class SshTerminalHandler extends AbstractWebSocketHandler {

    private final MachineService machineService;
    private final SshService sshService;
    private final JwtService jwtService;
    private final UserDetailsService userDetailsService;
    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;
```

Also add the import:
```java
import com.automationcenter.service.SshService;
```

- [ ] **Step 2: Replace inline JSch session creation with sshService.openSession()**

Find the block starting at line 88 that reads:
```java
        JSch jsch = new JSch();
        try {
            jsch.addIdentity("key", machine.getPrivateKey().getBytes(StandardCharsets.UTF_8), null, null);

            Session jschSession = jsch.getSession(machine.getSshUser(), machine.getHost(), machine.getPort());
            jschSession.setConfig("StrictHostKeyChecking", "no");
            jschSession.connect(15_000);
```

Replace with:
```java
        try {
            Session jschSession = sshService.openSession(machine);
            jschSession.connect(15_000);
```

Remove the `import com.jcraft.jsch.JSch;` import since `JSch` is no longer referenced directly in this class.

- [ ] **Step 3: Verify the file compiles (no unused imports)**

```bash
cd backend && mvn compile -q 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/java/com/automationcenter/websocket/SshTerminalHandler.java
git commit -m "refactor(terminal): use sshService.openSession() so proxy command applies to WebSocket SSH terminal"
```

---

## Task 6: Add cloudflared to backend Dockerfile

**Files:**
- Modify: `backend/Dockerfile`

The `ProcessProxy` spawns `sh -c "cloudflared access ssh --hostname ..."`. The binary must exist inside the container.

- [ ] **Step 1: Update backend/Dockerfile**

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B
COPY src ./src
RUN mvn clean package -DskipTests -B

FROM eclipse-temurin:21-jre
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

> **Note:** This downloads the `amd64` build. If you ever run on ARM (e.g. Mac M-series with Docker), change `cloudflared-linux-amd64` to `cloudflared-linux-arm64`.

- [ ] **Step 2: Verify cloudflared is reachable in the built image**

```bash
cd backend
docker build -t arise-backend-test .
docker run --rm arise-backend-test cloudflared --version
```

Expected output: `cloudflared version ...`

- [ ] **Step 3: Commit**

```bash
git add backend/Dockerfile
git commit -m "chore(docker): install cloudflared in backend container for proxy command support"
```

---

## Task 7: Frontend — types, API, and machine form

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/machines.ts`
- Modify: `frontend/src/pages/Machines.tsx`

- [ ] **Step 1: Add proxyCommand to the Machine type**

In `frontend/src/types/index.ts`, update the `Machine` interface:

```typescript
export interface Machine {
  id: number
  name: string
  host: string
  port: number
  sshUser: string
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'ERROR'
  proxyCommand: string | null
  lastSeen: string | null
  createdAt: string
  ownerId: number
}
```

- [ ] **Step 2: Add proxyCommand to MachineRequest in the API client**

In `frontend/src/api/machines.ts`:

```typescript
import client from './client'
import type { Machine } from '../types'

export interface MachineRequest {
  name: string
  host: string
  port: number
  sshUser: string
  privateKey: string
  proxyCommand?: string
}

export const getMachines = () => client.get<Machine[]>('/machines').then((r) => r.data)
export const getMachine = (id: number) => client.get<Machine>(`/machines/${id}`).then((r) => r.data)
export const createMachine = (data: MachineRequest) => client.post<Machine>('/machines', data).then((r) => r.data)
export const updateMachine = (id: number, data: MachineRequest) => client.put<Machine>(`/machines/${id}`, data).then((r) => r.data)
export const deleteMachine = (id: number) => client.delete(`/machines/${id}`)
export const testMachine = (id: number) => client.post<{ online: boolean }>(`/machines/${id}/test`).then((r) => r.data)
export const execOnMachine = (id: number, command: string) =>
  client.post<{ stdout: string; stderr: string; exitCode: number }>(`/machines/${id}/exec`, { command }).then((r) => r.data)
```

- [ ] **Step 3: Update emptyForm in Machines.tsx**

Find line 8:
```typescript
const emptyForm: MachineRequest = { name: '', host: '', port: 22, sshUser: '', privateKey: '' }
```
Replace with:
```typescript
const emptyForm: MachineRequest = { name: '', host: '', port: 22, sshUser: '', privateKey: '', proxyCommand: '' }
```

- [ ] **Step 4: Pre-fill proxyCommand when editing a machine**

Find the edit button's `onClick` (around line 146):
```typescript
setForm({ name: m.name, host: m.host, port: m.port, sshUser: m.sshUser, privateKey: '' })
```
Replace with:
```typescript
setForm({ name: m.name, host: m.host, port: m.port, sshUser: m.sshUser, privateKey: '', proxyCommand: m.proxyCommand ?? '' })
```

- [ ] **Step 5: Add the Proxy Command form field**

In the register/edit modal form (`<form>` block), add this field after the private key `<textarea>` block and before the error display:

```tsx
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">
                  Proxy Command <span className="normal-case font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  className="input-field mono"
                  placeholder="cloudflared access ssh --hostname %h"
                  value={form.proxyCommand ?? ''}
                  onChange={e => setForm({ ...form, proxyCommand: e.target.value })}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Required for machines behind Cloudflare SSH tunnels. Use %h and %p as host/port placeholders.
                </p>
              </div>
```

- [ ] **Step 6: Show a proxy indicator on machine cards**

In the machine card, after the `{m.sshUser}@{m.host}:{m.port}` line (around line 117), add:

```tsx
                  {m.proxyCommand && (
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5" title={m.proxyCommand}>
                      via proxy
                    </p>
                  )}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/machines.ts frontend/src/pages/Machines.tsx
git commit -m "feat(frontend): add proxyCommand field to machine registration form and card display"
```

---

## Task 8: End-to-end verification

No automated tests exist in this codebase. These manual steps verify the full path.

- [ ] **Step 1: Build and start the full stack**

```bash
docker compose up --build -d
```

Wait ~30s for services to be healthy:
```bash
docker compose ps
```
Expected: all 5 services show `healthy` or `running`.

- [ ] **Step 2: Register your Mac Mini with proxy command**

Open `http://localhost:3000`. Log in, go to **Machines**, click **Register Machine**:
- Host: `ssh.arise.alcaria.dev`
- Port: `22`
- SSH User: `<your mac mini user>`
- Private Key: paste the PEM private key
- Proxy Command: `cloudflared access ssh --hostname %h`

Save.

- [ ] **Step 3: Test SSH connection**

Click **Test** on the machine card.

Expected: status flips to `ONLINE`. If it stays `ERROR`, check backend logs:
```bash
docker compose logs backend --tail=50
```
Look for the JSch error message. Common issue: `cloudflared` not on PATH in container — verify with:
```bash
docker compose exec backend cloudflared --version
```

- [ ] **Step 4: Verify SSH terminal works**

Click **Terminal** on the machine card. You should get a working shell on the Mac Mini.

- [ ] **Step 5: Trigger a deployment to the Mac Mini**

Go to **Deployments**, click **New Deployment**, pick the Mac Mini as the target machine, select a GitHub repo and branch. Start the deployment. Watch logs stream in real time.

Expected: deployment completes with `SUCCESS` status.

- [ ] **Step 6: Verify a machine without proxy command still works**

If you have another machine with a direct IP, register it without a proxy command and confirm it still connects — this validates the `null` proxy path doesn't break anything.
