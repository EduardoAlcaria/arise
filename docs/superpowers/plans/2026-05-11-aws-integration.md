# AWS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AWS integration to AutomationCenter so users can view and manage EC2 instances, S3 buckets, and ECS clusters/services from the Arise UI.

**Architecture:** Store per-user AWS credentials (access key + secret + default region) on the `User` entity. Build an `AwsService` that constructs per-request AWS SDK v2 clients using `StaticCredentialsProvider`, validates via STS `GetCallerIdentity` on save, and exposes EC2/S3/ECS read+action operations. A new `AWS.tsx` page with tab-based UI (EC2 | S3 | ECS) and region selector, plus AWS credentials section in Settings.

**Tech Stack:** AWS SDK for Java v2 (`software.amazon.awssdk` BOM 2.25.69), EC2/S3/ECS/STS modules; React, TanStack Query, Lucide icons (existing frontend stack).

---

## File Map

**Create:**
- `backend/src/main/java/com/automationcenter/dto/aws/AwsCredentialsRequest.java`
- `backend/src/main/java/com/automationcenter/service/AwsService.java`
- `backend/src/main/java/com/automationcenter/controller/AwsController.java`
- `frontend/src/api/aws.ts`
- `frontend/src/pages/AWS.tsx`

**Modify:**
- `backend/pom.xml` — add AWS SDK v2 BOM and modules
- `backend/src/main/java/com/automationcenter/entity/User.java` — add `awsAccessKeyId`, `awsSecretAccessKey`, `awsDefaultRegion`
- `frontend/src/App.tsx` — add `/aws` route
- `frontend/src/components/Layout.tsx` — add AWS nav entry
- `frontend/src/pages/Settings.tsx` — add AWS credentials section

---

### Task 1: Add AWS SDK v2 dependencies to pom.xml

**Files:**
- Modify: `backend/pom.xml`

- [ ] **Step 1: Add AWS SDK BOM version property**

In `backend/pom.xml`, inside `<properties>`, add:

```xml
<aws.sdk.version>2.25.69</aws.sdk.version>
```

- [ ] **Step 2: Add AWS SDK BOM import to `<dependencyManagement>`**

Add a `<dependencyManagement>` section (or insert into existing one if present) after `<properties>`:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>bom</artifactId>
            <version>${aws.sdk.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

- [ ] **Step 3: Add EC2, S3, ECS, STS module dependencies**

Inside `<dependencies>`, add after the GitHub API dependency:

```xml
<!-- AWS SDK v2 -->
<dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>ec2</artifactId>
</dependency>
<dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>s3</artifactId>
</dependency>
<dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>ecs</artifactId>
</dependency>
<dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>sts</artifactId>
</dependency>
```

- [ ] **Step 4: Verify the build compiles**

```bash
cd backend && mvn compile -q
```

Expected: `BUILD SUCCESS` with no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/pom.xml
git commit -m "build: add AWS SDK v2 (ec2, s3, ecs, sts) dependencies"
```

---

### Task 2: Add AWS credential fields to User entity

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/entity/User.java`

Since `ddl-auto: update` is active, adding fields to `User` automatically adds columns to the `users` table on next startup.

- [ ] **Step 1: Add three new fields to `User.java`**

After the existing `infisicalProjectId` field (line ~55), add:

```java
@Column
private String awsAccessKeyId;

@Column(columnDefinition = "TEXT")
private String awsSecretAccessKey;

@Column(length = 50)
private String awsDefaultRegion;
```

- [ ] **Step 2: Compile to verify no errors**

```bash
cd backend && mvn compile -q
```

Expected: `BUILD SUCCESS`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/automationcenter/entity/User.java
git commit -m "feat(aws): add aws credential fields to User entity"
```

---

### Task 3: Create AwsCredentialsRequest DTO

**Files:**
- Create: `backend/src/main/java/com/automationcenter/dto/aws/AwsCredentialsRequest.java`

- [ ] **Step 1: Create the DTO file**

```java
package com.automationcenter.dto.aws;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AwsCredentialsRequest {

    @NotBlank(message = "Access key ID is required")
    private String accessKeyId;

    @NotBlank(message = "Secret access key is required")
    private String secretAccessKey;

    @NotBlank(message = "Default region is required")
    private String region;
}
```

- [ ] **Step 2: Compile**

```bash
cd backend && mvn compile -q
```

Expected: `BUILD SUCCESS`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/automationcenter/dto/aws/
git commit -m "feat(aws): add AwsCredentialsRequest DTO"
```

---

### Task 4: Create AwsService

**Files:**
- Create: `backend/src/main/java/com/automationcenter/service/AwsService.java`

The service builds a per-call AWS SDK client using `StaticCredentialsProvider`. It verifies credentials via STS `GetCallerIdentity` on save. All methods take `userId` and fetch credentials from the `User` entity — same pattern as `CicdService` and `CloudflareService`.

- [ ] **Step 1: Create AwsService.java**

```java
package com.automationcenter.service;

import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.ec2.Ec2Client;
import software.amazon.awssdk.services.ec2.model.*;
import software.amazon.awssdk.services.ecs.EcsClient;
import software.amazon.awssdk.services.ecs.model.*;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.Bucket;
import software.amazon.awssdk.services.sts.StsClient;
import software.amazon.awssdk.services.sts.model.GetCallerIdentityResponse;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class AwsService {

    private final UserRepository userRepository;

    // ── Credentials ───────────────────────────────────────────────────────────

    public Map<String, String> saveCredentials(Long userId, String accessKeyId, String secretAccessKey, String region) {
        StaticCredentialsProvider creds = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(accessKeyId, secretAccessKey));
        GetCallerIdentityResponse identity;
        try {
            identity = StsClient.builder()
                    .credentialsProvider(creds)
                    .region(Region.of(region))
                    .build()
                    .getCallerIdentity();
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid AWS credentials: " + e.getMessage());
        }

        User user = getUser(userId);
        user.setAwsAccessKeyId(accessKeyId);
        user.setAwsSecretAccessKey(secretAccessKey);
        user.setAwsDefaultRegion(region);
        userRepository.save(user);

        return Map.of(
                "accountId", identity.account(),
                "userArn", identity.arn(),
                "region", region
        );
    }

    public Map<String, Object> getStatus(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        boolean configured = user.getAwsAccessKeyId() != null && !user.getAwsAccessKeyId().isBlank();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("configured", configured);
        if (configured) {
            result.put("region", user.getAwsDefaultRegion());
            try {
                GetCallerIdentityResponse identity = StsClient.builder()
                        .credentialsProvider(credentialsFor(user))
                        .region(Region.of(user.getAwsDefaultRegion()))
                        .build()
                        .getCallerIdentity();
                result.put("accountId", identity.account());
                result.put("userArn", identity.arn());
            } catch (Exception e) {
                result.put("error", "Could not verify credentials: " + e.getMessage());
            }
        }
        return result;
    }

    // ── EC2 ───────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> listEc2Instances(Long userId, String region) {
        User user = getConfiguredUser(userId);
        String effectiveRegion = region != null ? region : user.getAwsDefaultRegion();
        try (Ec2Client ec2 = buildEc2Client(user, effectiveRegion)) {
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
                        item.put("platform", i.platformDetailsAsString());
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

    public void startInstance(Long userId, String instanceId, String region) {
        User user = getConfiguredUser(userId);
        String effectiveRegion = region != null ? region : user.getAwsDefaultRegion();
        try (Ec2Client ec2 = buildEc2Client(user, effectiveRegion)) {
            ec2.startInstances(StartInstancesRequest.builder().instanceIds(instanceId).build());
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to start instance: " + e.getMessage());
        }
    }

    public void stopInstance(Long userId, String instanceId, String region) {
        User user = getConfiguredUser(userId);
        String effectiveRegion = region != null ? region : user.getAwsDefaultRegion();
        try (Ec2Client ec2 = buildEc2Client(user, effectiveRegion)) {
            ec2.stopInstances(StopInstancesRequest.builder().instanceIds(instanceId).build());
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to stop instance: " + e.getMessage());
        }
    }

    public void terminateInstance(Long userId, String instanceId, String region) {
        User user = getConfiguredUser(userId);
        String effectiveRegion = region != null ? region : user.getAwsDefaultRegion();
        try (Ec2Client ec2 = buildEc2Client(user, effectiveRegion)) {
            ec2.terminateInstances(TerminateInstancesRequest.builder().instanceIds(instanceId).build());
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to terminate instance: " + e.getMessage());
        }
    }

    // ── S3 ────────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> listS3Buckets(Long userId) {
        User user = getConfiguredUser(userId);
        try (S3Client s3 = S3Client.builder()
                .credentialsProvider(credentialsFor(user))
                .region(Region.of(user.getAwsDefaultRegion()))
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

    public List<Map<String, Object>> listEcsClusters(Long userId, String region) {
        User user = getConfiguredUser(userId);
        String effectiveRegion = region != null ? region : user.getAwsDefaultRegion();
        try (EcsClient ecs = buildEcsClient(user, effectiveRegion)) {
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

    public List<Map<String, Object>> listEcsServices(Long userId, String clusterArn, String region) {
        User user = getConfiguredUser(userId);
        String effectiveRegion = region != null ? region : user.getAwsDefaultRegion();
        try (EcsClient ecs = buildEcsClient(user, effectiveRegion)) {
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

    private StaticCredentialsProvider credentialsFor(User user) {
        return StaticCredentialsProvider.create(
                AwsBasicCredentials.create(user.getAwsAccessKeyId(), user.getAwsSecretAccessKey()));
    }

    private Ec2Client buildEc2Client(User user, String region) {
        return Ec2Client.builder()
                .credentialsProvider(credentialsFor(user))
                .region(Region.of(region))
                .build();
    }

    private EcsClient buildEcsClient(User user, String region) {
        return EcsClient.builder()
                .credentialsProvider(credentialsFor(user))
                .region(Region.of(region))
                .build();
    }

    private User getUser(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private User getConfiguredUser(Long userId) {
        User user = getUser(userId);
        if (user.getAwsAccessKeyId() == null || user.getAwsAccessKeyId().isBlank()) {
            throw new IllegalArgumentException("AWS credentials not configured. Please save them in Settings.");
        }
        return user;
    }
}
```

- [ ] **Step 2: Compile**

```bash
cd backend && mvn compile -q
```

Expected: `BUILD SUCCESS`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/automationcenter/service/AwsService.java
git commit -m "feat(aws): add AwsService with EC2, S3, ECS, STS operations"
```

---

### Task 5: Create AwsController

**Files:**
- Create: `backend/src/main/java/com/automationcenter/controller/AwsController.java`

- [ ] **Step 1: Create the controller**

```java
package com.automationcenter.controller;

import com.automationcenter.dto.aws.AwsCredentialsRequest;
import com.automationcenter.entity.User;
import com.automationcenter.service.AwsService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/aws")
@RequiredArgsConstructor
public class AwsController {

    private final AwsService awsService;

    @PostMapping("/credentials")
    public ResponseEntity<Map<String, String>> saveCredentials(
            @RequestBody @Valid AwsCredentialsRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.saveCredentials(
                user.getId(), req.getAccessKeyId(), req.getSecretAccessKey(), req.getRegion()));
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.getStatus(user.getId()));
    }

    @GetMapping("/ec2/instances")
    public ResponseEntity<List<Map<String, Object>>> listInstances(
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEc2Instances(user.getId(), region));
    }

    @PostMapping("/ec2/instances/{instanceId}/start")
    public ResponseEntity<Void> startInstance(
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.startInstance(user.getId(), instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/ec2/instances/{instanceId}/stop")
    public ResponseEntity<Void> stopInstance(
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.stopInstance(user.getId(), instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/ec2/instances/{instanceId}")
    public ResponseEntity<Void> terminateInstance(
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.terminateInstance(user.getId(), instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/s3/buckets")
    public ResponseEntity<List<Map<String, Object>>> listBuckets(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listS3Buckets(user.getId()));
    }

    @GetMapping("/ecs/clusters")
    public ResponseEntity<List<Map<String, Object>>> listClusters(
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEcsClusters(user.getId(), region));
    }

    @GetMapping("/ecs/clusters/{clusterArn}/services")
    public ResponseEntity<List<Map<String, Object>>> listServices(
            @PathVariable String clusterArn,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEcsServices(user.getId(), clusterArn, region));
    }
}
```

- [ ] **Step 2: Compile**

```bash
cd backend && mvn compile -q
```

Expected: `BUILD SUCCESS`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/automationcenter/controller/AwsController.java
git commit -m "feat(aws): add AwsController with EC2/S3/ECS REST endpoints"
```

---

### Task 6: Frontend API client

**Files:**
- Create: `frontend/src/api/aws.ts`

- [ ] **Step 1: Create the API client**

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

export interface AwsStatus {
  configured: boolean
  region?: string
  accountId?: string
  userArn?: string
  error?: string
}

export const saveAwsCredentials = (accessKeyId: string, secretAccessKey: string, region: string) =>
  client.post<{ accountId: string; userArn: string; region: string }>('/aws/credentials', {
    accessKeyId, secretAccessKey, region,
  }).then(r => r.data)

export const getAwsStatus = () =>
  client.get<AwsStatus>('/aws/status').then(r => r.data)

export const listEc2Instances = (region?: string) =>
  client.get<Ec2Instance[]>('/aws/ec2/instances', { params: region ? { region } : {} }).then(r => r.data)

export const startInstance = (instanceId: string, region?: string) =>
  client.post(`/aws/ec2/instances/${instanceId}/start`, null, { params: region ? { region } : {} })

export const stopInstance = (instanceId: string, region?: string) =>
  client.post(`/aws/ec2/instances/${instanceId}/stop`, null, { params: region ? { region } : {} })

export const terminateInstance = (instanceId: string, region?: string) =>
  client.delete(`/aws/ec2/instances/${instanceId}`, { params: region ? { region } : {} })

export const listS3Buckets = () =>
  client.get<S3Bucket[]>('/aws/s3/buckets').then(r => r.data)

export const listEcsClusters = (region?: string) =>
  client.get<EcsCluster[]>('/aws/ecs/clusters', { params: region ? { region } : {} }).then(r => r.data)

export const listEcsServices = (clusterArn: string, region?: string) =>
  client.get<EcsService[]>(`/aws/ecs/clusters/${encodeURIComponent(clusterArn)}/services`, {
    params: region ? { region } : {},
  }).then(r => r.data)
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/aws.ts
git commit -m "feat(aws): add frontend AWS API client"
```

---

### Task 7: Add AWS credentials section to Settings page

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`

The pattern mirrors the existing Cloudflare credentials section: a status badge, password inputs, an error alert, success feedback, and a save button.

- [ ] **Step 1: Add imports at the top of Settings.tsx**

Add `saveAwsCredentials, getAwsStatus` to the import list. Add the existing imports line:

```typescript
import { saveAwsCredentials, getAwsStatus } from '../api/aws'
```

Also add `Cloud as AwsCloud` — actually use a generic icon. Add `HardDrive` to the lucide import:

Current lucide import:
```typescript
import { Database, Check, AlertTriangle, Loader2, Link2Off, Cloud, Key } from 'lucide-react'
```

Replace with:
```typescript
import { Database, Check, AlertTriangle, Loader2, Link2Off, Cloud, Key, HardDrive } from 'lucide-react'
```

- [ ] **Step 2: Add AWS state variables after the existing Cloudflare state block**

After the Cloudflare state variables (`cfToken`, `cfAccountId`, `cfSaveSuccess`), add:

```typescript
// AWS state
const [awsKeyId, setAwsKeyId] = useState('')
const [awsSecret, setAwsSecret] = useState('')
const [awsRegion, setAwsRegion] = useState('us-east-1')
const [awsSaveSuccess, setAwsSaveSuccess] = useState(false)
```

- [ ] **Step 3: Add AWS status query and mutation after the Cloudflare ones**

After `const { data: cfStatus, refetch: refetchCf } = ...`, add:

```typescript
const { data: awsStatus, refetch: refetchAws } = useQuery({
  queryKey: ['aws-status'],
  queryFn: getAwsStatus,
  retry: false,
  staleTime: 30_000,
})
```

After `saveCfMut`, add:

```typescript
const saveAwsMut = useMutation({
  mutationFn: ({ keyId, secret, region }: { keyId: string; secret: string; region: string }) =>
    saveAwsCredentials(keyId, secret, region),
  onSuccess: () => {
    setAwsSaveSuccess(true)
    refetchAws()
    setAwsKeyId('')
    setAwsSecret('')
    setTimeout(() => setAwsSaveSuccess(false), 3000)
  },
})
```

- [ ] **Step 4: Add `handleAwsSave` handler after `handleCfSave`**

```typescript
const handleAwsSave = () => {
  if (!awsKeyId.trim() || !awsSecret.trim() || !awsRegion.trim()) return
  saveAwsMut.mutate({ keyId: awsKeyId.trim(), secret: awsSecret.trim(), region: awsRegion.trim() })
}
```

- [ ] **Step 5: Add the AWS card to the JSX, after the closing `</div>` of the Infisical section**

Add this as the third card inside `<div className="flex flex-col gap-5">`, after Infisical:

```tsx
{/* AWS section */}
<div className="bg-card border border-border rounded-xl overflow-hidden">
  <div className="px-5 py-4 border-b border-border flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
      <HardDrive size={15} className="text-foreground" />
    </div>
    <div>
      <p className="text-sm font-semibold text-foreground">AWS</p>
      <p className="text-xs text-muted-foreground">Access key credentials for EC2, S3, and ECS management</p>
    </div>
    {awsStatus ? (
      awsStatus.configured ? (
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full status-online">
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          Configured
        </span>
      ) : (
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full status-muted">
          <Link2Off size={11} />
          Not configured
        </span>
      )
    ) : null}
  </div>

  <div className="px-5 py-5 flex flex-col gap-4">
    {awsStatus?.configured && !awsSaveSuccess && (
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-border bg-muted/20">
        <Check size={14} className="text-green-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-foreground">Credentials saved</p>
          {awsStatus.accountId && (
            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">Account: {awsStatus.accountId} · {awsStatus.region}</p>
          )}
        </div>
      </div>
    )}

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Access Key ID *</label>
        <div className="relative">
          <Key size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input-field mono"
            style={{ paddingLeft: '32px' }}
            value={awsKeyId}
            onChange={e => setAwsKeyId(e.target.value)}
            placeholder="AKIAIOSFODNN7EXAMPLE"
          />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Secret Access Key *</label>
        <div className="relative">
          <Key size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="password"
            className="input-field mono"
            style={{ paddingLeft: '32px' }}
            value={awsSecret}
            onChange={e => setAwsSecret(e.target.value)}
            placeholder="••••••••••••••••••••"
          />
        </div>
      </div>
    </div>

    <div>
      <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Default Region *</label>
      <input
        className="input-field mono"
        value={awsRegion}
        onChange={e => setAwsRegion(e.target.value)}
        placeholder="us-east-1"
      />
      <p className="text-[11px] text-muted-foreground mt-1">Default region for EC2 and ECS queries. S3 bucket listing is global.</p>
    </div>

    {saveAwsMut.isError && (
      <div className="flex gap-2 items-center rounded-lg px-3 py-2 text-xs text-destructive border border-destructive/20 bg-destructive/5">
        <AlertTriangle size={12} className="shrink-0" />
        {(saveAwsMut.error as any)?.response?.data?.message ?? (saveAwsMut.error as any)?.message ?? 'Failed to save'}
      </div>
    )}

    {awsSaveSuccess && (
      <div className="flex gap-2 items-center rounded-lg px-3 py-2 text-xs border border-current bg-current/5 status-online">
        <Check size={12} className="shrink-0" />
        AWS credentials saved
      </div>
    )}

    <div className="flex justify-end pt-1">
      <button
        onClick={handleAwsSave}
        disabled={saveAwsMut.isPending || !awsKeyId.trim() || !awsSecret.trim() || !awsRegion.trim()}
        className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
      >
        {saveAwsMut.isPending
          ? <><Loader2 size={13} className="animate-spin" />Saving…</>
          : <><HardDrive size={13} />Save Credentials</>
        }
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Settings.tsx
git commit -m "feat(aws): add AWS credentials section to Settings page"
```

---

### Task 8: Create AWS page (EC2 / S3 / ECS tabs)

**Files:**
- Create: `frontend/src/pages/AWS.tsx`

The page has three tabs. EC2 tab shows instances as cards with start/stop/terminate actions and state-colored badges. S3 tab is a simple list. ECS tab shows clusters and expands to services.

- [ ] **Step 1: Create AWS.tsx**

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listEc2Instances, listS3Buckets, listEcsClusters, listEcsServices,
  startInstance, stopInstance, terminateInstance,
  getAwsStatus, Ec2Instance, EcsCluster, EcsService, S3Bucket,
} from '../api/aws'
import {
  Server, HardDrive, Box, Play, Square, Trash2, ChevronDown, ChevronRight,
  AlertTriangle, Loader2, RefreshCw,
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

function Ec2Tab({ region }: { region: string }) {
  const qc = useQueryClient()
  const [confirmTerminate, setConfirmTerminate] = useState<string | null>(null)

  const { data: instances, isLoading, error, refetch } = useQuery({
    queryKey: ['ec2-instances', region],
    queryFn: () => listEc2Instances(region),
  })

  const startMut = useMutation({
    mutationFn: (id: string) => startInstance(id, region),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ec2-instances', region] }),
  })
  const stopMut = useMutation({
    mutationFn: (id: string) => stopInstance(id, region),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ec2-instances', region] }),
  })
  const terminateMut = useMutation({
    mutationFn: (id: string) => terminateInstance(id, region),
    onSuccess: () => {
      setConfirmTerminate(null)
      qc.invalidateQueries({ queryKey: ['ec2-instances', region] })
    },
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
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <Server size={14} className="text-muted-foreground" />
              </div>
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
                <button
                  onClick={() => startMut.mutate(inst.instanceId)}
                  disabled={startMut.isPending}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 disabled:opacity-50 transition-all"
                >
                  {startMut.isPending ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}Start
                </button>
              )}
              {inst.state === 'running' && (
                <button
                  onClick={() => stopMut.mutate(inst.instanceId)}
                  disabled={stopMut.isPending}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-muted text-muted-foreground border border-border hover:bg-muted/70 disabled:opacity-50 transition-all"
                >
                  {stopMut.isPending ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}Stop
                </button>
              )}
              {inst.state !== 'terminated' && (
                confirmTerminate === inst.instanceId ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => terminateMut.mutate(inst.instanceId)}
                      disabled={terminateMut.isPending}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 disabled:opacity-50 transition-all"
                    >
                      {terminateMut.isPending ? <Loader2 size={10} className="animate-spin" /> : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setConfirmTerminate(null)}
                      className="text-[11px] text-muted-foreground hover:text-foreground px-2"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmTerminate(inst.instanceId)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Terminate instance"
                  >
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

function S3Tab() {
  const { data: buckets, isLoading, error } = useQuery({
    queryKey: ['s3-buckets'],
    queryFn: listS3Buckets,
  })

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading buckets…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!buckets?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No S3 buckets found</div>

  return (
    <div className="flex flex-col gap-2">
      {buckets.map(b => (
        <div key={b.name} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Box size={13} className="text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground font-mono truncate">{b.name}</p>
            {b.creationDate && <p className="text-[11px] text-muted-foreground mt-0.5">Created {new Date(b.creationDate).toLocaleDateString()}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

function EcsClusterRow({ cluster }: { cluster: EcsCluster }) {
  const [open, setOpen] = useState(false)
  const { data: services, isLoading } = useQuery({
    queryKey: ['ecs-services', cluster.clusterArn],
    queryFn: () => listEcsServices(cluster.clusterArn, cluster.region),
    enabled: open,
  })

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
      >
        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Server size={13} className="text-muted-foreground" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{cluster.clusterName}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{cluster.activeServicesCount} services · {cluster.runningTasksCount} running tasks</p>
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border mr-2 ${cluster.status === 'ACTIVE' ? 'status-online' : 'status-muted'}`}>
          {cluster.status}
        </span>
        {open ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3 flex flex-col gap-2">
          {isLoading && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" />Loading services…</div>}
          {!isLoading && (!services?.length) && <p className="text-xs text-muted-foreground">No services</p>}
          {services?.map(svc => (
            <div key={svc.serviceArn} className="flex items-center gap-3 px-3 py-2 bg-muted/30 rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{svc.serviceName}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">{svc.taskDefinition.split('/').pop()}</p>
              </div>
              <div className="text-[11px] text-muted-foreground shrink-0">{svc.runningCount}/{svc.desiredCount} tasks</div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${svc.status === 'ACTIVE' ? 'status-online' : 'status-muted'}`}>
                {svc.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EcsTab({ region }: { region: string }) {
  const { data: clusters, isLoading, error } = useQuery({
    queryKey: ['ecs-clusters', region],
    queryFn: () => listEcsClusters(region),
  })

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading clusters…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!clusters?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No ECS clusters in {region}</div>

  return (
    <div className="flex flex-col gap-3">
      {clusters.map(c => <EcsClusterRow key={c.clusterArn} cluster={c} />)}
    </div>
  )
}

type Tab = 'ec2' | 's3' | 'ecs'

export default function AWS() {
  const [tab, setTab] = useState<Tab>('ec2')
  const [region, setRegion] = useState('us-east-1')

  const { data: status } = useQuery({
    queryKey: ['aws-status'],
    queryFn: getAwsStatus,
    retry: false,
    staleTime: 60_000,
  })

  if (!status?.configured) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
            <HardDrive size={26} className="text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">AWS not configured</p>
            <p className="text-xs text-muted-foreground mt-1">Add your AWS credentials in <a href="/settings" className="text-primary underline underline-offset-2">Settings</a> to manage EC2, S3, and ECS.</p>
          </div>
        </div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'ec2', label: 'EC2 Instances' },
    { id: 's3', label: 'S3 Buckets' },
    { id: 'ecs', label: 'ECS' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">AWS</h1>
          {status.accountId && (
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">Account {status.accountId}</p>
          )}
        </div>
        {tab !== 's3' && (
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            className="input-field text-xs py-1.5 w-auto"
          >
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-muted/50 rounded-lg p-1 w-fit border border-border">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              tab === t.id
                ? 'bg-card text-foreground shadow-sm border border-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ec2' && <Ec2Tab region={region} />}
      {tab === 's3' && <S3Tab />}
      {tab === 'ecs' && <EcsTab region={region} />}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/AWS.tsx
git commit -m "feat(aws): add AWS page with EC2/S3/ECS tabs"
```

---

### Task 9: Wire up routing and navigation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Add import and route in App.tsx**

Add import after the CiCd import:

```typescript
import AWS from './pages/AWS'
```

Add route after the cicd route:

```tsx
<Route path="aws" element={<AWS />} />
```

- [ ] **Step 2: Add nav entry in Layout.tsx**

The lucide import line already has icons. Add `HardDrive` to the existing lucide import line.

Current:
```typescript
import {
  LayoutDashboard, Server, Box, Rocket, GitFork, Globe,
  LogOut, ChevronLeft, ChevronRight, Menu, X, Zap, Settings, Network, Workflow
} from 'lucide-react'
```

Replace with:
```typescript
import {
  LayoutDashboard, Server, Box, Rocket, GitFork, Globe,
  LogOut, ChevronLeft, ChevronRight, Menu, X, Zap, Settings, Network, Workflow, HardDrive
} from 'lucide-react'
```

Add AWS entry to the `NAV` array, after the CI/CD entry:

```typescript
{ to: '/aws', label: 'AWS', icon: HardDrive },
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Layout.tsx
git commit -m "feat(aws): add AWS route and nav entry"
```

---

### Task 10: Build and verify

- [ ] **Step 1: Build the backend**

```bash
cd backend && mvn package -DskipTests -q
```

Expected: `BUILD SUCCESS`, JAR produced in `target/`.

- [ ] **Step 2: Build the frontend**

```bash
cd frontend && npm run build
```

Expected: `built in Xs` with no TypeScript errors.

- [ ] **Step 3: Rebuild Docker images and restart**

```bash
docker compose build --no-cache backend frontend && docker compose up -d
```

- [ ] **Step 4: Verify backend health**

```bash
curl -s http://localhost:8080/actuator/health | python -m json.tool
```

Expected: `"status": "UP"`.

- [ ] **Step 5: Smoke test the AWS status endpoint**

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"eduardoalcarialopes@gmail.com","password":"EDUtheo@13"}' | python -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s "http://localhost:8080/api/aws/status" -H "Authorization: Bearer $TOKEN"
```

Expected: `{"configured":false}` (until credentials are saved).

- [ ] **Step 6: Commit if any final fixes were needed**

```bash
git add -A && git commit -m "fix(aws): post-build corrections" 2>/dev/null || echo "No changes"
```

---

## Self-Review

**Spec coverage:**
- ✅ AWS credentials stored per-user (User entity, Settings page)
- ✅ Credential validation via STS GetCallerIdentity on save
- ✅ EC2: list, start, stop, terminate (with confirm step for terminate)
- ✅ S3: list buckets
- ✅ ECS: list clusters + expandable services per cluster
- ✅ Region selector on EC2 and ECS tabs
- ✅ Empty state when credentials not configured
- ✅ All routes follow existing `/api/...` pattern with `@AuthenticationPrincipal`
- ✅ `GlobalExceptionHandler` catches `IllegalArgumentException` → 400 with `{message}`

**Placeholder scan:** No TBD, no "handle edge cases", all code blocks are complete.

**Type consistency:** `Ec2Instance`, `S3Bucket`, `EcsCluster`, `EcsService` defined in `api/aws.ts` and used consistently in `AWS.tsx`. `AwsStatus` used in both Settings and AWS page queries.
