package com.automationcenter.service;

import com.automationcenter.config.DataSeeder;
import com.automationcenter.config.MockAwsData;
import com.automationcenter.dto.aws.AwsAccountRequest;
import com.automationcenter.dto.aws.AwsAccountResponse;
import com.automationcenter.entity.AwsAccount;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.AwsAccountRepository;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.bouncycastle.asn1.dvcs.Data;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.auth.credentials.AnonymousCredentialsProvider;
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
import software.amazon.awssdk.services.ssooidc.SsoOidcClient;
import software.amazon.awssdk.services.ssooidc.model.AuthorizationPendingException;
import software.amazon.awssdk.services.ssooidc.model.CreateTokenRequest;
import software.amazon.awssdk.services.ssooidc.model.CreateTokenResponse;
import software.amazon.awssdk.services.ssooidc.model.RegisterClientRequest;
import software.amazon.awssdk.services.ssooidc.model.RegisterClientResponse;
import software.amazon.awssdk.services.ssooidc.model.SlowDownException;
import software.amazon.awssdk.services.ssooidc.model.StartDeviceAuthorizationRequest;
import software.amazon.awssdk.services.ssooidc.model.StartDeviceAuthorizationResponse;
import software.amazon.awssdk.services.xray.XRayClient;
import software.amazon.awssdk.services.xray.model.BatchGetTracesRequest;
import software.amazon.awssdk.services.xray.model.GetTraceSummariesRequest;
import software.amazon.awssdk.services.xray.model.Trace;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.redis.core.RedisTemplate;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
@RequiredArgsConstructor
@Slf4j
public class AwsService {

    private final AwsAccountRepository accountRepository;
    private final UserRepository userRepository;
    private final RedisTemplate<String, Object> redisTemplate;

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
                    if (DataSeeder.getDemoProfile().equals(a.getProfileName()))
                        return toResponse(a, true, "123456789012");
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

    public AwsAccountResponse updateAccount(Long userId, Long accountId, AwsAccountRequest req) {
        AwsAccount account = getAccount(accountId, userId);
        account.setName(req.getName());
        account.setProfileName(req.getProfileName());
        account.setDefaultRegion(req.getRegion());
        account.setTerraformRepoUrl(req.getTerraformRepoUrl());
        account = accountRepository.save(account);
        boolean reachable = false;
        String awsAccountId = null;
        try {
            GetCallerIdentityResponse id = StsClient.builder()
                    .credentialsProvider(ProfileCredentialsProvider.create(req.getProfileName()))
                    .region(Region.of(req.getRegion()))
                    .build()
                    .getCallerIdentity();
            reachable = true;
            awsAccountId = id.account();
        } catch (Exception e) {
            log.warn("Profile '{}' not reachable after update: {}", req.getProfileName(), e.getMessage());
        }
        return toResponse(account, reachable, awsAccountId);
    }

    public void deleteAccount(Long userId, Long accountId) {
        AwsAccount account = getAccount(accountId, userId);
        accountRepository.delete(account);
    }

    public Map<String, String> ssoLogin(Long userId, Long accountId) {
        AwsAccount account = getAccount(accountId, userId);
        String profileName = account.getProfileName();
        try {
            Map<String, String> profileConfig = parseAwsProfile(profileName);
            String startUrl = profileConfig.get("sso_start_url");
            String ssoRegion = profileConfig.getOrDefault("sso_region", account.getDefaultRegion());
            String sessionName = profileConfig.get("sso_session");
            if (startUrl == null) {
                throw new IllegalArgumentException(
                        "Profile '" + profileName + "' has no sso_start_url in ~/.aws/config");
            }

            SsoOidcClient oidc = SsoOidcClient.builder()
                    .region(Region.of(ssoRegion))
                    .credentialsProvider(AnonymousCredentialsProvider.create())
                    .build();

            RegisterClientResponse reg = oidc.registerClient(RegisterClientRequest.builder()
                    .clientName("AutomationHub")
                    .clientType("public")
                    .build());

            StartDeviceAuthorizationResponse auth = oidc.startDeviceAuthorization(
                    StartDeviceAuthorizationRequest.builder()
                            .clientId(reg.clientId())
                            .clientSecret(reg.clientSecret())
                            .startUrl(startUrl)
                            .build());

            String url = auth.verificationUriComplete() != null
                    ? auth.verificationUriComplete() : auth.verificationUri();
            String code = auth.userCode();
            int interval = auth.interval() != null ? auth.interval() : 5;

            Thread.ofVirtual().start(() ->
                    pollForSsoToken(oidc, reg, auth.deviceCode(), interval,
                            startUrl, ssoRegion, profileName, sessionName));

            return Map.of("url", url, "code", code, "profile", profileName);
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to start SSO login: " + e.getMessage());
        }
    }

    private void pollForSsoToken(SsoOidcClient oidc, RegisterClientResponse reg,
                                  String deviceCode, int intervalSeconds,
                                  String startUrl, String ssoRegion, String profileName,
                                  String sessionName) {
        int interval = intervalSeconds;
        try {
            while (true) {
                Thread.sleep(interval * 1000L);
                try {
                    CreateTokenResponse token = oidc.createToken(CreateTokenRequest.builder()
                            .clientId(reg.clientId())
                            .clientSecret(reg.clientSecret())
                            .grantType("urn:ietf:params:oauth:grant-type:device_code")
                            .deviceCode(deviceCode)
                            .build());
                    writeSsoTokenCache(startUrl, ssoRegion, sessionName, reg, token);
                    log.info("SSO token written for profile '{}'", profileName);
                    return;
                } catch (AuthorizationPendingException ignored) {
                } catch (SlowDownException e) {
                    interval += 5;
                } catch (Exception e) {
                    log.warn("SSO polling stopped for profile '{}': {}", profileName, e.getMessage());
                    return;
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            oidc.close();
        }
    }

    private void writeSsoTokenCache(String startUrl, String region, String sessionName,
                                     RegisterClientResponse reg, CreateTokenResponse token) {
        try {
            // sso_session profiles use sha1(sessionName) as cache key; old-style profiles use sha1(startUrl)
            String cacheKey = sessionName != null ? sessionName : startUrl;
            Path cacheDir = Path.of(System.getProperty("user.home"), ".aws", "sso", "cache");
            Files.createDirectories(cacheDir);
            Instant expiresAt = Instant.now().plusSeconds(token.expiresIn() != null ? token.expiresIn() : 3600);

            StringBuilder json = new StringBuilder();
            json.append('{');
            json.append("\"startUrl\":\"").append(startUrl).append("\",");
            json.append("\"region\":\"").append(region).append("\",");
            json.append("\"accessToken\":\"").append(token.accessToken()).append("\",");
            json.append("\"expiresAt\":\"").append(expiresAt).append("\"");
            if (token.refreshToken() != null)
                json.append(",\"refreshToken\":\"").append(token.refreshToken()).append("\"");
            if (reg.clientId() != null)
                json.append(",\"clientId\":\"").append(reg.clientId()).append("\"");
            if (reg.clientSecret() != null)
                json.append(",\"clientSecret\":\"").append(reg.clientSecret()).append("\"");
            if (reg.clientSecretExpiresAt() != null)
                json.append(",\"registrationExpiresAt\":\"").append(Instant.ofEpochSecond(reg.clientSecretExpiresAt())).append("\"");
            json.append('}');

            Files.writeString(cacheDir.resolve(sha1Hex(cacheKey) + ".json"), json.toString());
        } catch (Exception e) {
            log.error("Failed to write SSO token cache: {}", e.getMessage());
        }
    }

    private String sha1Hex(String input) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-1")
                .digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : hash) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private Map<String, String> parseAwsProfile(String profileName) {
        Path configFile = Path.of(System.getProperty("user.home"), ".aws", "config");
        try {
            List<String> lines = Files.readAllLines(configFile);
            Map<String, String> profile = parseSection(lines, "[profile " + profileName + "]");
            // If profile uses sso_session indirection, resolve it
            String sessionName = profile.get("sso_session");
            if (sessionName != null && !profile.containsKey("sso_start_url")) {
                Map<String, String> session = parseSection(lines, "[sso-session " + sessionName + "]");
                if (session.containsKey("sso_start_url")) profile.put("sso_start_url", session.get("sso_start_url"));
                if (session.containsKey("sso_region") && !profile.containsKey("sso_region")) profile.put("sso_region", session.get("sso_region"));
            }
            return profile;
        } catch (Exception e) {
            log.warn("Could not read ~/.aws/config: {}", e.getMessage());
            return new HashMap<>();
        }
    }

    private Map<String, String> parseSection(List<String> lines, String header) {
        Map<String, String> result = new HashMap<>();
        boolean inSection = false;
        for (String line : lines) {
            line = line.trim();
            if (line.startsWith("[")) { inSection = line.equals(header); continue; }
            if (inSection && line.contains("=")) {
                int eq = line.indexOf('=');
                result.put(line.substring(0, eq).trim(), line.substring(eq + 1).trim());
            }
        }
        return result;
    }

    // ── EC2 ───────────────────────────────────────────────────────────────────

    @Cacheable(value = "aws-ec2", key = "#accountId + ':' + #region")
    public List<Map<String, Object>> listEc2Instances(Long userId, Long accountId, String region) {
        AwsAccount account = getAccount(accountId, userId);
        String effectiveRegion = region != null ? region : account.getDefaultRegion();
        if (DataSeeder.getDemoProfile().equals(account.getProfileName()))
            return MockAwsData.ec2Instances(effectiveRegion);
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
                        item.put("vpcId", i.vpcId());
                        item.put("subnetId", i.subnetId());
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

    @Cacheable(value = "aws-s3", key = "#accountId")
    public List<Map<String, Object>> listS3Buckets(Long userId, Long accountId) {
        AwsAccount account = getAccount(accountId, userId);
        if (DataSeeder.getDemoProfile().equals(account.getProfileName()))
            return MockAwsData.s3Buckets();
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

    @Cacheable(value = "aws-ecs", key = "#accountId + ':' + #region")
    public List<Map<String, Object>> listEcsClusters(Long userId, Long accountId, String region) {
        AwsAccount account = getAccount(accountId, userId);
        String effectiveRegion = region != null ? region : account.getDefaultRegion();
        if (DataSeeder.getDemoProfile().equals(account.getProfileName()))
            return MockAwsData.ecsClusters(effectiveRegion);
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

    @Cacheable(value = "aws-ecs-services", key = "#accountId + ':' + #clusterArn")
    public List<Map<String, Object>> listEcsServices(Long userId, Long accountId, String clusterArn, String region) {
        AwsAccount account = getAccount(accountId, userId);
        String effectiveRegion = region != null ? region : account.getDefaultRegion();
        if (DataSeeder.getDemoProfile().equals(account.getProfileName()))
            return MockAwsData.ecsServices(clusterArn);
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

    @Cacheable(value = "aws-traces", key = "#accountId + ':' + #region + ':' + #minutes")
    public List<Map<String, Object>> listTraces(Long userId, Long accountId, String region, int minutes) {
        AwsAccount account = getAccount(accountId, userId);
        String effectiveRegion = region != null ? region : account.getDefaultRegion();
        if (DataSeeder.getDemoProfile().equals(account.getProfileName()))
            return MockAwsData.traces();
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
                        if (t.http() != null) {
                            item.put("url", t.http().httpURL());
                            item.put("method", t.http().httpMethod());
                            item.put("clientIp", t.http().clientIp());
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

    public void evictAccount(Long accountId) {
        for (String cacheName : List.of("aws-ec2", "aws-s3", "aws-ecs", "aws-ecs-services",
                "aws-topology", "aws-explorer", "aws-traces")) {
            Set<String> keys = redisTemplate.keys(cacheName + "::" + accountId + "*");
            if (keys != null && !keys.isEmpty()) redisTemplate.delete(keys);
        }
    }
}
