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
import software.amazon.awssdk.services.xray.XRayClient;
import software.amazon.awssdk.services.xray.model.BatchGetTracesRequest;
import software.amazon.awssdk.services.xray.model.GetTraceSummariesRequest;
import software.amazon.awssdk.services.xray.model.Trace;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

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

    // ── X-Ray Traces ──────────────────────────────────────────────────────────

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
