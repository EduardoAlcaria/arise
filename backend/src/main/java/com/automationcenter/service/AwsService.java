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
import software.amazon.awssdk.services.ec2.model.DescribeInstancesResponse;
import software.amazon.awssdk.services.ec2.model.StartInstancesRequest;
import software.amazon.awssdk.services.ec2.model.StopInstancesRequest;
import software.amazon.awssdk.services.ec2.model.Tag;
import software.amazon.awssdk.services.ec2.model.TerminateInstancesRequest;
import software.amazon.awssdk.services.ecs.EcsClient;
import software.amazon.awssdk.services.ecs.model.DescribeClustersRequest;
import software.amazon.awssdk.services.ecs.model.DescribeServicesRequest;
import software.amazon.awssdk.services.ecs.model.ListServicesRequest;
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
