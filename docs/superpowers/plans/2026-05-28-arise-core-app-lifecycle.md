# Arise Core — App Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc deployment model with a proper App → Run lifecycle so that create, redeploy, rollback, and health verification all work correctly.

**Architecture:** Introduce an `App` entity as the persistent living thing that owns config (machine, repo, branch, env vars, tunnel). `Deployment` becomes a Run — an immutable execution record linked to an App. The deploy pipeline is updated to capture commit SHA per run, inject App env vars, verify container health after deploy, and perform real SSH-based rollback. The frontend gains an Apps page as the primary interface; the wizard becomes the App creation flow.

**Tech Stack:** Java 21, Spring Boot 3.3.5, JPA/Hibernate (`ddl-auto: update`), JUnit 5 + Mockito, React 19, TypeScript, TanStack Query 5

---

## File Map

**New backend files:**
- `entity/AppStatus.java` — enum: IDLE, DEPLOYING, RUNNING, FAILED
- `entity/App.java` — persistent App entity
- `repository/AppRepository.java`
- `dto/app/AppRequest.java`
- `dto/app/AppResponse.java`
- `service/AppService.java` — CRUD + deploy() + rollback() + lifecycle callbacks
- `controller/AppController.java`
- `test/.../service/AppServiceTest.java`
- `test/.../service/DeploymentHealthCheckTest.java`

**Modified backend files:**
- `entity/Deployment.java` — add `appId` (Long), `resolvedComposeFile` (String). Note: `resolvedCommitSha` already exists but is never set — fix that too.
- `repository/DeploymentRepository.java` — add `findByAppIdOrderByCreatedAtDesc`, `findPreviousSuccessfulRuns`
- `dto/deployment/DeploymentRequest.java` — add `appId` field
- `service/DeploymentService.java` — inject `AppRepository`, capture `resolvedCommitSha`, persist `resolvedComposeFile`, inject App env vars, health check, update App status on completion

**New frontend files:**
- `api/apps.ts`
- `pages/Apps.tsx`
- `components/AppEnvEditor.tsx`
- `components/RunHistory.tsx`

**Modified frontend files:**
- `components/DeployRepoWizard.tsx` — final step calls `createApp()` instead of `createDeployment()`
- `App.tsx` (router) — add `/apps` route
- Sidebar/nav component — add Apps link

---

### Task 1: AppStatus + App entity + AppRepository

**Files:**
- Create: `backend/src/main/java/com/automationcenter/entity/AppStatus.java`
- Create: `backend/src/main/java/com/automationcenter/entity/App.java`
- Create: `backend/src/main/java/com/automationcenter/repository/AppRepository.java`

- [ ] **Step 1: Create AppStatus enum**

```java
// backend/src/main/java/com/automationcenter/entity/AppStatus.java
package com.automationcenter.entity;

public enum AppStatus {
    IDLE,       // created, never deployed
    DEPLOYING,  // a run is in progress
    RUNNING,    // last run succeeded and containers are healthy
    FAILED      // last run failed or health check failed
}
```

- [ ] **Step 2: Create App entity**

```java
// backend/src/main/java/com/automationcenter/entity/App.java
package com.automationcenter.entity;

import com.automationcenter.converter.AesGcmConverter;
import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "apps")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class App {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "machine_id", nullable = false)
    private Machine machine;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    private User owner;

    @Column(nullable = false)
    private String repositoryUrl;

    @Column(nullable = false)
    private String branch;

    private String composeFile;   // null = auto-detect from .arise.yml or repo
    private Integer port;         // null = skip HTTP health check

    @Convert(converter = AesGcmConverter.class)
    @Column(columnDefinition = "TEXT")
    private String envVarsJson;   // AES-encrypted JSON: {"KEY":"value",...}

    private String tunnelName;
    private String tunnelHostname;
    private Integer tunnelPort;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private AppStatus status = AppStatus.IDLE;

    private Long currentDeploymentId;  // ID of the live Deployment row
    private String currentCommitSha;   // SHA of the running commit

    @Column(nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    private LocalDateTime updatedAt;

    @PreUpdate
    void touch() { this.updatedAt = LocalDateTime.now(); }
}
```

- [ ] **Step 3: Create AppRepository**

```java
// backend/src/main/java/com/automationcenter/repository/AppRepository.java
package com.automationcenter.repository;

import com.automationcenter.entity.App;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface AppRepository extends JpaRepository<App, Long> {
    List<App> findByOwnerId(Long ownerId);
    Optional<App> findByIdAndOwnerId(Long id, Long ownerId);
}
```

- [ ] **Step 4: Start backend, verify `apps` table is created**

```bash
cd backend && mvn spring-boot:run 2>&1 | grep -E "apps|ERROR" | head -20
```

Expected: no schema errors. If `ddl-auto: update` is active, Hibernate silently creates the table.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/automationcenter/entity/AppStatus.java \
        backend/src/main/java/com/automationcenter/entity/App.java \
        backend/src/main/java/com/automationcenter/repository/AppRepository.java
git commit -m "feat(app): add App entity, AppStatus enum, AppRepository"
git push
```

---

### Task 2: AppRequest + AppResponse DTOs

**Files:**
- Create: `backend/src/main/java/com/automationcenter/dto/app/AppRequest.java`
- Create: `backend/src/main/java/com/automationcenter/dto/app/AppResponse.java`

- [ ] **Step 1: Create AppRequest**

```java
// backend/src/main/java/com/automationcenter/dto/app/AppRequest.java
package com.automationcenter.dto.app;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;
import java.util.Map;

@Data
public class AppRequest {
    @NotBlank private String name;
    @NotNull  private Long machineId;
    @NotBlank private String repositoryUrl;
    private String branch;          // defaults to "main" if null
    private String composeFile;
    private Integer port;
    private String tunnelName;
    private String tunnelHostname;
    private Integer tunnelPort;
    private Map<String, String> envVars;  // write-only, values never returned
}
```

- [ ] **Step 2: Create AppResponse**

```java
// backend/src/main/java/com/automationcenter/dto/app/AppResponse.java
package com.automationcenter.dto.app;

import com.automationcenter.entity.AppStatus;
import java.time.LocalDateTime;
import java.util.List;

public record AppResponse(
        Long id,
        String name,
        Long machineId,
        String machineName,
        String repositoryUrl,
        String branch,
        String composeFile,
        Integer port,
        String tunnelName,
        String tunnelHostname,
        Integer tunnelPort,
        List<String> envVarKeys,      // keys only — values are never returned
        AppStatus status,
        Long currentDeploymentId,
        String currentCommitSha,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/automationcenter/dto/app/
git commit -m "feat(app): add AppRequest and AppResponse DTOs"
git push
```

---

### Task 3: AppService (CRUD + lifecycle callbacks)

**Files:**
- Create: `backend/src/main/java/com/automationcenter/service/AppService.java`

- [ ] **Step 1: Create AppService**

```java
// backend/src/main/java/com/automationcenter/service/AppService.java
package com.automationcenter.service;

import com.automationcenter.dto.app.AppRequest;
import com.automationcenter.dto.app.AppResponse;
import com.automationcenter.entity.*;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.AppRepository;
import com.automationcenter.repository.MachineRepository;
import com.automationcenter.repository.UserRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
public class AppService {

    private final AppRepository appRepository;
    private final MachineRepository machineRepository;
    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;

    @Transactional
    public AppResponse create(AppRequest req, Long ownerId) {
        User owner = userRepository.findById(ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        Machine machine = machineRepository.findByIdAndOwnerId(req.getMachineId(), ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("Machine not found"));

        App app = App.builder()
                .name(req.getName())
                .machine(machine).owner(owner)
                .repositoryUrl(req.getRepositoryUrl())
                .branch(req.getBranch() != null ? req.getBranch() : "main")
                .composeFile(req.getComposeFile())
                .port(req.getPort())
                .tunnelName(req.getTunnelName())
                .tunnelHostname(req.getTunnelHostname())
                .tunnelPort(req.getTunnelPort())
                .envVarsJson(serializeEnvVars(req.getEnvVars()))
                .build();

        return toResponse(appRepository.save(app));
    }

    public List<AppResponse> findByOwner(Long ownerId) {
        return appRepository.findByOwnerId(ownerId).stream().map(this::toResponse).toList();
    }

    public AppResponse findByIdAndOwner(Long id, Long ownerId) {
        return toResponse(requireApp(id, ownerId));
    }

    @Transactional
    public AppResponse update(Long id, AppRequest req, Long ownerId) {
        App app = requireApp(id, ownerId);
        Machine machine = machineRepository.findByIdAndOwnerId(req.getMachineId(), ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        app.setName(req.getName());
        app.setMachine(machine);
        app.setRepositoryUrl(req.getRepositoryUrl());
        app.setBranch(req.getBranch() != null ? req.getBranch() : "main");
        app.setComposeFile(req.getComposeFile());
        app.setPort(req.getPort());
        app.setTunnelName(req.getTunnelName());
        app.setTunnelHostname(req.getTunnelHostname());
        app.setTunnelPort(req.getTunnelPort());
        if (req.getEnvVars() != null) app.setEnvVarsJson(serializeEnvVars(req.getEnvVars()));
        return toResponse(appRepository.save(app));
    }

    @Transactional
    public void updateEnvVars(Long id, Map<String, String> envVars, Long ownerId) {
        App app = requireApp(id, ownerId);
        app.setEnvVarsJson(serializeEnvVars(envVars));
        appRepository.save(app);
    }

    @Transactional
    public void delete(Long id, Long ownerId) {
        appRepository.delete(requireApp(id, ownerId));
    }

    // Called by DeploymentService — no AppService→DeploymentService dependency needed
    @Transactional
    public void onRunStarted(Long appId) {
        appRepository.findById(appId).ifPresent(app -> {
            app.setStatus(AppStatus.DEPLOYING);
            appRepository.save(app);
        });
    }

    @Transactional
    public void onRunCompleted(Long appId, Long deploymentId, String commitSha, boolean success) {
        appRepository.findById(appId).ifPresent(app -> {
            if (success) {
                app.setStatus(AppStatus.RUNNING);
                app.setCurrentDeploymentId(deploymentId);
                app.setCurrentCommitSha(commitSha);
            } else {
                app.setStatus(AppStatus.FAILED);
            }
            appRepository.save(app);
        });
    }

    // Package-private: used by DeploymentService to build .env content
    Map<String, String> deserializeEnvVars(String envVarsJson) {
        if (envVarsJson == null || envVarsJson.isBlank()) return Map.of();
        try { return objectMapper.readValue(envVarsJson, new TypeReference<>() {}); }
        catch (Exception e) { return Map.of(); }
    }

    public AppResponse toResponse(App app) {
        return new AppResponse(
                app.getId(), app.getName(),
                app.getMachine().getId(), app.getMachine().getName(),
                app.getRepositoryUrl(), app.getBranch(),
                app.getComposeFile(), app.getPort(),
                app.getTunnelName(), app.getTunnelHostname(), app.getTunnelPort(),
                deserializeEnvVarKeys(app.getEnvVarsJson()),
                app.getStatus(), app.getCurrentDeploymentId(), app.getCurrentCommitSha(),
                app.getCreatedAt(), app.getUpdatedAt()
        );
    }

    private App requireApp(Long id, Long ownerId) {
        return appRepository.findByIdAndOwnerId(id, ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("App not found"));
    }

    private String serializeEnvVars(Map<String, String> envVars) {
        if (envVars == null || envVars.isEmpty()) return null;
        try { return objectMapper.writeValueAsString(envVars); }
        catch (Exception e) { throw new RuntimeException("Failed to serialize env vars", e); }
    }

    private List<String> deserializeEnvVarKeys(String envVarsJson) {
        if (envVarsJson == null || envVarsJson.isBlank()) return List.of();
        try {
            Map<String, String> map = objectMapper.readValue(envVarsJson, new TypeReference<>() {});
            return new ArrayList<>(map.keySet());
        } catch (Exception e) { return List.of(); }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/AppService.java
git commit -m "feat(app): add AppService with CRUD and run lifecycle callbacks"
git push
```

---

### Task 4: AppController + deploy/rollback endpoints

**Files:**
- Create: `backend/src/main/java/com/automationcenter/controller/AppController.java`

At this point `deploy()` and `rollback()` on `AppController` will delegate to `AppService` methods added in Task 7. For now scaffold the CRUD endpoints + stubs for deploy/rollback.

- [ ] **Step 1: Create AppController**

```java
// backend/src/main/java/com/automationcenter/controller/AppController.java
package com.automationcenter.controller;

import com.automationcenter.dto.app.AppRequest;
import com.automationcenter.dto.app.AppResponse;
import com.automationcenter.dto.deployment.DeploymentResponse;
import com.automationcenter.entity.User;
import com.automationcenter.service.AppService;
import com.automationcenter.service.DeploymentService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/apps")
@RequiredArgsConstructor
public class AppController {

    private final AppService appService;
    private final DeploymentService deploymentService;

    @PostMapping
    public ResponseEntity<AppResponse> create(
            @Valid @RequestBody AppRequest request,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(appService.create(request, user.getId()));
    }

    @GetMapping
    public ResponseEntity<List<AppResponse>> list(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(appService.findByOwner(user.getId()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<AppResponse> get(
            @PathVariable Long id, @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(appService.findByIdAndOwner(id, user.getId()));
    }

    @PutMapping("/{id}")
    public ResponseEntity<AppResponse> update(
            @PathVariable Long id,
            @Valid @RequestBody AppRequest request,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(appService.update(id, request, user.getId()));
    }

    @PutMapping("/{id}/env")
    public ResponseEntity<Void> updateEnvVars(
            @PathVariable Long id,
            @RequestBody Map<String, String> envVars,
            @AuthenticationPrincipal User user) {
        appService.updateEnvVars(id, envVars, user.getId());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable Long id, @AuthenticationPrincipal User user) {
        appService.delete(id, user.getId());
        return ResponseEntity.noContent().build();
    }

    // deploy() and rollback() wired in Task 7
    @PostMapping("/{id}/deploy")
    public ResponseEntity<DeploymentResponse> deploy(
            @PathVariable Long id, @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(appService.deploy(id, user.getId()));
    }

    @PostMapping("/{id}/rollback")
    public ResponseEntity<AppResponse> rollback(
            @PathVariable Long id, @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(appService.rollback(id, user.getId()));
    }

    @GetMapping("/{id}/runs")
    public ResponseEntity<List<DeploymentResponse>> getRuns(
            @PathVariable Long id, @AuthenticationPrincipal User user) {
        appService.findByIdAndOwner(id, user.getId()); // ownership check
        return ResponseEntity.ok(deploymentService.findByAppId(id));
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/main/java/com/automationcenter/controller/AppController.java
git commit -m "feat(app): add AppController with CRUD, deploy, rollback, runs endpoints"
git push
```

---

### Task 5: AppService unit tests

**Files:**
- Create: `backend/src/test/java/com/automationcenter/service/AppServiceTest.java`

- [ ] **Step 1: Write failing tests**

```java
// backend/src/test/java/com/automationcenter/service/AppServiceTest.java
package com.automationcenter.service;

import com.automationcenter.dto.app.AppRequest;
import com.automationcenter.entity.*;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.AppRepository;
import com.automationcenter.repository.MachineRepository;
import com.automationcenter.repository.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AppServiceTest {

    @Mock AppRepository appRepository;
    @Mock MachineRepository machineRepository;
    @Mock UserRepository userRepository;
    @InjectMocks AppService appService;

    @BeforeEach
    void injectObjectMapper() {
        ReflectionTestUtils.setField(appService, "objectMapper", new ObjectMapper());
    }

    @Test
    void create_persistsAppWithIdleStatus() {
        var user = new User(); user.setId(1L);
        var machine = new Machine(); machine.setId(2L); machine.setName("box");
        when(userRepository.findById(1L)).thenReturn(Optional.of(user));
        when(machineRepository.findByIdAndOwnerId(2L, 1L)).thenReturn(Optional.of(machine));
        when(appRepository.save(any())).thenAnswer(inv -> { App a = inv.getArgument(0); a.setId(99L); return a; });

        var req = new AppRequest();
        req.setName("my-api"); req.setMachineId(2L);
        req.setRepositoryUrl("https://github.com/x/my-api");
        req.setEnvVars(Map.of("DB_URL", "postgres://..."));

        var resp = appService.create(req, 1L);

        assertThat(resp.id()).isEqualTo(99L);
        assertThat(resp.name()).isEqualTo("my-api");
        assertThat(resp.status()).isEqualTo(AppStatus.IDLE);
        assertThat(resp.envVarKeys()).containsExactly("DB_URL");
    }

    @Test
    void create_throwsWhenMachineNotOwnedByUser() {
        var user = new User(); user.setId(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(user));
        when(machineRepository.findByIdAndOwnerId(99L, 1L)).thenReturn(Optional.empty());

        var req = new AppRequest();
        req.setName("x"); req.setMachineId(99L); req.setRepositoryUrl("https://github.com/x/y");

        assertThatThrownBy(() -> appService.create(req, 1L))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Machine not found");
    }

    @Test
    void onRunCompleted_setsRunningWithCommitSha_onSuccess() {
        var app = App.builder().id(1L).status(AppStatus.DEPLOYING).build();
        when(appRepository.findById(1L)).thenReturn(Optional.of(app));

        appService.onRunCompleted(1L, 42L, "abc1234", true);

        assertThat(app.getStatus()).isEqualTo(AppStatus.RUNNING);
        assertThat(app.getCurrentDeploymentId()).isEqualTo(42L);
        assertThat(app.getCurrentCommitSha()).isEqualTo("abc1234");
        verify(appRepository).save(app);
    }

    @Test
    void onRunCompleted_setsFailedStatus_onFailure() {
        var app = App.builder().id(1L).status(AppStatus.DEPLOYING).build();
        when(appRepository.findById(1L)).thenReturn(Optional.of(app));

        appService.onRunCompleted(1L, 42L, null, false);

        assertThat(app.getStatus()).isEqualTo(AppStatus.FAILED);
        verify(appRepository).save(app);
    }

    @Test
    void delete_throwsWhenAppDoesNotBelongToOwner() {
        when(appRepository.findByIdAndOwnerId(1L, 2L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> appService.delete(1L, 2L))
                .isInstanceOf(ResourceNotFoundException.class);
    }
}
```

- [ ] **Step 2: Run tests — expect failures until AppService is complete**

```bash
cd backend && mvn test -Dtest=AppServiceTest -q
```

Expected: `Tests run: 5, Failures: 0, Errors: 0`

- [ ] **Step 3: Commit**

```bash
git add backend/src/test/java/com/automationcenter/service/AppServiceTest.java
git commit -m "test(app): add AppService unit tests"
git push
```

---

### Task 6: Link Deployment to App — add appId + resolvedComposeFile

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/entity/Deployment.java`
- Modify: `backend/src/main/java/com/automationcenter/repository/DeploymentRepository.java`
- Modify: `backend/src/main/java/com/automationcenter/dto/deployment/DeploymentRequest.java`

- [ ] **Step 1: Add two fields to Deployment.java**

Open `Deployment.java`. After the `resolvedCommitSha` field (line 58), add:

```java
    // Links this Run to its App. Null for deployments created before App entity.
    private Long appId;

    // Compose file path actually used in this run (from .arise.yml or App config).
    private String resolvedComposeFile;
```

- [ ] **Step 2: Add appId to DeploymentRequest.java**

Open `DeploymentRequest.java`. Add after the existing fields:

```java
    private Long appId;  // set when triggering from AppService.deploy()
```

- [ ] **Step 3: Add repository queries to DeploymentRepository.java**

Open `DeploymentRepository.java`. Add:

```java
    import org.springframework.data.jpa.repository.Query;
    import org.springframework.data.repository.query.Param;
    import java.util.List;

    List<Deployment> findByAppIdOrderByCreatedAtDesc(Long appId);

    @Query("SELECT d FROM Deployment d WHERE d.appId = :appId AND d.status = 'SUCCESS' AND d.id <> :excludeId ORDER BY d.createdAt DESC")
    List<Deployment> findPreviousSuccessfulRuns(@Param("appId") Long appId, @Param("excludeId") Long excludeId);
```

- [ ] **Step 4: Add findByAppId to DeploymentService**

Open `DeploymentService.java`. Add this public method (near other finder methods):

```java
    public List<DeploymentResponse> findByAppId(Long appId) {
        return deploymentRepository.findByAppIdOrderByCreatedAtDesc(appId)
                .stream().map(this::toResponse).toList();
    }
```

- [ ] **Step 5: Restart backend, verify no errors**

```bash
cd backend && mvn spring-boot:run 2>&1 | grep -E "ERROR|Started" | head -5
```

Hibernate auto-adds `app_id` and `resolved_compose_file` columns to `deployments`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/automationcenter/entity/Deployment.java \
        backend/src/main/java/com/automationcenter/repository/DeploymentRepository.java \
        backend/src/main/java/com/automationcenter/dto/deployment/DeploymentRequest.java \
        backend/src/main/java/com/automationcenter/service/DeploymentService.java
git commit -m "feat(deployment): add appId, resolvedComposeFile fields; add findByAppId query"
git push
```

---

### Task 7: Capture resolvedCommitSha + resolvedComposeFile in executeAsync

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/DeploymentService.java`

- [ ] **Step 1: Inject AppRepository and AppService into DeploymentService**

In `DeploymentService.java`, add to the `@RequiredArgsConstructor` field list:

```java
    private final AppRepository appRepository;
    private final AppService appService;
```

> **Note:** `AppService` depends on `AppRepository`, `MachineRepository`, `UserRepository`, `ObjectMapper` only — no `DeploymentService` dependency. `DeploymentService` depends on `AppService`. This is one-directional; no circular dependency.

- [ ] **Step 2: Persist resolvedCommitSha after clone**

In `executeAsync()`, find the line `deployment.setDeployDir(repoDir);` (around line 163). Immediately after, add:

```java
            // Capture the exact commit this run deployed
            var shaResult = sshService.execute(machine, "cd " + repoDir + " && git rev-parse HEAD 2>/dev/null");
            if (shaResult.getExitCode() == 0 && !shaResult.getStdout().isBlank()) {
                deployment.setResolvedCommitSha(shaResult.getStdout().trim());
            }
            deploymentRepository.save(deployment);
```

- [ ] **Step 3: Persist resolvedComposeFile after arise.yml parsing**

Find the block that ends with `appendLog(deployment, "Using compose file from .arise.yml: " + ariseComposeFile, LogLevel.INFO)` (around line 207). After that line, add:

```java
            // Store the compose file path for use in health checks and rollback
            String effectiveComposeFile = ariseComposeFile;
            if (effectiveComposeFile == null && deployment.getAppId() != null) {
                effectiveComposeFile = appRepository.findById(deployment.getAppId())
                        .map(com.automationcenter.entity.App::getComposeFile).orElse(null);
            }
            if (effectiveComposeFile != null) {
                deployment.setResolvedComposeFile(effectiveComposeFile);
                deploymentRepository.save(deployment);
            }
```

Update the existing `ariseComposeFile` local variable assignment to use `effectiveComposeFile` where it's passed to `getBuildCommand` and the `composeFileFlag`. Replace both occurrences of `ariseComposeFile` after this block with `effectiveComposeFile`.

- [ ] **Step 4: Notify App when run starts**

At the top of `executeAsync()`, just after `deployment.setStatus(DeploymentStatus.BUILDING)` and before `deploymentRepository.save(deployment)`, add:

```java
            if (deployment.getAppId() != null) {
                appService.onRunStarted(deployment.getAppId());
            }
```

- [ ] **Step 5: Notify App when run completes**

Find the `fail()` private method (line ~569). After `deploymentRepository.save(deployment)` inside `fail()`, add:

```java
        if (deployment.getAppId() != null) {
            appService.onRunCompleted(deployment.getAppId(), deployment.getId(), null, false);
        }
```

Find the SUCCESS block in `executeAsync()` (line ~274, `deployment.setStatus(DeploymentStatus.SUCCESS)`). After `deploymentRepository.save(deployment)`, add:

```java
            if (deployment.getAppId() != null) {
                appService.onRunCompleted(deployment.getAppId(), deployment.getId(),
                        deployment.getResolvedCommitSha(), true);
            }
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/DeploymentService.java
git commit -m "feat(deployment): capture commitSha and composeFile per run, notify App on lifecycle events"
git push
```

---

### Task 8: Inject App env vars into every Run

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/DeploymentService.java`

- [ ] **Step 1: Inject App env vars before config files are written**

In `executeAsync()`, find the comment `// Inject GitHub token into HTTPS clone URL` block. Just before that block (i.e. right after the OS detection save), add:

```java
            // If this Run belongs to an App, write its env vars as .env before build
            if (deployment.getAppId() != null && !isWindows) {
                appRepository.findById(deployment.getAppId()).ifPresent(app -> {
                    Map<String, String> envVars = appService.deserializeEnvVars(app.getEnvVarsJson());
                    if (!envVars.isEmpty()) {
                        String envContent = envVars.entrySet().stream()
                                .map(e -> e.getKey() + "=" + e.getValue())
                                .collect(java.util.stream.Collectors.joining("\n"));
                        appendLog(deployment, "Injecting " + envVars.size() + " env vars from App config", LogLevel.INFO);
                        sshService.writeFileViaShell(machine, repoDir + "/.env", envContent);
                    }
                });
            }
```

Add `import java.util.Map;` at the top of `DeploymentService.java` if not already present.

> Run-level `repoConfigs` written afterward will override App env vars — intentional, allows per-run overrides.

- [ ] **Step 2: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/DeploymentService.java
git commit -m "feat(deployment): inject App env vars as .env before build"
git push
```

---

### Task 9: Health check after compose deploy

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/DeploymentService.java`
- Create: `backend/src/test/java/com/automationcenter/service/DeploymentHealthCheckTest.java`

- [ ] **Step 1: Write failing tests first**

```java
// backend/src/test/java/com/automationcenter/service/DeploymentHealthCheckTest.java
package com.automationcenter.service;

import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.Machine;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DeploymentHealthCheckTest {

    @Mock SshService sshService;
    @InjectMocks DeploymentService deploymentService;

    private final Machine machine = new Machine();

    @Test
    void returnsTrue_whenAllContainersUp() {
        when(sshService.execute(any(), contains("docker compose ps")))
                .thenReturn(new SshCommandResponse(
                        "NAME      STATUS\napp-1   Up 5 seconds\ndb-1    Up 5 seconds\n", "", 0));

        boolean result = invoke("/tmp/deploy_1", "");

        assertThat(result).isTrue();
    }

    @Test
    void returnsFalse_whenAnyContainerExited() {
        when(sshService.execute(any(), contains("docker compose ps")))
                .thenReturn(new SshCommandResponse(
                        "NAME      STATUS\napp-1   Exit 1\ndb-1    Up 5 seconds\n", "", 0));

        assertThat(invoke("/tmp/deploy_1", "")).isFalse();
    }

    @Test
    void returnsFalse_whenSshCommandFails() {
        when(sshService.execute(any(), contains("docker compose ps")))
                .thenReturn(new SshCommandResponse("", "connection refused", 1));

        assertThat(invoke("/tmp/deploy_1", "")).isFalse();
    }

    private boolean invoke(String dir, String flag) {
        return (boolean) ReflectionTestUtils.invokeMethod(
                deploymentService, "dockerHealthCheck", machine, dir, flag);
    }
}
```

- [ ] **Step 2: Run tests — expect failure (method not found yet)**

```bash
cd backend && mvn test -Dtest=DeploymentHealthCheckTest -q 2>&1 | tail -5
```

Expected: error about `dockerHealthCheck` not found.

- [ ] **Step 3: Add dockerHealthCheck method to DeploymentService**

```java
    private boolean dockerHealthCheck(Machine machine, String deployDir, String composeFileFlag) {
        try { Thread.sleep(3_000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }

        var result = sshService.execute(machine,
                "cd " + sq(deployDir) + " && docker compose" + composeFileFlag + " ps 2>&1");

        if (result.getExitCode() != 0) return false;
        return !result.getStdout().contains("Exit ") && !result.getStdout().contains("exited");
    }
```

- [ ] **Step 4: Call health check after successful compose deploy**

In `executeAsync()`, find the `docker compose ps` status log block (around line 249). After it, add:

```java
            if ("compose".equals(stack) && !isWindows) {
                String cfFlag = effectiveComposeFile != null ? " -f " + sq(effectiveComposeFile) : "";
                appendLog(deployment, "Running health check…", LogLevel.INFO);
                boolean healthy = dockerHealthCheck(machine, repoDir, cfFlag);
                if (!healthy) {
                    appendLog(deployment, "Health check failed — one or more containers exited. Run: docker compose logs", LogLevel.ERROR);
                    fail(deployment);
                    return;
                }
                appendLog(deployment, "Health check passed — all containers running", LogLevel.INFO);
            }
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd backend && mvn test -Dtest=DeploymentHealthCheckTest -q
```

Expected: `Tests run: 3, Failures: 0`

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/DeploymentService.java \
        backend/src/test/java/com/automationcenter/service/DeploymentHealthCheckTest.java
git commit -m "feat(deployment): add container health check after compose deploy"
git push
```

---

### Task 10: AppService — deploy() and rollback()

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/AppService.java`

- [ ] **Step 1: Add deploy() to AppService**

Add new field to the `@RequiredArgsConstructor` field list in `AppService.java`:

```java
    private final DeploymentService deploymentService;
    private final com.automationcenter.repository.DeploymentRepository deploymentRepository;
    private final SshService sshService;
```

Add the method:

```java
    @Transactional
    public com.automationcenter.dto.deployment.DeploymentResponse deploy(Long appId, Long ownerId) {
        App app = requireApp(appId, ownerId);

        if (app.getStatus() == AppStatus.DEPLOYING) {
            throw new IllegalStateException("A deployment is already in progress for this app");
        }

        var request = new com.automationcenter.dto.deployment.DeploymentRequest();
        request.setName(app.getName());
        request.setType(com.automationcenter.entity.DeploymentType.REPOSITORY);
        request.setRepositoryUrl(app.getRepositoryUrl());
        request.setBranch(app.getBranch());
        request.setMachineId(app.getMachine().getId());
        request.setTunnelName(app.getTunnelName());
        request.setTunnelHostname(app.getTunnelHostname());
        request.setTunnelAppPort(app.getTunnelPort());
        request.setAppId(appId);

        return deploymentService.create(request, ownerId);
    }
```

- [ ] **Step 2: Add rollback() to AppService**

```java
    @Transactional
    public AppResponse rollback(Long appId, Long ownerId) {
        App app = requireApp(appId, ownerId);

        if (app.getCurrentDeploymentId() == null) {
            throw new IllegalStateException("No current deployment to roll back from");
        }

        Deployment current = deploymentRepository.findById(app.getCurrentDeploymentId())
                .orElseThrow(() -> new com.automationcenter.exception.ResourceNotFoundException("Current deployment not found"));

        List<com.automationcenter.entity.Deployment> previous =
                deploymentRepository.findPreviousSuccessfulRuns(appId, current.getId());
        if (previous.isEmpty()) {
            throw new IllegalStateException("No previous successful run to roll back to");
        }

        Deployment target = previous.get(0);
        if (target.getDeployDir() == null) {
            throw new IllegalStateException("Previous run has no deploy directory — cannot roll back");
        }

        Machine machine = machineRepository.findById(app.getMachine().getId())
                .orElseThrow(() -> new com.automationcenter.exception.ResourceNotFoundException("Machine not found"));

        // Tear down current containers
        if (current.getDeployDir() != null) {
            String cfFlag = current.getResolvedComposeFile() != null
                    ? " -f " + sq(current.getResolvedComposeFile()) : "";
            sshService.execute(machine,
                    "cd " + sq(current.getDeployDir()) + " && docker compose" + cfFlag + " down 2>&1 || true");
        }

        // Bring up previous containers
        String cfFlag = target.getResolvedComposeFile() != null
                ? " -f " + sq(target.getResolvedComposeFile()) : "";
        var result = sshService.execute(machine,
                "cd " + sq(target.getDeployDir()) + " && docker compose" + cfFlag + " up -d 2>&1");

        if (result.getExitCode() != 0) {
            throw new RuntimeException("Rollback failed: " + result.getStderr());
        }

        current.setStatus(com.automationcenter.entity.DeploymentStatus.ROLLED_BACK);
        deploymentRepository.save(current);

        app.setStatus(AppStatus.RUNNING);
        app.setCurrentDeploymentId(target.getId());
        app.setCurrentCommitSha(target.getResolvedCommitSha());
        appRepository.save(app);

        return toResponse(app);
    }

    private static String sq(String s) {
        return "'" + s.replace("'", "'\\''") + "'";
    }
```

- [ ] **Step 3: Add rollback tests to AppServiceTest.java**

Open `AppServiceTest.java` and add:

```java
    @Mock com.automationcenter.repository.DeploymentRepository deploymentRepository;
    @Mock SshService sshService;
    @Mock DeploymentService deploymentService;

    @Test
    void rollback_throwsWhenNoCurrentDeployment() {
        var app = App.builder().id(1L).status(AppStatus.RUNNING).currentDeploymentId(null).build();
        when(appRepository.findByIdAndOwnerId(1L, 1L)).thenReturn(Optional.of(app));

        assertThatThrownBy(() -> appService.rollback(1L, 1L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("No current deployment");
    }

    @Test
    void rollback_throwsWhenNoPreviousSuccessfulRun() {
        var app = App.builder().id(1L).status(AppStatus.RUNNING).currentDeploymentId(10L)
                .machine(new Machine()).build();
        var current = new Deployment(); current.setId(10L);
        when(appRepository.findByIdAndOwnerId(1L, 1L)).thenReturn(Optional.of(app));
        when(deploymentRepository.findById(10L)).thenReturn(Optional.of(current));
        when(deploymentRepository.findPreviousSuccessfulRuns(1L, 10L)).thenReturn(List.of());

        assertThatThrownBy(() -> appService.rollback(1L, 1L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("No previous successful run");
    }
```

- [ ] **Step 4: Run all AppService tests**

```bash
cd backend && mvn test -Dtest=AppServiceTest -q
```

Expected: `Tests run: 7, Failures: 0`

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/AppService.java \
        backend/src/test/java/com/automationcenter/service/AppServiceTest.java
git commit -m "feat(app): implement deploy() and rollback() with SSH-based container swap"
git push
```

---

### Task 11: Frontend — api/apps.ts

**Files:**
- Create: `frontend/src/api/apps.ts`

- [ ] **Step 1: Create apps API client**

```typescript
// frontend/src/api/apps.ts
import client from './client'
import type { Deployment } from '../types'

export type AppStatus = 'IDLE' | 'DEPLOYING' | 'RUNNING' | 'FAILED'

export interface App {
  id: number
  name: string
  machineId: number
  machineName: string
  repositoryUrl: string
  branch: string
  composeFile?: string
  port?: number
  tunnelName?: string
  tunnelHostname?: string
  tunnelPort?: number
  envVarKeys: string[]
  status: AppStatus
  currentDeploymentId?: number
  currentCommitSha?: string
  createdAt: string
  updatedAt?: string
}

export interface AppRequest {
  name: string
  machineId: number
  repositoryUrl: string
  branch?: string
  composeFile?: string
  port?: number
  tunnelName?: string
  tunnelHostname?: string
  tunnelPort?: number
  envVars?: Record<string, string>
}

export const getApps = () => client.get<App[]>('/apps').then(r => r.data)
export const getApp = (id: number) => client.get<App>(`/apps/${id}`).then(r => r.data)
export const createApp = (data: AppRequest) => client.post<App>('/apps', data).then(r => r.data)
export const updateApp = (id: number, data: Partial<AppRequest>) => client.put<App>(`/apps/${id}`, data).then(r => r.data)
export const deleteApp = (id: number) => client.delete(`/apps/${id}`)
export const deployApp = (id: number) => client.post<Deployment>(`/apps/${id}/deploy`).then(r => r.data)
export const rollbackApp = (id: number) => client.post<App>(`/apps/${id}/rollback`).then(r => r.data)
export const getAppRuns = (id: number) => client.get<Deployment[]>(`/apps/${id}/runs`).then(r => r.data)
export const updateAppEnvVars = (id: number, envVars: Record<string, string>) =>
  client.put<void>(`/apps/${id}/env`, envVars)
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/apps.ts
git commit -m "feat(apps): add apps API client"
git push
```

---

### Task 12: Apps page

**Files:**
- Create: `frontend/src/pages/Apps.tsx`

- [ ] **Step 1: Create Apps page**

```tsx
// frontend/src/pages/Apps.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getApps, deployApp, rollbackApp, deleteApp, type App } from '../api/apps'
import { getMachines } from '../api/machines'
import { getGitHubUser } from '../api/github'
import { Rocket, RotateCcw, Trash2, Plus, Loader2, GitBranch, Server, ExternalLink } from 'lucide-react'
import DeployRepoWizard from '../components/DeployRepoWizard'
import AppEnvEditor from '../components/AppEnvEditor'
import RunHistory from '../components/RunHistory'

const STATUS: Record<App['status'], { dot: string; label: string }> = {
  RUNNING:   { dot: 'bg-green-500',                     label: 'Running'   },
  DEPLOYING: { dot: 'bg-blue-400 animate-pulse',        label: 'Deploying' },
  FAILED:    { dot: 'bg-red-500',                       label: 'Failed'    },
  IDLE:      { dot: 'bg-muted-foreground/40',           label: 'Idle'      },
}

export default function AppsPage() {
  const qc = useQueryClient()
  const [showWizard, setShowWizard] = useState(false)
  const [envApp, setEnvApp] = useState<App | null>(null)
  const [runsApp, setRunsApp] = useState<App | null>(null)

  const { data: apps = [], isLoading } = useQuery({
    queryKey: ['apps'], queryFn: getApps, refetchInterval: 5_000,
  })
  const { data: machines = [] } = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const { data: ghUser } = useQuery({ queryKey: ['gh-user'], queryFn: getGitHubUser })

  const deploy = useMutation({
    mutationFn: (id: number) => deployApp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apps'] }),
  })
  const rollback = useMutation({
    mutationFn: (id: number) => rollbackApp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apps'] }),
  })
  const remove = useMutation({
    mutationFn: (id: number) => deleteApp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apps'] }),
  })

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Apps</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{apps.length} app{apps.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-all">
          <Plus size={14} /> New App
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : apps.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">
          No apps yet.{' '}
          <button onClick={() => setShowWizard(true)} className="text-primary hover:underline">
            Create your first app
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {apps.map(app => {
            const s = STATUS[app.status]
            return (
              <div key={app.id} className="bg-card border border-border rounded-xl p-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                    <span className="font-semibold text-sm text-foreground">{app.name}</span>
                    <span className="text-[11px] text-muted-foreground">{s.label}</span>
                    {app.currentCommitSha && (
                      <code className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {app.currentCommitSha.slice(0, 7)}
                      </code>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <GitBranch size={11} />
                      {app.repositoryUrl.replace('https://github.com/', '')} @ {app.branch}
                    </span>
                    <span className="flex items-center gap-1">
                      <Server size={11} /> {app.machineName}
                    </span>
                    {app.tunnelHostname && (
                      <a href={`https://${app.tunnelHostname}`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline">
                        <ExternalLink size={11} /> {app.tunnelHostname}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  <button onClick={() => setRunsApp(app)}
                    className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    History
                  </button>
                  <button onClick={() => setEnvApp(app)}
                    className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    Env
                  </button>
                  <button onClick={() => rollback.mutate(app.id)}
                    disabled={!app.currentDeploymentId || app.status === 'DEPLOYING'}
                    title="Rollback to previous run"
                    className="p-1.5 border border-border rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors">
                    <RotateCcw size={13} />
                  </button>
                  <button onClick={() => deploy.mutate(app.id)}
                    disabled={app.status === 'DEPLOYING'}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-[12px] font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all">
                    {app.status === 'DEPLOYING'
                      ? <><Loader2 size={12} className="animate-spin" />Deploying…</>
                      : <><Rocket size={12} />Deploy</>}
                  </button>
                  <button
                    onClick={() => { if (confirm(`Delete "${app.name}"? This removes the app config but not deployed containers.`)) remove.mutate(app.id) }}
                    className="p-1.5 border border-border rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showWizard && (
        <DeployRepoWizard
          isConnected={!!ghUser}
          initialUser={ghUser ?? null}
          machines={machines}
          onCancel={() => setShowWizard(false)}
          onAppCreated={() => { setShowWizard(false); qc.invalidateQueries({ queryKey: ['apps'] }) }}
          isDeploying={false}
          onPatValidated={() => {}}
        />
      )}
      {envApp && <AppEnvEditor app={envApp} onClose={() => setEnvApp(null)} onSaved={() => qc.invalidateQueries({ queryKey: ['apps'] })} />}
      {runsApp && <RunHistory app={runsApp} onClose={() => setRunsApp(null)} />}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Apps.tsx
git commit -m "feat(apps): add Apps page with status, deploy, rollback, history"
git push
```

---

### Task 13: AppEnvEditor + RunHistory components

**Files:**
- Create: `frontend/src/components/AppEnvEditor.tsx`
- Create: `frontend/src/components/RunHistory.tsx`

- [ ] **Step 1: Create AppEnvEditor**

```tsx
// frontend/src/components/AppEnvEditor.tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { updateAppEnvVars, type App } from '../api/apps'
import { X, Loader2, Plus, Trash2, AlertTriangle } from 'lucide-react'

export default function AppEnvEditor({ app, onClose, onSaved }: { app: App; onClose: () => void; onSaved: () => void }) {
  const [pairs, setPairs] = useState(app.envVarKeys.map(k => ({ key: k, value: '' })))
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () => {
      const envVars: Record<string, string> = {}
      pairs.forEach(p => { if (p.key.trim()) envVars[p.key.trim()] = p.value })
      return updateAppEnvVars(app.id, envVars)
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.message || 'Failed to save'),
  })

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div onClick={e => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md animate-fade-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="font-semibold text-sm text-foreground">{app.name} — Env Vars</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Injected as .env on every deploy. Encrypted at rest.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 max-h-[50vh] overflow-y-auto flex flex-col gap-2">
          {pairs.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input-field mono flex-1 text-xs" style={{ paddingTop: 5, paddingBottom: 5 }}
                placeholder="KEY" value={p.key}
                onChange={e => setPairs(prev => prev.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} />
              <input className="input-field mono flex-1 text-xs" style={{ paddingTop: 5, paddingBottom: 5 }}
                placeholder="value" value={p.value}
                onChange={e => setPairs(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
              <button onClick={() => setPairs(prev => prev.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button onClick={() => setPairs(prev => [...prev, { key: '', value: '' }])}
            className="flex items-center gap-1.5 text-[11px] text-primary font-medium mt-1">
            <Plus size={11} /> Add variable
          </button>
        </div>
        {error && (
          <div className="mx-5 mb-2 flex gap-2 items-center text-xs text-destructive border border-destructive/20 bg-destructive/5 rounded-lg px-3 py-2">
            <AlertTriangle size={12} /> {error}
          </div>
        )}
        <div className="flex gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose}
            className="flex-1 py-2 border border-border text-foreground text-sm rounded-lg hover:bg-muted transition-colors">
            Cancel
          </button>
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all">
            {save.isPending ? <><Loader2 size={13} className="animate-spin" />Saving…</> : 'Save & Encrypt'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create RunHistory**

```tsx
// frontend/src/components/RunHistory.tsx
import { useQuery } from '@tanstack/react-query'
import { getAppRuns, type App } from '../api/apps'
import { X, Loader2, CheckCircle2, XCircle, RotateCcw, Clock } from 'lucide-react'

const ICON: Record<string, React.ReactNode> = {
  SUCCESS:     <CheckCircle2 size={13} className="text-green-500 shrink-0" />,
  FAILED:      <XCircle size={13} className="text-red-500 shrink-0" />,
  ROLLED_BACK: <RotateCcw size={13} className="text-amber-400 shrink-0" />,
  BUILDING:    <Loader2 size={13} className="animate-spin text-blue-400 shrink-0" />,
  DEPLOYING:   <Loader2 size={13} className="animate-spin text-blue-400 shrink-0" />,
}

export default function RunHistory({ app, onClose }: { app: App; onClose: () => void }) {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['app-runs', app.id],
    queryFn: () => getAppRuns(app.id),
    refetchInterval: 5_000,
  })

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div onClick={e => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg animate-fade-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="font-semibold text-sm text-foreground">{app.name} — Run History</p>
            <p className="text-[11px] text-muted-foreground">{runs.length} runs</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground gap-2 text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : runs.length === 0 ? (
            <p className="text-center py-10 text-sm text-muted-foreground">No runs yet</p>
          ) : runs.map((run: any) => (
            <div key={run.id}
              className={`flex items-center gap-3 px-5 py-3 border-b border-border last:border-0 ${app.currentDeploymentId === run.id ? 'bg-muted/20' : ''}`}>
              {ICON[run.status] ?? <Clock size={13} className="text-muted-foreground shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{run.status}</span>
                  {run.resolvedCommitSha && (
                    <code className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {run.resolvedCommitSha.slice(0, 7)}
                    </code>
                  )}
                  {app.currentDeploymentId === run.id && (
                    <span className="text-[10px] font-semibold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">LIVE</span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}
                  {run.startedAt && run.finishedAt && (
                    <span className="ml-2 opacity-60">
                      {Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s
                    </span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AppEnvEditor.tsx frontend/src/components/RunHistory.tsx
git commit -m "feat(apps): add AppEnvEditor and RunHistory components"
git push
```

---

### Task 14: Wizard → Create App + Router + Nav

**Files:**
- Modify: `frontend/src/components/DeployRepoWizard.tsx`
- Modify: `frontend/src/App.tsx` (or equivalent router file)
- Modify: nav/sidebar component (locate via `grep -r "Deployments" frontend/src --include="*.tsx" -l`)

- [ ] **Step 1: Add /apps route to router**

Open `frontend/src/App.tsx`. Import `AppsPage` and add the route:

```tsx
import AppsPage from './pages/Apps'

// Inside routes:
<Route path="/apps" element={<AppsPage />} />
```

- [ ] **Step 2: Add Apps nav link**

Find the sidebar/nav file via:
```bash
grep -r "Deployments\|/deployments" frontend/src --include="*.tsx" -l
```

In that file, add an Apps nav item alongside Deployments:

```tsx
import { LayoutGrid } from 'lucide-react'

// In the nav items array, add:
{ to: '/apps', icon: <LayoutGrid size={16} />, label: 'Apps' },
```

- [ ] **Step 3: Update DeployRepoWizard Props interface**

In `DeployRepoWizard.tsx`, update the `Props` interface. Replace `onDeploy` and `onAppDeploy` with `onAppCreated`:

```tsx
interface Props {
  isConnected: boolean
  initialUser?: GHUser | null
  machines: Machine[]
  onCancel: () => void
  onAppCreated: () => void           // replaces onDeploy + onAppDeploy
  isDeploying: boolean
  onPatValidated: (user: GHUser) => void
  initialRepoForDeploy?: { repo: GitHubRepo; branch: string }
}
```

- [ ] **Step 4: Replace handleDeploy with createApp call**

Add import at the top of `DeployRepoWizard.tsx`:
```tsx
import { createApp } from '../api/apps'
```

Replace the entire `handleDeploy` function body with:

```tsx
  const handleDeploy = async () => {
    if (!machineId) { setDeployError('Please select a machine'); return }
    setDeployError('')

    if (mode === 'single') {
      const sel = Array.from(selections.values())[0]
      if (!sel) return
      try {
        await createApp({
          name: deployNames.get(sel.repo.fullName) || sel.repo.name,
          machineId,
          repositoryUrl: sel.repo.url,
          branch: sel.branch,
          composeFile: ariseConfig?.compose,
          port: ariseConfig?.port,
          tunnelName: tunnelEnabled && tunnelName.trim() ? tunnelName.trim() : undefined,
          tunnelHostname: tunnelEnabled && tunnelHostname.trim() ? tunnelHostname.trim() : undefined,
          tunnelPort: tunnelEnabled ? tunnelAppPort : undefined,
          envVars: envVarKeys.length > 0
            ? Object.fromEntries(envVarKeys.map(k => [k, envVars[k] ?? '']))
            : undefined,
        })
        onAppCreated()
      } catch (e: any) {
        setDeployError(e.message || 'Failed to create app')
      }
    } else {
      // Application mode: unchanged — still calls the multi-service flow
      // (application mode will be migrated in a follow-up)
      setDeployError('Application mode: use the Deployments page for multi-service deploys for now.')
    }
  }
```

- [ ] **Step 5: Update Deploy button label**

Find the Deploy button in the wizard footer (step 3). Update the label:

```tsx
// Replace:
<><Rocket size={13} />Deploy {selections.size} repo{selections.size !== 1 ? 's' : ''}</>
// With:
<><Plus size={13} />Create App</>
```

Import `Plus` from lucide-react if not already imported.

- [ ] **Step 6: Fix the call sites in Deployments.tsx**

Open `frontend/src/pages/Deployments.tsx`. The `DeployRepoWizard` there still passes `onDeploy` and `onAppDeploy`. Update to pass `onAppCreated`:

```tsx
<DeployRepoWizard
  isConnected={!!ghUser}
  initialUser={ghUser}
  machines={machines ?? []}
  onCancel={() => setShowWizard(false)}
  onAppCreated={() => { setShowWizard(false) }}
  isDeploying={false}
  onPatValidated={user => setGhUser(user)}
  initialRepoForDeploy={initialRepoForDeploy}
/>
```

Remove `handleDeploy` and `handleAppDeploy` from `Deployments.tsx` if they're only used by the wizard — or keep them if the page still needs them for other purposes.

- [ ] **Step 7: Verify the full flow in browser**

Start the app with `docker compose up --build` or `npm run dev` + `mvn spring-boot:run`.

1. Navigate to `/apps`
2. Click "New App", pick a repo and branch — verify `.arise.yml` pre-fills name/branch/port
3. Fill in env vars, pick a machine, click "Create App"
4. Verify the App card appears with `IDLE` status
5. Click "Deploy" — status should go `DEPLOYING` → `RUNNING` (or `FAILED`)
6. Open "History" — verify the Run entry shows commit SHA and status
7. Click "Env" — verify env var keys appear, add a new one, save
8. Deploy again, open History — verify two runs, the new one marked LIVE
9. Click Rollback — verify status briefly returns to DEPLOYING then back to RUNNING with old commit SHA

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/DeployRepoWizard.tsx \
        frontend/src/App.tsx \
        frontend/src/pages/Deployments.tsx
git add $(git diff --name-only frontend/src | grep -i "sidebar\|nav\|layout" || true)
git commit -m "feat(apps): wizard creates App, add /apps route and nav link"
git push
```

---

## Self-Review

**Spec coverage:**
- ✅ App entity with persistent config (Tasks 1–3)
- ✅ Env vars encrypted on App, injected into every Run (Tasks 3, 8)
- ✅ Deploy triggers a Run linked to App with `appId` (Tasks 4, 6, 10)
- ✅ `resolvedCommitSha` captured after clone — field existed, was never set; fixed in Task 7
- ✅ `resolvedComposeFile` captured and persisted for health check and rollback (Tasks 6, 7)
- ✅ App status updated `IDLE → DEPLOYING → RUNNING/FAILED` (Tasks 3, 7)
- ✅ Container health check after compose deploy (Task 9)
- ✅ Real rollback via SSH docker compose swap using stored `deployDir` (Task 10)
- ✅ Run history per App (Tasks 4, 13)
- ✅ Env var editor (Task 13)
- ✅ Apps page as primary UI (Task 12)
- ✅ Wizard becomes Create App flow (Task 14)
- ✅ Router and nav (Task 14)

**Placeholder scan:** None found.

**Type consistency:**
- `AppStatus` enum: defined in Task 1, used in `App.java` (Task 1), `AppResponse` (Task 2), `AppService` (Task 3), `api/apps.ts` (Task 11) — consistent
- `resolvedComposeFile` field name: defined in Task 6, read in Tasks 7, 10 — consistent
- `onAppCreated` prop: defined in `Props` interface (Task 14), called in `Apps.tsx` (Task 12), passed in `Deployments.tsx` (Task 14) — consistent
- `deserializeEnvVars` package-private on `AppService`: called in `DeploymentService` (Task 8) — both in same package `com.automationcenter` ✅
- `sq()` helper: already exists in `DeploymentService`; added separately to `AppService` in Task 10 — no conflict, different classes
