# AWS Accounts, Topology & Payload Tracing Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor AWS from user-level static credentials to a first-class `AwsAccount` entity using AWS SSO profile auth; add Terraform repo ingestion for topology enrichment; add X-Ray payload tracing visualized as a metro-style pipeline.

**Architecture:**
- `AwsAccount` entity (name, profileName, defaultRegion, optional terraformRepoUrl) owned per-user — multiple accounts supported, same pattern as `Machine`.
- Backend reads credentials via `ProfileCredentialsProvider` (SDK v2) from `~/.aws` mounted read-only into the Docker container — no secrets stored in DB.
- Terraform repos are cloned to a temp dir on the backend, `.tf` files parsed with regex to extract `resource` and `module` blocks, merged with live AWS API data into a unified topology graph.
- X-Ray API provides distributed traces; frontend renders them as a metro/pipeline map where each service is a station, failures turn the card red, and clicking opens CloudWatch logs.

**Tech Stack:** AWS SDK v2 (ec2, s3, ecs, sts, lambda, xray, cloudwatch-logs, rds), JGit or shell `git clone` for Terraform repo cloning, React Flow for topology, existing Dagre layout.

---

## File Map

**Create (backend):**
- `entity/AwsAccount.java`
- `repository/AwsAccountRepository.java`
- `dto/aws/AwsAccountRequest.java`
- `dto/aws/AwsAccountResponse.java`
- `service/TerraformParserService.java`
- `service/AwsTopologyService.java`
- `controller/AwsAccountController.java`

**Modify (backend):**
- `pom.xml` — add lambda, xray, cloudwatch-logs, rds, ssm SDK modules
- `entity/User.java` — remove awsAccessKeyId, awsSecretAccessKey, awsDefaultRegion fields
- `service/AwsService.java` — swap StaticCredentialsProvider → ProfileCredentialsProvider, accept accountId
- `controller/AwsController.java` — all endpoints under `/api/aws/accounts/{accountId}/...`
- `docker-compose.yml` — mount host `~/.aws` into backend container read-only

**Create (frontend):**
- `api/awsAccounts.ts`
- `pages/AwsAccounts.tsx` — account list + register/delete
- `pages/AwsTopology.tsx` — React Flow graph for one account's topology

**Modify (frontend):**
- `api/aws.ts` — all fns take `accountId: number` instead of nothing
- `pages/AWS.tsx` — add account selector; add Topology tab; add Traces tab
- `App.tsx` — add `/aws/topology` route
- `Layout.tsx` — no change (AWS nav entry already there)

---

### Task 1: Add AWS SDK modules for Lambda, X-Ray, CloudWatch Logs, RDS

**Files:**
- Modify: `backend/pom.xml`

- [ ] **Step 1: Add four new SDK module dependencies inside `<dependencies>`**

After the existing `software.amazon.awssdk:sts` dependency, add:

```xml
<dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>lambda</artifactId>
</dependency>
<dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>xray</artifactId>
</dependency>
<dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>cloudwatch-logs</artifactId>
</dependency>
<dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>rds</artifactId>
</dependency>
```

- [ ] **Step 2: Commit**

```bash
git add backend/pom.xml
git commit -m "build: add lambda, xray, cloudwatch-logs, rds AWS SDK modules"
```

---

### Task 2: Create AwsAccount entity and repository

**Files:**
- Create: `backend/src/main/java/com/automationcenter/entity/AwsAccount.java`
- Create: `backend/src/main/java/com/automationcenter/repository/AwsAccountRepository.java`

- [ ] **Step 1: Create `AwsAccount.java`**

```java
package com.automationcenter.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "aws_accounts")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AwsAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String profileName;

    @Column(nullable = false, length = 50)
    private String defaultRegion;

    @Column(columnDefinition = "TEXT")
    private String terraformRepoUrl;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    private User owner;

    @CreationTimestamp
    private LocalDateTime createdAt;
}
```

- [ ] **Step 2: Create `AwsAccountRepository.java`**

```java
package com.automationcenter.repository;

import com.automationcenter.entity.AwsAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AwsAccountRepository extends JpaRepository<AwsAccount, Long> {
    List<AwsAccount> findByOwnerId(Long ownerId);
    Optional<AwsAccount> findByIdAndOwnerId(Long id, Long ownerId);
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/automationcenter/entity/AwsAccount.java \
        backend/src/main/java/com/automationcenter/repository/AwsAccountRepository.java
git commit -m "feat(aws): add AwsAccount entity and repository"
```

---

### Task 3: Create AwsAccount DTOs

**Files:**
- Create: `backend/src/main/java/com/automationcenter/dto/aws/AwsAccountRequest.java`
- Create: `backend/src/main/java/com/automationcenter/dto/aws/AwsAccountResponse.java`

- [ ] **Step 1: Create `AwsAccountRequest.java`**

```java
package com.automationcenter.dto.aws;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AwsAccountRequest {

    @NotBlank(message = "Account name is required")
    private String name;

    @NotBlank(message = "AWS profile name is required")
    private String profileName;

    @NotBlank(message = "Default region is required")
    private String region;

    private String terraformRepoUrl;
}
```

- [ ] **Step 2: Create `AwsAccountResponse.java`**

```java
package com.automationcenter.dto.aws;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Builder
public class AwsAccountResponse {
    private Long id;
    private String name;
    private String profileName;
    private String defaultRegion;
    private String terraformRepoUrl;
    private LocalDateTime createdAt;
    private boolean reachable;
    private String accountId;
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/automationcenter/dto/aws/AwsAccountRequest.java \
        backend/src/main/java/com/automationcenter/dto/aws/AwsAccountResponse.java
git commit -m "feat(aws): add AwsAccount DTOs"
```

---

### Task 4: Mount `~/.aws` in Docker Compose and refactor AwsService to use ProfileCredentialsProvider

**Files:**
- Modify: `docker-compose.yml`
- Modify: `backend/src/main/java/com/automationcenter/service/AwsService.java`
- Modify: `backend/src/main/java/com/automationcenter/entity/User.java`

**Context:** AWS SDK v2's `ProfileCredentialsProvider.create("my-profile")` reads from `~/.aws/config` and `~/.aws/credentials`. On Windows the host path is `C:\Users\Eduardo Alcaria\.aws`. Docker Compose on Windows translates this to the volume path shown below. The backend container runs as root so the mount lands at `/root/.aws`.

- [ ] **Step 1: Add volume mount to docker-compose.yml**

Read `docker-compose.yml` first. Find the `backend:` service section. Add a `volumes:` key (or append to existing) under the backend service:

```yaml
    volumes:
      - C:/Users/Eduardo Alcaria/.aws:/root/.aws:ro
```

- [ ] **Step 2: Remove the three AWS fields from `User.java`**

Read `User.java`. Delete these three fields:

```java
@Column
private String awsAccessKeyId;

@Column(columnDefinition = "TEXT")
private String awsSecretAccessKey;

@Column(length = 50)
private String awsDefaultRegion;
```

Since `ddl-auto: update` only adds columns, the old columns will remain in DB (harmless — no data). No migration needed.

- [ ] **Step 3: Rewrite `AwsService.java` completely**

Replace the entire file with this version that uses `AwsAccount` + `ProfileCredentialsProvider`:

```java
package com.automationcenter.service;

import com.automationcenter.dto.aws.AwsAccountRequest;
import com.automationcenter.dto.aws.AwsAccountResponse;
import com.automationcenter.entity.AwsAccount;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.AwsAccountRepository;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.auth.credentials.ProfileCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.ec2.Ec2Client;
import software.amazon.awssdk.services.ec2.model.StartInstancesRequest;
import software.amazon.awssdk.services.ec2.model.StopInstancesRequest;
import software.amazon.awssdk.services.ec2.model.Tag;
import software.amazon.awssdk.services.ec2.model.TerminateInstancesRequest;
import software.amazon.awssdk.services.ecs.EcsClient;
import software.amazon.awssdk.services.ecs.model.DescribeClustersRequest;
import software.amazon.awssdk.services.ecs.model.DescribeServicesRequest;
import software.amazon.awssdk.services.ecs.model.ListServicesRequest;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sts.StsClient;
import software.amazon.awssdk.services.sts.model.GetCallerIdentityResponse;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class AwsService {

    private final AwsAccountRepository accountRepository;
    private final UserRepository userRepository;

    // ── Account CRUD ──────────────────────────────────────────────────────────

    public AwsAccountResponse createAccount(Long userId, AwsAccountRequest req) {
        User user = getUser(userId);
        AwsAccount account = AwsAccount.builder()
                .name(req.getName())
                .profileName(req.getProfileName())
                .defaultRegion(req.getRegion())
                .terraformRepoUrl(req.getTerraformRepoUrl())
                .owner(user)
                .build();
        // Validate profile works via STS
        boolean reachable = false;
        String accountId = null;
        try {
            GetCallerIdentityResponse identity = StsClient.builder()
                    .credentialsProvider(ProfileCredentialsProvider.create(req.getProfileName()))
                    .region(Region.of(req.getRegion()))
                    .build()
                    .getCallerIdentity();
            reachable = true;
            accountId = identity.account();
        } catch (Exception e) {
            log.warn("Profile '{}' not reachable during registration: {}", req.getProfileName(), e.getMessage());
        }
        account = accountRepository.save(account);
        return toResponse(account, reachable, accountId);
    }

    public List<AwsAccountResponse> listAccounts(Long userId) {
        return accountRepository.findByOwnerId(userId).stream()
                .map(a -> {
                    boolean reachable = false;
                    String accountId = null;
                    try {
                        GetCallerIdentityResponse id = StsClient.builder()
                                .credentialsProvider(ProfileCredentialsProvider.create(a.getProfileName()))
                                .region(Region.of(a.getDefaultRegion()))
                                .build()
                                .getCallerIdentity();
                        reachable = true;
                        accountId = id.account();
                    } catch (Exception ignored) {}
                    return toResponse(a, reachable, accountId);
                })
                .toList();
    }

    public void deleteAccount(Long userId, Long accountId) {
        AwsAccount account = getAccount(accountId, userId);
        accountRepository.delete(account);
    }

    // ── EC2 ───────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> listEc2Instances(Long userId, Long accountId, String region) {
        AwsAccount account = getAccount(accountId, userId);
        String effectiveRegion = region != null ? region : account.getDefaultRegion();
        try (Ec2Client ec2 = buildEc2Client(account, effectiveRegion)) {
            return ec2.describeInstances().reservations().stream()
                    .flatMap(r -> r.instances().stream())
                    .map(i -> {
                        Map<String, Object> item = new LinkedHashMap<>();
                        item.put("instanceId", i.instanceId());
                        item.put("instanceType", i.instanceTypeAsString());
                        item.put("state", i.state().nameAsString());
                        item.put("publicIp", i.publicIpAddress());
                        item.put("privateIp", i.privateIpAddress());
                        item.put("launchTime", i.launchTime() != null ? i.launchTime().toString() : null);
                        item.put("platform", i.platformDetails());
                        String name = i.tags().stream()
                                .filter(t -> "Name".equals(t.key()))
                                .map(Tag::value)
                                .findFirst().orElse(null);
                        item.put("name", name);
                        item.put("region", effectiveRegion);
                        return item;
                    })
                    .toList();
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to list EC2 instances: " + e.getMessage());
        }
    }

    public void startInstance(Long userId, Long accountId, String instanceId, String region) {
        AwsAccount account = getAccount(accountId, userId);
        String effectiveRegion = region != null ? region : account.getDefaultRegion();
        try (Ec2Client ec2 = buildEc2Client(account, effectiveRegion)) {
            ec2.startInstances(StartInstancesRequest.builder().instanceIds(instanceId).build());
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to start instance: " + e.getMessage());
        }
    }

    public void stopInstance(Long userId, Long accountId, String instanceId, String region) {
        AwsAccount account = getAccount(accountId, userId);
        String effectiveRegion = region != null ? region : account.getDefaultRegion();
        try (Ec2Client ec2 = buildEc2Client(account, effectiveRegion)) {
            ec2.stopInstances(StopInstancesRequest.builder().instanceIds(instanceId).build());
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to stop instance: " + e.getMessage());
        }
    }

    public void terminateInstance(Long userId, Long accountId, String instanceId, String region) {
        AwsAccount account = getAccount(accountId, userId);
        String effectiveRegion = region != null ? region : account.getDefaultRegion();
        try (Ec2Client ec2 = buildEc2Client(account, effectiveRegion)) {
            ec2.terminateInstances(TerminateInstancesRequest.builder().instanceIds(instanceId).build());
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to terminate instance: " + e.getMessage());
        }
    }

    // ── S3 ────────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> listS3Buckets(Long userId, Long accountId) {
        AwsAccount account = getAccount(accountId, userId);
        try (S3Client s3 = S3Client.builder()
                .credentialsProvider(credentialsFor(account))
                .region(Region.of(account.getDefaultRegion()))
                .build()) {
            return s3.listBuckets().buckets().stream()
                    .map(b -> {
                        Map<String, Object> item = new LinkedHashMap<>();
                        item.put("name", b.name());
                        item.put("creationDate", b.creationDate() != null ? b.creationDate().toString() : null);
                        return item;
                    })
                    .toList();
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to list S3 buckets: " + e.getMessage());
        }
    }

    // ── ECS ───────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> listEcsClusters(Long userId, Long accountId, String region) {
        AwsAccount account = getAccount(accountId, userId);
        String effectiveRegion = region != null ? region : account.getDefaultRegion();
        try (EcsClient ecs = buildEcsClient(account, effectiveRegion)) {
            List<String> arns = ecs.listClusters().clusterArns();
            if (arns.isEmpty()) return List.of();
            return ecs.describeClusters(DescribeClustersRequest.builder().clusters(arns).build())
                    .clusters().stream()
                    .map(c -> {
                        Map<String, Object> item = new LinkedHashMap<>();
                        item.put("clusterArn", c.clusterArn());
                        item.put("clusterName", c.clusterName());
                        item.put("status", c.status());
                        item.put("activeServicesCount", c.activeServicesCount());
                        item.put("runningTasksCount", c.runningTasksCount());
                        item.put("region", effectiveRegion);
                        return item;
                    })
                    .toList();
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to list ECS clusters: " + e.getMessage());
        }
    }

    public List<Map<String, Object>> listEcsServices(Long userId, Long accountId, String clusterArn, String region) {
        AwsAccount account = getAccount(accountId, userId);
        String effectiveRegion = region != null ? region : account.getDefaultRegion();
        try (EcsClient ecs = buildEcsClient(account, effectiveRegion)) {
            List<String> arns = ecs.listServices(ListServicesRequest.builder().cluster(clusterArn).build()).serviceArns();
            if (arns.isEmpty()) return List.of();
            return ecs.describeServices(DescribeServicesRequest.builder().cluster(clusterArn).services(arns).build())
                    .services().stream()
                    .map(s -> {
                        Map<String, Object> item = new LinkedHashMap<>();
                        item.put("serviceArn", s.serviceArn());
                        item.put("serviceName", s.serviceName());
                        item.put("status", s.status());
                        item.put("desiredCount", s.desiredCount());
                        item.put("runningCount", s.runningCount());
                        item.put("taskDefinition", s.taskDefinition());
                        return item;
                    })
                    .toList();
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to list ECS services: " + e.getMessage());
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private ProfileCredentialsProvider credentialsFor(AwsAccount account) {
        return ProfileCredentialsProvider.create(account.getProfileName());
    }

    private Ec2Client buildEc2Client(AwsAccount account, String region) {
        return Ec2Client.builder()
                .credentialsProvider(credentialsFor(account))
                .region(Region.of(region))
                .build();
    }

    private EcsClient buildEcsClient(AwsAccount account, String region) {
        return EcsClient.builder()
                .credentialsProvider(credentialsFor(account))
                .region(Region.of(region))
                .build();
    }

    private AwsAccount getAccount(Long accountId, Long userId) {
        return accountRepository.findByIdAndOwnerId(accountId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("AWS account not found"));
    }

    private User getUser(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private AwsAccountResponse toResponse(AwsAccount a, boolean reachable, String awsAccountId) {
        return AwsAccountResponse.builder()
                .id(a.getId())
                .name(a.getName())
                .profileName(a.getProfileName())
                .defaultRegion(a.getDefaultRegion())
                .terraformRepoUrl(a.getTerraformRepoUrl())
                .createdAt(a.getCreatedAt())
                .reachable(reachable)
                .accountId(awsAccountId)
                .build();
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml \
        backend/src/main/java/com/automationcenter/entity/User.java \
        backend/src/main/java/com/automationcenter/service/AwsService.java
git commit -m "feat(aws): switch to ProfileCredentialsProvider + AwsAccount entity, mount ~/.aws"
```

---

### Task 5: Create AwsAccountController and update AwsController

**Files:**
- Create: `backend/src/main/java/com/automationcenter/controller/AwsAccountController.java`
- Modify: `backend/src/main/java/com/automationcenter/controller/AwsController.java`

- [ ] **Step 1: Create `AwsAccountController.java`**

```java
package com.automationcenter.controller;

import com.automationcenter.dto.aws.AwsAccountRequest;
import com.automationcenter.dto.aws.AwsAccountResponse;
import com.automationcenter.entity.User;
import com.automationcenter.service.AwsService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/aws/accounts")
@RequiredArgsConstructor
public class AwsAccountController {

    private final AwsService awsService;

    @PostMapping
    public ResponseEntity<AwsAccountResponse> create(
            @RequestBody @Valid AwsAccountRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.createAccount(user.getId(), req));
    }

    @GetMapping
    public ResponseEntity<List<AwsAccountResponse>> list(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listAccounts(user.getId()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        awsService.deleteAccount(user.getId(), id);
        return ResponseEntity.noContent().build();
    }
}
```

- [ ] **Step 2: Rewrite `AwsController.java`** — all endpoints now include `{accountId}` path variable

```java
package com.automationcenter.controller;

import com.automationcenter.entity.User;
import com.automationcenter.service.AwsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/aws/accounts/{accountId}")
@RequiredArgsConstructor
public class AwsController {

    private final AwsService awsService;

    @GetMapping("/ec2/instances")
    public ResponseEntity<List<Map<String, Object>>> listInstances(
            @PathVariable Long accountId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEc2Instances(user.getId(), accountId, region));
    }

    @PostMapping("/ec2/instances/{instanceId}/start")
    public ResponseEntity<Void> startInstance(
            @PathVariable Long accountId,
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.startInstance(user.getId(), accountId, instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/ec2/instances/{instanceId}/stop")
    public ResponseEntity<Void> stopInstance(
            @PathVariable Long accountId,
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.stopInstance(user.getId(), accountId, instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/ec2/instances/{instanceId}")
    public ResponseEntity<Void> terminateInstance(
            @PathVariable Long accountId,
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.terminateInstance(user.getId(), accountId, instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/s3/buckets")
    public ResponseEntity<List<Map<String, Object>>> listBuckets(
            @PathVariable Long accountId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listS3Buckets(user.getId(), accountId));
    }

    @GetMapping("/ecs/clusters")
    public ResponseEntity<List<Map<String, Object>>> listClusters(
            @PathVariable Long accountId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEcsClusters(user.getId(), accountId, region));
    }

    @GetMapping("/ecs/clusters/{clusterArn}/services")
    public ResponseEntity<List<Map<String, Object>>> listServices(
            @PathVariable Long accountId,
            @PathVariable String clusterArn,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEcsServices(user.getId(), accountId, clusterArn, region));
    }
}
```

- [ ] **Step 3: Delete the old `/api/aws/credentials` and `/api/aws/status` endpoints** — they no longer exist. The old `AwsCredentialsRequest.java` can also be removed:

```bash
rm backend/src/main/java/com/automationcenter/dto/aws/AwsCredentialsRequest.java
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/java/com/automationcenter/controller/
git commit -m "feat(aws): add AwsAccountController, refactor AwsController to use accountId"
```

---

### Task 6: Create TerraformParserService

**Files:**
- Create: `backend/src/main/java/com/automationcenter/service/TerraformParserService.java`

This service clones a Terraform repo (using `ProcessBuilder` shell `git clone`), walks all `.tf` files, extracts `resource "TYPE" "NAME" {}` blocks and `module "NAME" {}` blocks using regex. Returns a list of nodes for the topology graph.

- [ ] **Step 1: Create `TerraformParserService.java`**

```java
package com.automationcenter.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@Slf4j
public class TerraformParserService {

    private static final Pattern RESOURCE_PATTERN =
            Pattern.compile("resource\\s+\"([^\"]+)\"\\s+\"([^\"]+)\"");
    private static final Pattern MODULE_PATTERN =
            Pattern.compile("module\\s+\"([^\"]+)\"");
    private static final Pattern TAG_NAME_PATTERN =
            Pattern.compile("Name\\s*=\\s*\"([^\"]+)\"");

    public List<Map<String, Object>> parseRepo(String repoUrl) {
        Path tempDir = null;
        try {
            tempDir = Files.createTempDirectory("tf-parse-");
            cloneRepo(repoUrl, tempDir);
            return parseTfFiles(tempDir);
        } catch (Exception e) {
            log.error("Failed to parse Terraform repo {}: {}", repoUrl, e.getMessage());
            throw new IllegalArgumentException("Failed to parse Terraform repo: " + e.getMessage());
        } finally {
            if (tempDir != null) deleteDirQuietly(tempDir.toFile());
        }
    }

    private void cloneRepo(String repoUrl, Path target) throws IOException, InterruptedException {
        ProcessBuilder pb = new ProcessBuilder("git", "clone", "--depth=1", repoUrl, target.toString());
        pb.redirectErrorStream(true);
        Process p = pb.start();
        int exit = p.waitFor();
        if (exit != 0) {
            String out = new String(p.getInputStream().readAllBytes());
            throw new IllegalArgumentException("git clone failed (exit " + exit + "): " + out);
        }
    }

    private List<Map<String, Object>> parseTfFiles(Path root) throws IOException {
        List<Map<String, Object>> nodes = new ArrayList<>();
        Files.walk(root)
                .filter(p -> p.toString().endsWith(".tf"))
                .forEach(tf -> {
                    try {
                        String content = Files.readString(tf);
                        String relPath = root.relativize(tf).toString();
                        extractResources(content, relPath, nodes);
                        extractModules(content, relPath, nodes);
                    } catch (IOException e) {
                        log.warn("Could not read {}: {}", tf, e.getMessage());
                    }
                });
        return nodes;
    }

    private void extractResources(String content, String filePath, List<Map<String, Object>> nodes) {
        Matcher m = RESOURCE_PATTERN.matcher(content);
        while (m.find()) {
            String resourceType = m.group(1);
            String resourceName = m.group(2);
            // Try to find a Name tag nearby (within 200 chars after the match)
            int end = Math.min(m.end() + 300, content.length());
            String snippet = content.substring(m.start(), end);
            String displayName = findTagName(snippet);

            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", "tf:" + resourceType + ":" + resourceName);
            node.put("source", "terraform");
            node.put("resourceType", resourceType);
            node.put("resourceName", resourceName);
            node.put("label", displayName != null ? displayName : resourceName);
            node.put("service", resourceTypeToService(resourceType));
            node.put("file", filePath);
            nodes.add(node);
        }
    }

    private void extractModules(String content, String filePath, List<Map<String, Object>> nodes) {
        Matcher m = MODULE_PATTERN.matcher(content);
        while (m.find()) {
            String moduleName = m.group(1);
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", "tf:module:" + moduleName);
            node.put("source", "terraform");
            node.put("resourceType", "module");
            node.put("resourceName", moduleName);
            node.put("label", moduleName);
            node.put("service", "module");
            node.put("file", filePath);
            nodes.add(node);
        }
    }

    private String findTagName(String snippet) {
        Matcher m = TAG_NAME_PATTERN.matcher(snippet);
        return m.find() ? m.group(1) : null;
    }

    private String resourceTypeToService(String resourceType) {
        if (resourceType.startsWith("aws_lambda")) return "lambda";
        if (resourceType.startsWith("aws_ecs")) return "ecs";
        if (resourceType.startsWith("aws_rds") || resourceType.startsWith("aws_db")) return "rds";
        if (resourceType.startsWith("aws_s3")) return "s3";
        if (resourceType.startsWith("aws_vpc") || resourceType.startsWith("aws_subnet")
                || resourceType.startsWith("aws_security_group")) return "vpc";
        if (resourceType.startsWith("aws_api_gateway") || resourceType.startsWith("aws_apigatewayv2")) return "apigateway";
        if (resourceType.startsWith("aws_sqs")) return "sqs";
        if (resourceType.startsWith("aws_sns")) return "sns";
        if (resourceType.startsWith("aws_dynamodb")) return "dynamodb";
        if (resourceType.startsWith("aws_cloudfront")) return "cloudfront";
        if (resourceType.startsWith("aws_iam")) return "iam";
        if (resourceType.startsWith("aws_ec2") || resourceType.startsWith("aws_instance")) return "ec2";
        return "other";
    }

    private void deleteDirQuietly(File dir) {
        try {
            Files.walk(dir.toPath())
                    .sorted(java.util.Comparator.reverseOrder())
                    .map(Path::toFile)
                    .forEach(File::delete);
        } catch (IOException ignored) {}
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/TerraformParserService.java
git commit -m "feat(aws): add TerraformParserService for .tf file ingestion"
```

---

### Task 7: Create AwsTopologyService and topology controller endpoint

**Files:**
- Create: `backend/src/main/java/com/automationcenter/service/AwsTopologyService.java`

This service pulls topology from live AWS APIs (VPC, subnets, SGs, EC2, Lambda, ECS, RDS) and merges with Terraform-parsed nodes if a `terraformRepoUrl` is set on the account.

- [ ] **Step 1: Create `AwsTopologyService.java`**

```java
package com.automationcenter.service;

import com.automationcenter.entity.AwsAccount;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.AwsAccountRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.auth.credentials.ProfileCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.ec2.Ec2Client;
import software.amazon.awssdk.services.ec2.model.*;
import software.amazon.awssdk.services.ecs.EcsClient;
import software.amazon.awssdk.services.ecs.model.DescribeClustersRequest;
import software.amazon.awssdk.services.lambda.LambdaClient;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class AwsTopologyService {

    private final AwsAccountRepository accountRepository;
    private final TerraformParserService terraformParserService;

    public Map<String, Object> getTopology(Long userId, Long accountId, String region) {
        AwsAccount account = accountRepository.findByIdAndOwnerId(accountId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("AWS account not found"));
        String effectiveRegion = region != null ? region : account.getDefaultRegion();

        List<Map<String, Object>> nodes = new ArrayList<>();
        List<Map<String, Object>> edges = new ArrayList<>();

        ProfileCredentialsProvider creds = ProfileCredentialsProvider.create(account.getProfileName());

        // VPCs
        try (Ec2Client ec2 = Ec2Client.builder().credentialsProvider(creds).region(Region.of(effectiveRegion)).build()) {
            collectVpcTopology(ec2, effectiveRegion, nodes, edges);
            collectEc2Topology(ec2, effectiveRegion, nodes, edges);
        } catch (Exception e) {
            log.warn("EC2/VPC topology fetch failed: {}", e.getMessage());
        }

        // Lambda
        try (LambdaClient lambda = LambdaClient.builder().credentialsProvider(creds).region(Region.of(effectiveRegion)).build()) {
            lambda.listFunctionsPaginator().functions().forEach(fn -> {
                Map<String, Object> node = new LinkedHashMap<>();
                node.put("id", "lambda:" + fn.functionName());
                node.put("label", fn.functionName());
                node.put("service", "lambda");
                node.put("source", "live");
                node.put("runtime", fn.runtimeAsString());
                node.put("lastModified", fn.lastModified());
                nodes.add(node);
            });
        } catch (Exception e) {
            log.warn("Lambda topology fetch failed: {}", e.getMessage());
        }

        // ECS Clusters
        try (EcsClient ecs = EcsClient.builder().credentialsProvider(creds).region(Region.of(effectiveRegion)).build()) {
            List<String> clusterArns = ecs.listClusters().clusterArns();
            if (!clusterArns.isEmpty()) {
                ecs.describeClusters(DescribeClustersRequest.builder().clusters(clusterArns).build())
                        .clusters().forEach(c -> {
                            Map<String, Object> node = new LinkedHashMap<>();
                            node.put("id", "ecs:" + c.clusterName());
                            node.put("label", c.clusterName());
                            node.put("service", "ecs");
                            node.put("source", "live");
                            node.put("status", c.status());
                            node.put("runningTasksCount", c.runningTasksCount());
                            nodes.add(node);
                        });
            }
        } catch (Exception e) {
            log.warn("ECS topology fetch failed: {}", e.getMessage());
        }

        // Terraform overlay
        if (account.getTerraformRepoUrl() != null && !account.getTerraformRepoUrl().isBlank()) {
            try {
                List<Map<String, Object>> tfNodes = terraformParserService.parseRepo(account.getTerraformRepoUrl());
                // Merge: add Terraform nodes that don't already exist as live nodes
                for (Map<String, Object> tfNode : tfNodes) {
                    String tfId = (String) tfNode.get("id");
                    boolean alreadyExists = nodes.stream().anyMatch(n -> tfId.equals(n.get("id")));
                    if (!alreadyExists) nodes.add(tfNode);
                }
            } catch (Exception e) {
                log.warn("Terraform overlay failed: {}", e.getMessage());
            }
        }

        return Map.of("nodes", nodes, "edges", edges, "region", effectiveRegion);
    }

    private void collectVpcTopology(Ec2Client ec2, String region, List<Map<String, Object>> nodes, List<Map<String, Object>> edges) {
        ec2.describeVpcs().vpcs().forEach(vpc -> {
            String name = tagName(vpc.tags(), vpc.vpcId());
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", "vpc:" + vpc.vpcId());
            node.put("label", name);
            node.put("service", "vpc");
            node.put("source", "live");
            node.put("cidr", vpc.cidrBlock());
            node.put("state", vpc.stateAsString());
            nodes.add(node);
        });

        ec2.describeSubnets().subnets().forEach(sub -> {
            String name = tagName(sub.tags(), sub.subnetId());
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", "subnet:" + sub.subnetId());
            node.put("label", name);
            node.put("service", "subnet");
            node.put("source", "live");
            node.put("cidr", sub.cidrBlock());
            node.put("az", sub.availabilityZone());
            nodes.add(node);
            // Subnet belongs to VPC
            edges.add(edge("vpc:" + sub.vpcId(), "subnet:" + sub.subnetId(), "contains"));
        });

        ec2.describeSecurityGroups().securityGroups().forEach(sg -> {
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", "sg:" + sg.groupId());
            node.put("label", sg.groupName());
            node.put("service", "security_group");
            node.put("source", "live");
            node.put("description", sg.description());
            nodes.add(node);
            edges.add(edge("vpc:" + sg.vpcId(), "sg:" + sg.groupId(), "contains"));
        });
    }

    private void collectEc2Topology(Ec2Client ec2, String region, List<Map<String, Object>> nodes, List<Map<String, Object>> edges) {
        ec2.describeInstances().reservations().stream()
                .flatMap(r -> r.instances().stream())
                .filter(i -> !"terminated".equals(i.state().nameAsString()))
                .forEach(i -> {
                    String name = tagName(i.tags(), i.instanceId());
                    Map<String, Object> node = new LinkedHashMap<>();
                    node.put("id", "ec2:" + i.instanceId());
                    node.put("label", name);
                    node.put("service", "ec2");
                    node.put("source", "live");
                    node.put("state", i.state().nameAsString());
                    node.put("instanceType", i.instanceTypeAsString());
                    node.put("privateIp", i.privateIpAddress());
                    nodes.add(node);
                    if (i.subnetId() != null)
                        edges.add(edge("subnet:" + i.subnetId(), "ec2:" + i.instanceId(), "hosts"));
                });
    }

    private String tagName(List<software.amazon.awssdk.services.ec2.model.Tag> tags, String fallback) {
        return tags.stream()
                .filter(t -> "Name".equals(t.key()))
                .map(software.amazon.awssdk.services.ec2.model.Tag::value)
                .findFirst().orElse(fallback);
    }

    private Map<String, Object> edge(String from, String to, String label) {
        return Map.of("id", from + "->" + to, "source", from, "target", to, "label", label);
    }
}
```

- [ ] **Step 2: Add topology endpoint to `AwsController.java`**

Add this method to `AwsController.java`:

```java
@GetMapping("/topology")
public ResponseEntity<Map<String, Object>> getTopology(
        @PathVariable Long accountId,
        @RequestParam(required = false) String region,
        @AuthenticationPrincipal User user) {
    return ResponseEntity.ok(awsTopologyService.getTopology(user.getId(), accountId, region));
}
```

Also add `AwsTopologyService` as a dependency to `AwsController`:
```java
private final AwsTopologyService awsTopologyService;
```

And import `AwsTopologyService` at the top of `AwsController.java`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/AwsTopologyService.java \
        backend/src/main/java/com/automationcenter/controller/AwsController.java
git commit -m "feat(aws): add AwsTopologyService + topology endpoint with Terraform overlay"
```

---

### Task 8: Add X-Ray trace endpoints

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/AwsService.java`
- Modify: `backend/src/main/java/com/automationcenter/controller/AwsController.java`

X-Ray provides distributed traces. `GetTraceSummaries` lists traces in a time window. `BatchGetTraces` fetches full segments for a trace. Each segment is a service call with start/end time, errors, and subsegments (HTTP calls, DB queries, etc.).

- [ ] **Step 1: Add trace methods to `AwsService.java`**

Add these imports to `AwsService.java`:

```java
import software.amazon.awssdk.services.xray.XRayClient;
import software.amazon.awssdk.services.xray.model.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
```

Add these methods to `AwsService`:

```java
public List<Map<String, Object>> listTraces(Long userId, Long accountId, String region, int minutes) {
    AwsAccount account = getAccount(accountId, userId);
    String effectiveRegion = region != null ? region : account.getDefaultRegion();
    try (XRayClient xray = XRayClient.builder()
            .credentialsProvider(credentialsFor(account))
            .region(Region.of(effectiveRegion))
            .build()) {
        Instant end = Instant.now();
        Instant start = end.minus(minutes, ChronoUnit.MINUTES);
        return xray.getTraceSummariesPaginator(GetTraceSummariesRequest.builder()
                        .startTime(start).endTime(end).build())
                .traceSummaries().stream()
                .map(t -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("id", t.id());
                    item.put("duration", t.duration());
                    item.put("responseTime", t.responseTime());
                    item.put("hasFault", t.hasFault());
                    item.put("hasError", t.hasError());
                    item.put("hasThrottle", t.hasThrottle());
                    if (t.http() != null && t.http().request() != null) {
                        item.put("url", t.http().request().url());
                        item.put("method", t.http().request().method());
                        item.put("clientIp", t.http().request().clientIp());
                    }
                    item.put("serviceCount", t.serviceIds() != null ? t.serviceIds().size() : 0);
                    return item;
                })
                .toList();
    } catch (Exception e) {
        throw new IllegalArgumentException("Failed to list X-Ray traces: " + e.getMessage());
    }
}

public Map<String, Object> getTrace(Long userId, Long accountId, String traceId, String region) {
    AwsAccount account = getAccount(accountId, userId);
    String effectiveRegion = region != null ? region : account.getDefaultRegion();
    try (XRayClient xray = XRayClient.builder()
            .credentialsProvider(credentialsFor(account))
            .region(Region.of(effectiveRegion))
            .build()) {
        List<Trace> traces = xray.batchGetTraces(
                BatchGetTracesRequest.builder().traceIds(traceId).build()
        ).traces();
        if (traces.isEmpty()) throw new ResourceNotFoundException("Trace not found: " + traceId);

        Trace trace = traces.get(0);
        List<Map<String, Object>> segments = trace.segments().stream().map(seg -> {
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("id", seg.id());
            // Segment document is a JSON string — pass it through for the frontend to parse
            s.put("document", seg.document());
            return s;
        }).toList();

        return Map.of("id", trace.id(), "duration", trace.duration(), "segments", segments);
    } catch (ResourceNotFoundException e) {
        throw e;
    } catch (Exception e) {
        throw new IllegalArgumentException("Failed to fetch trace: " + e.getMessage());
    }
}
```

- [ ] **Step 2: Add trace endpoints to `AwsController.java`**

```java
@GetMapping("/traces")
public ResponseEntity<List<Map<String, Object>>> listTraces(
        @PathVariable Long accountId,
        @RequestParam(required = false) String region,
        @RequestParam(defaultValue = "60") int minutes,
        @AuthenticationPrincipal User user) {
    return ResponseEntity.ok(awsService.listTraces(user.getId(), accountId, region, minutes));
}

@GetMapping("/traces/{traceId}")
public ResponseEntity<Map<String, Object>> getTrace(
        @PathVariable Long accountId,
        @PathVariable String traceId,
        @RequestParam(required = false) String region,
        @AuthenticationPrincipal User user) {
    return ResponseEntity.ok(awsService.getTrace(user.getId(), accountId, traceId, region));
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/AwsService.java \
        backend/src/main/java/com/automationcenter/controller/AwsController.java
git commit -m "feat(aws): add X-Ray trace listing and detail endpoints"
```

---

### Task 9: Update frontend API layer

**Files:**
- Create: `frontend/src/api/awsAccounts.ts`
- Modify: `frontend/src/api/aws.ts`

- [ ] **Step 1: Create `awsAccounts.ts`**

```typescript
import client from './client'

export interface AwsAccountResponse {
  id: number
  name: string
  profileName: string
  defaultRegion: string
  terraformRepoUrl: string | null
  createdAt: string
  reachable: boolean
  accountId: string | null
}

export interface AwsAccountRequest {
  name: string
  profileName: string
  region: string
  terraformRepoUrl?: string
}

export const listAwsAccounts = () =>
  client.get<AwsAccountResponse[]>('/aws/accounts').then(r => r.data)

export const createAwsAccount = (req: AwsAccountRequest) =>
  client.post<AwsAccountResponse>('/aws/accounts', req).then(r => r.data)

export const deleteAwsAccount = (id: number) =>
  client.delete(`/aws/accounts/${id}`)
```

- [ ] **Step 2: Update `aws.ts`** — all functions now take `accountId: number`

Replace the entire file:

```typescript
import client from './client'

export interface Ec2Instance {
  instanceId: string
  name: string | null
  instanceType: string
  state: string
  publicIp: string | null
  privateIp: string | null
  launchTime: string | null
  platform: string | null
  region: string
}

export interface S3Bucket {
  name: string
  creationDate: string | null
}

export interface EcsCluster {
  clusterArn: string
  clusterName: string
  status: string
  activeServicesCount: number
  runningTasksCount: number
  region: string
}

export interface EcsService {
  serviceArn: string
  serviceName: string
  status: string
  desiredCount: number
  runningCount: number
  taskDefinition: string
}

export interface TraceItem {
  id: string
  duration: number | null
  responseTime: number | null
  hasFault: boolean
  hasError: boolean
  hasThrottle: boolean
  url?: string
  method?: string
  clientIp?: string
  serviceCount: number
}

export interface TopologyGraph {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  region: string
}

export interface TopologyNode {
  id: string
  label: string
  service: string
  source: 'live' | 'terraform'
  [key: string]: unknown
}

export interface TopologyEdge {
  id: string
  source: string
  target: string
  label: string
}

const base = (accountId: number) => `/aws/accounts/${accountId}`

export const listEc2Instances = (accountId: number, region?: string) =>
  client.get<Ec2Instance[]>(`${base(accountId)}/ec2/instances`, { params: region ? { region } : {} }).then(r => r.data)

export const startInstance = (accountId: number, instanceId: string, region?: string) =>
  client.post(`${base(accountId)}/ec2/instances/${instanceId}/start`, null, { params: region ? { region } : {} })

export const stopInstance = (accountId: number, instanceId: string, region?: string) =>
  client.post(`${base(accountId)}/ec2/instances/${instanceId}/stop`, null, { params: region ? { region } : {} })

export const terminateInstance = (accountId: number, instanceId: string, region?: string) =>
  client.delete(`${base(accountId)}/ec2/instances/${instanceId}`, { params: region ? { region } : {} })

export const listS3Buckets = (accountId: number) =>
  client.get<S3Bucket[]>(`${base(accountId)}/s3/buckets`).then(r => r.data)

export const listEcsClusters = (accountId: number, region?: string) =>
  client.get<EcsCluster[]>(`${base(accountId)}/ecs/clusters`, { params: region ? { region } : {} }).then(r => r.data)

export const listEcsServices = (accountId: number, clusterArn: string, region?: string) =>
  client.get<EcsService[]>(`${base(accountId)}/ecs/clusters/${encodeURIComponent(clusterArn)}/services`, {
    params: region ? { region } : {},
  }).then(r => r.data)

export const getTopology = (accountId: number, region?: string) =>
  client.get<TopologyGraph>(`${base(accountId)}/topology`, { params: region ? { region } : {} }).then(r => r.data)

export const listTraces = (accountId: number, region?: string, minutes = 60) =>
  client.get<TraceItem[]>(`${base(accountId)}/traces`, { params: { ...(region ? { region } : {}), minutes } }).then(r => r.data)

export const getTrace = (accountId: number, traceId: string, region?: string) =>
  client.get<{ id: string; duration: number; segments: { id: string; document: string }[] }>(
    `${base(accountId)}/traces/${traceId}`, { params: region ? { region } : {} }
  ).then(r => r.data)
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/awsAccounts.ts frontend/src/api/aws.ts
git commit -m "feat(aws): update API layer for account-scoped endpoints + topology + traces"
```

---

### Task 10: Rewrite AWS.tsx with account selector, topology tab, traces tab

**Files:**
- Modify: `frontend/src/pages/AWS.tsx`

The page structure becomes:
1. If no accounts: empty state with "Register Account" button + modal
2. If accounts exist: account selector at top, then tabs: EC2 | S3 | ECS | Topology | Traces
3. Account registration modal: name, profileName, defaultRegion, terraformRepoUrl (optional)
4. Topology tab: simple node list (React Flow topology is on a separate page `/aws/topology`)
5. Traces tab: list of recent traces, click to see metro-style pipeline

The full file is large — implement it in sections.

- [ ] **Step 1: Rewrite AWS.tsx**

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { EcsCluster } from '../api/aws'
import {
  listEc2Instances, listS3Buckets, listEcsClusters, listEcsServices,
  startInstance, stopInstance, terminateInstance, listTraces, getTopology,
} from '../api/aws'
import { listAwsAccounts, createAwsAccount, deleteAwsAccount } from '../api/awsAccounts'
import type { AwsAccountResponse } from '../api/awsAccounts'
import {
  Server, HardDrive, Box, Play, Square, Trash2, ChevronDown, ChevronRight,
  AlertTriangle, Loader2, RefreshCw, Plus, X, CheckCircle, XCircle, Network,
  Activity, Key,
} from 'lucide-react'

const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'sa-east-1',
]

function stateColor(state: string) {
  if (state === 'running') return 'status-online'
  if (state === 'stopped') return 'status-muted'
  if (state === 'terminated') return 'text-destructive/70 bg-destructive/10 border-destructive/20'
  return 'status-muted'
}

// ── Account card ─────────────────────────────────────────────────────────────

function AccountCard({ account, selected, onSelect, onDelete }: {
  account: AwsAccountResponse
  selected: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`text-left bg-card border rounded-xl px-4 py-3 flex items-center gap-3 transition-all hover:border-primary/50 ${selected ? 'border-primary' : 'border-border'}`}
    >
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <HardDrive size={14} className="text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{account.name}</p>
        <p className="text-[11px] text-muted-foreground font-mono truncate">{account.profileName} · {account.defaultRegion}</p>
        {account.accountId && <p className="text-[11px] text-muted-foreground font-mono">Account: {account.accountId}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {account.reachable
          ? <CheckCircle size={14} className="text-green-400" />
          : <XCircle size={14} className="text-destructive" />}
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </button>
  )
}

// ── Register modal ────────────────────────────────────────────────────────────

function RegisterModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [profileName, setProfileName] = useState('')
  const [region, setRegion] = useState('us-east-1')
  const [terraformRepoUrl, setTerraformRepoUrl] = useState('')

  const mut = useMutation({
    mutationFn: () => createAwsAccount({ name, profileName, region, terraformRepoUrl: terraformRepoUrl || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aws-accounts'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Register AWS Account</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X size={16} /></button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Account Name *</label>
            <input className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="Production" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">AWS Profile *</label>
            <div className="relative">
              <Key size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="input-field mono" style={{ paddingLeft: '32px' }} value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="DEVAccess-123456789" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Profile name from your <code className="font-mono text-[10px]">~/.aws/config</code>. Run <code className="font-mono text-[10px]">aws sso login --profile &lt;name&gt;</code> first.</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Default Region *</label>
            <select className="input-field" value={region} onChange={e => setRegion(e.target.value)}>
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Terraform Repo URL</label>
            <input className="input-field mono" value={terraformRepoUrl} onChange={e => setTerraformRepoUrl(e.target.value)} placeholder="https://github.com/org/infra-terraform.git (optional)" />
            <p className="text-[11px] text-muted-foreground mt-1">Optional. Used to enrich topology with declared infrastructure.</p>
          </div>

          {mut.isError && (
            <div className="flex gap-2 items-center rounded-lg px-3 py-2 text-xs text-destructive border border-destructive/20 bg-destructive/5">
              <AlertTriangle size={12} className="shrink-0" />
              {(mut.error as any)?.response?.data?.message ?? (mut.error as any)?.message ?? 'Failed to register'}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <button
              onClick={() => mut.mutate()}
              disabled={mut.isPending || !name.trim() || !profileName.trim()}
              className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {mut.isPending ? <><Loader2 size={13} className="animate-spin" />Registering…</> : <><Plus size={13} />Register</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── EC2 tab ───────────────────────────────────────────────────────────────────

function Ec2Tab({ accountId, region }: { accountId: number; region: string }) {
  const qc = useQueryClient()
  const [confirmTerminate, setConfirmTerminate] = useState<string | null>(null)

  const { data: instances, isLoading, error, refetch } = useQuery({
    queryKey: ['ec2-instances', accountId, region],
    queryFn: () => listEc2Instances(accountId, region),
  })

  const startMut = useMutation({
    mutationFn: (id: string) => startInstance(accountId, id, region),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ec2-instances', accountId, region] }),
  })
  const stopMut = useMutation({
    mutationFn: (id: string) => stopInstance(accountId, id, region),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ec2-instances', accountId, region] }),
  })
  const terminateMut = useMutation({
    mutationFn: (id: string) => terminateInstance(accountId, id, region),
    onSuccess: () => { setConfirmTerminate(null); qc.invalidateQueries({ queryKey: ['ec2-instances', accountId, region] }) },
  })

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading instances…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!instances?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No EC2 instances in {region}</div>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button onClick={() => refetch()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw size={12} />Refresh
        </button>
      </div>
      {instances.map(inst => (
        <div key={inst.instanceId} className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5"><Server size={14} className="text-muted-foreground" /></div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{inst.name ?? inst.instanceId}</p>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{inst.instanceId} · {inst.instanceType}</p>
                <div className="flex flex-wrap gap-3 mt-1.5 text-[11px] text-muted-foreground">
                  {inst.publicIp && <span>Public: <span className="font-mono text-foreground">{inst.publicIp}</span></span>}
                  {inst.privateIp && <span>Private: <span className="font-mono text-foreground">{inst.privateIp}</span></span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${stateColor(inst.state)}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" />{inst.state}
              </span>
              {inst.state === 'stopped' && (
                <button onClick={() => startMut.mutate(inst.instanceId)} disabled={startMut.isPending}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 disabled:opacity-50 transition-all">
                  {startMut.isPending ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}Start
                </button>
              )}
              {inst.state === 'running' && (
                <button onClick={() => stopMut.mutate(inst.instanceId)} disabled={stopMut.isPending}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-muted text-muted-foreground border border-border hover:bg-muted/70 disabled:opacity-50 transition-all">
                  {stopMut.isPending ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}Stop
                </button>
              )}
              {inst.state !== 'terminated' && (
                confirmTerminate === inst.instanceId ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => terminateMut.mutate(inst.instanceId)} disabled={terminateMut.isPending}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 disabled:opacity-50 transition-all">
                      {terminateMut.isPending ? <Loader2 size={10} className="animate-spin" /> : 'Confirm'}
                    </button>
                    <button onClick={() => setConfirmTerminate(null)} className="text-[11px] text-muted-foreground hover:text-foreground px-2">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmTerminate(inst.instanceId)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Terminate instance">
                    <Trash2 size={12} />
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── S3 tab ────────────────────────────────────────────────────────────────────

function S3Tab({ accountId }: { accountId: number }) {
  const { data: buckets, isLoading, error } = useQuery({
    queryKey: ['s3-buckets', accountId],
    queryFn: () => listS3Buckets(accountId),
  })
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!buckets?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No S3 buckets</div>
  return (
    <div className="flex flex-col gap-2">
      {buckets.map(b => (
        <div key={b.name} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0"><Box size={13} className="text-muted-foreground" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground font-mono truncate">{b.name}</p>
            {b.creationDate && <p className="text-[11px] text-muted-foreground mt-0.5">Created {new Date(b.creationDate).toLocaleDateString()}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── ECS tab ───────────────────────────────────────────────────────────────────

function EcsClusterRow({ accountId, cluster }: { accountId: number; cluster: EcsCluster }) {
  const [open, setOpen] = useState(false)
  const { data: services, isLoading } = useQuery({
    queryKey: ['ecs-services', accountId, cluster.clusterArn],
    queryFn: () => listEcsServices(accountId, cluster.clusterArn, cluster.region),
    enabled: open,
  })
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors">
        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0"><Server size={13} className="text-muted-foreground" /></div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{cluster.clusterName}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{cluster.activeServicesCount} services · {cluster.runningTasksCount} running</p>
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border mr-2 ${cluster.status === 'ACTIVE' ? 'status-online' : 'status-muted'}`}>{cluster.status}</span>
        {open ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3 flex flex-col gap-2">
          {isLoading && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" />Loading services…</div>}
          {!isLoading && !services?.length && <p className="text-xs text-muted-foreground">No services</p>}
          {services?.map(svc => (
            <div key={svc.serviceArn} className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${svc.runningCount < svc.desiredCount ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/30 border-transparent'}`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{svc.serviceName}</p>
                <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{svc.taskDefinition.split('/').pop()}</p>
              </div>
              <div className={`text-[11px] shrink-0 font-mono ${svc.runningCount < svc.desiredCount ? 'text-destructive' : 'text-muted-foreground'}`}>{svc.runningCount}/{svc.desiredCount}</div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${svc.status === 'ACTIVE' ? 'status-online' : 'status-muted'}`}>{svc.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EcsTab({ accountId, region }: { accountId: number; region: string }) {
  const { data: clusters, isLoading, error } = useQuery({
    queryKey: ['ecs-clusters', accountId, region],
    queryFn: () => listEcsClusters(accountId, region),
  })
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!clusters?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No ECS clusters in {region}</div>
  return <div className="flex flex-col gap-3">{clusters.map(c => <EcsClusterRow key={c.clusterArn} accountId={accountId} cluster={c} />)}</div>
}

// ── Topology tab (summary, links to full page) ────────────────────────────────

function TopologyTab({ accountId, region }: { accountId: number; region: string }) {
  const { data: topo, isLoading, error } = useQuery({
    queryKey: ['topology', accountId, region],
    queryFn: () => getTopology(accountId, region),
  })
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Building topology…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!topo?.nodes?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No topology data in {region}</div>

  const byService = topo.nodes.reduce((acc: Record<string, number>, n) => {
    const svc = n.service as string
    acc[svc] = (acc[svc] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(byService).map(([svc, count]) => (
          <div key={svc} className="bg-card border border-border rounded-xl px-4 py-3">
            <p className="text-lg font-bold text-foreground">{count}</p>
            <p className="text-xs text-muted-foreground capitalize">{svc.replace('_', ' ')}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {topo.nodes.slice(0, 20).map(n => (
          <div key={n.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs ${n.source === 'terraform' ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'}`}>
            <Network size={11} className="text-muted-foreground shrink-0" />
            <span className="font-medium text-foreground truncate flex-1">{n.label as string}</span>
            <span className="text-muted-foreground capitalize shrink-0">{n.service as string}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${n.source === 'terraform' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{n.source as string}</span>
          </div>
        ))}
        {topo.nodes.length > 20 && <p className="text-xs text-muted-foreground text-center">{topo.nodes.length - 20} more resources…</p>}
      </div>
    </div>
  )
}

// ── Traces tab ────────────────────────────────────────────────────────────────

function TracesTab({ accountId, region }: { accountId: number; region: string }) {
  const [minutes, setMinutes] = useState(60)
  const { data: traces, isLoading, error } = useQuery({
    queryKey: ['traces', accountId, region, minutes],
    queryFn: () => listTraces(accountId, region, minutes),
  })
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading traces…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'X-Ray not available or no traces'}</div>
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <select value={minutes} onChange={e => setMinutes(Number(e.target.value))} className="input-field text-xs py-1.5 w-auto">
          <option value={15}>Last 15 min</option>
          <option value={60}>Last 1 hour</option>
          <option value={360}>Last 6 hours</option>
        </select>
        <span className="text-xs text-muted-foreground">{traces?.length ?? 0} traces</span>
      </div>
      {!traces?.length && <div className="text-sm text-muted-foreground py-12 text-center">No X-Ray traces found</div>}
      {traces?.map(t => (
        <div key={t.id} className={`bg-card border rounded-xl px-4 py-3 flex items-center gap-3 ${t.hasFault || t.hasError ? 'border-destructive/40' : 'border-border'}`}>
          <Activity size={14} className={`shrink-0 ${t.hasFault || t.hasError ? 'text-destructive' : 'text-muted-foreground'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono text-foreground truncate">{t.method && t.url ? `${t.method} ${t.url}` : t.id}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t.serviceCount} services · {t.duration?.toFixed(2)}s</p>
          </div>
          {(t.hasFault || t.hasError) && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border text-destructive border-destructive/30 bg-destructive/10 shrink-0">
              {t.hasFault ? 'Fault' : 'Error'}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'ec2' | 's3' | 'ecs' | 'topology' | 'traces'

export default function AWS() {
  const qc = useQueryClient()
  const [showRegister, setShowRegister] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('ec2')
  const [region, setRegion] = useState('us-east-1')

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: listAwsAccounts,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAwsAccount(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aws-accounts'] })
      setSelectedId(null)
    },
  })

  const selected = accounts?.find(a => a.id === selectedId) ?? accounts?.[0] ?? null
  const effectiveId = selected?.id ?? null

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground p-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading…</div>

  const tabs: { id: Tab; label: string }[] = [
    { id: 'ec2', label: 'EC2' },
    { id: 's3', label: 'S3' },
    { id: 'ecs', label: 'ECS' },
    { id: 'topology', label: 'Topology' },
    { id: 'traces', label: 'Traces' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {showRegister && <RegisterModal onClose={() => setShowRegister(false)} />}

      {/* Account list */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-foreground">AWS</h1>
          <button
            onClick={() => setShowRegister(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all"
          >
            <Plus size={12} />Register Account
          </button>
        </div>
        {!accounts?.length ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center border border-dashed border-border rounded-xl">
            <HardDrive size={28} className="text-muted-foreground opacity-40" />
            <div>
              <p className="text-sm font-semibold text-foreground">No AWS accounts</p>
              <p className="text-xs text-muted-foreground mt-1">Register an account using your AWS SSO profile.</p>
            </div>
            <button onClick={() => setShowRegister(true)} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-all mt-1">
              <Plus size={13} />Register Account
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {accounts.map(a => (
              <AccountCard
                key={a.id}
                account={a}
                selected={selected?.id === a.id}
                onSelect={() => setSelectedId(a.id)}
                onDelete={() => deleteMut.mutate(a.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Selected account detail */}
      {effectiveId !== null && (
        <>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex gap-1 bg-muted/50 rounded-lg p-1 border border-border">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${tab === t.id ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab !== 's3' && tab !== 'topology' && tab !== 'traces' && (
              <select value={region} onChange={e => setRegion(e.target.value)} className="input-field text-xs py-1.5 w-auto">
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
          </div>

          {tab === 'ec2' && <Ec2Tab accountId={effectiveId} region={region} />}
          {tab === 's3' && <S3Tab accountId={effectiveId} />}
          {tab === 'ecs' && <EcsTab accountId={effectiveId} region={region} />}
          {tab === 'topology' && <TopologyTab accountId={effectiveId} region={selected?.defaultRegion ?? region} />}
          {tab === 'traces' && <TracesTab accountId={effectiveId} region={region} />}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Remove the old `getAwsStatus`/`saveAwsCredentials` imports from Settings.tsx** — they no longer exist. Find and remove the AWS block from Settings.tsx (the `awsStatus` query, `saveAwsMut`, `handleAwsSave`, and the AWS card JSX). AWS is now managed from the AWS page directly, not Settings.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/AWS.tsx frontend/src/pages/Settings.tsx
git commit -m "feat(aws): rewrite AWS page with account selector, topology, traces tabs"
```

---

### Task 11: Build and verify

- [ ] **Step 1: Build backend**

```bash
docker compose build --no-cache backend 2>&1 | tail -20
```

Expected: `Image automationhub-backend Built`

- [ ] **Step 2: Build frontend**

```bash
docker compose build --no-cache frontend 2>&1 | tail -10
```

Expected: `Image automationhub-frontend Built`

- [ ] **Step 3: Restart**

```bash
docker compose up -d
sleep 15
docker compose ps
```

Expected: all services healthy.

- [ ] **Step 4: Smoke test**

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"eduardoalcarialopes@gmail.com","password":"EDUtheo@13"}' | python -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s "http://localhost:8080/api/aws/accounts" -H "Authorization: Bearer $TOKEN"
```

Expected: `[]` (empty list, no accounts yet).

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix(aws): post-build corrections" 2>/dev/null || echo "clean"
```

---

## Self-Review

**Spec coverage:**
- ✅ AWS as first-class entity (`AwsAccount`): name, profileName, region, Terraform repo URL
- ✅ SSO profile auth: `ProfileCredentialsProvider`, `~/.aws` mounted read-only in Docker
- ✅ Multiple accounts: list, register (with SSO reachability check), delete
- ✅ EC2/S3/ECS tabs scoped per account
- ✅ Terraform repo ingestion: clone, parse `.tf` files, extract `resource` + `module` blocks
- ✅ Topology: live AWS (VPC, subnet, SG, EC2, Lambda, ECS) + Terraform overlay, merged by ID
- ✅ Topology tab in UI: service counts, node list, source badges (live vs terraform)
- ✅ X-Ray traces: list with time window, fault/error coloring, service count
- ✅ ECS services with red border when runningCount < desiredCount
- ✅ Settings page cleaned up (AWS section removed — now in AWS page)

**Payload tracing note:** The Traces tab shows X-Ray trace summaries. Full metro-style pipeline visualization (animated dot moving through service stations) is a Phase 2 UI feature that requires a dedicated canvas/React Flow component — scoped for the next plan.

**Placeholder scan:** All code blocks are complete and self-contained.

**Type consistency:** `AwsAccountResponse` used in both `awsAccounts.ts` and `AWS.tsx`. `TopologyNode`, `TopologyEdge`, `TraceItem` defined in `aws.ts` and consumed in `AWS.tsx`.
