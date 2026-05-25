package com.automationcenter.service;

import com.automationcenter.config.RabbitMQConfig;
import com.automationcenter.dto.cloudflare.CloudflareTunnelRequest;
import com.automationcenter.dto.cloudflare.CloudflareTunnelResponse;
import com.automationcenter.dto.deployment.AppServiceDto;
import com.automationcenter.dto.deployment.ConfigFileDto;
import com.automationcenter.dto.deployment.DeploymentRequest;
import com.automationcenter.dto.deployment.DeploymentResponse;
import com.automationcenter.entity.*;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.DeploymentRepository;
import com.automationcenter.repository.UserRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class DeploymentService {

    private final DeploymentRepository deploymentRepository;
    private final UserRepository userRepository;
    private final MachineService machineService;
    private final com.automationcenter.repository.MachineRepository machineRepository;
    private final SshService sshService;
    private final LogService logService;
    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;
    private final CloudflareService cloudflareService;
    private final LogBroadcaster logBroadcaster;

    @Transactional
    public DeploymentResponse create(DeploymentRequest request, Long ownerId) {
        User owner = userRepository.findById(ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        Machine machine = machineService.findByIdAndOwner(request.getMachineId(), ownerId);

        Deployment.DeploymentBuilder builder = Deployment.builder()
                .name(request.getName())
                .type(request.getType())
                .repositoryUrl(request.getRepositoryUrl())
                .branch(request.getBranch() != null ? request.getBranch() : "main")
                .version(request.getVersion())
                .machine(machine)
                .owner(owner);

        if (request.getType() == DeploymentType.APPLICATION) {
            try {
                if (request.getServices() != null)
                    builder.applicationServices(objectMapper.writeValueAsString(request.getServices()));
                if (request.getConfigFiles() != null)
                    builder.applicationConfigs(objectMapper.writeValueAsString(request.getConfigFiles()));
            } catch (Exception e) {
                throw new RuntimeException("Failed to serialize application config", e);
            }
            if (request.getTunnelName() != null && !request.getTunnelName().isBlank()) {
                builder.tunnelName(request.getTunnelName())
                        .tunnelHostname(request.getTunnelHostname())
                        .tunnelAppPort(request.getTunnelAppPort() != null ? request.getTunnelAppPort() : 80);
            }
        }

        if (request.getType() == DeploymentType.REPOSITORY && request.getConfigFiles() != null && !request.getConfigFiles().isEmpty()) {
            try {
                builder.repoConfigs(objectMapper.writeValueAsString(request.getConfigFiles()));
            } catch (Exception e) {
                throw new RuntimeException("Failed to serialize repo config files", e);
            }
        }

        if (request.getWebhookUrl() != null && !request.getWebhookUrl().isBlank()) {
            builder.webhookUrl(request.getWebhookUrl());
        }
        Deployment deployment = deploymentRepository.save(builder.build());
        final Long deploymentId = deployment.getId();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                rabbitTemplate.convertAndSend(
                        RabbitMQConfig.DEPLOYMENT_RUN_EXCHANGE,
                        RabbitMQConfig.DEPLOYMENT_RUN_KEY,
                        deploymentId
                );
                log.info("[RabbitMQ] Queued deployment job: {}", deploymentId);
            }
        });
        return toResponse(deployment);
    }

    public void executeAsync(Long deploymentId) {
        Deployment deployment = deploymentRepository.findById(deploymentId)
                .orElseThrow(() -> new ResourceNotFoundException("Deployment not found: " + deploymentId));
        // Reload machine from DB to avoid Hibernate LazyInitializationException in async thread
        Machine machine = machineRepository.findById(deployment.getMachine().getId())
                .orElseThrow(() -> new ResourceNotFoundException("Machine not found for deployment " + deploymentId));
        // Fetch owner's GitHub token eagerly to avoid LazyInitializationException in async thread
        String ownerGithubToken = userRepository.findById(deployment.getOwner().getId())
                .map(User::getGithubToken).orElse(null);

        try {
            deployment.setStatus(DeploymentStatus.BUILDING);
            deployment.setStartedAt(LocalDateTime.now());
            deploymentRepository.save(deployment);
            appendLog(deployment, "Starting deployment: " + deployment.getName(), LogLevel.INFO);

            if (deployment.getType() == DeploymentType.APPLICATION) {
                executeApplicationDeploy(deployment, machine, ownerGithubToken);
                return;
            }

            // Pre-flight: ensure git is installed (needed for clone)
            if (!preflightAndInstall(machine, deployment, "git-only")) {
                fail(deployment);
                return;
            }

            // Detect target OS (Windows cmd.exe won't recognise 'uname')
            var osCheck = sshService.execute(machine, "uname -s 2>/dev/null || echo Windows");
            boolean isWindows = osCheck.getStdout().trim().equalsIgnoreCase("windows")
                    || osCheck.getExitCode() != 0;
            appendLog(deployment, "Target OS: " + (isWindows ? "Windows" : osCheck.getStdout().trim()), LogLevel.INFO);

            fixDockerCredentials(deployment, machine, isWindows);

            String repoDir = isWindows
                    ? "%TEMP%\\deploy_" + deploymentId
                    : "/tmp/deploy_" + deploymentId;

            // Inject GitHub token into HTTPS clone URL for authenticated access
            String cloneUrl = deployment.getRepositoryUrl();
            if (ownerGithubToken != null && !ownerGithubToken.isBlank()
                    && cloneUrl != null && cloneUrl.startsWith("https://github.com/")) {
                cloneUrl = cloneUrl.replace("https://github.com/", "https://" + ownerGithubToken + "@github.com/");
            }

            // Clone — rm on Unix, rmdir on Windows
            String cloneCmd = isWindows
                    ? "rmdir /s /q \"" + repoDir + "\" 2>nul & git clone " + cloneUrl + " -b \"" + deployment.getBranch().replace("\"", "") + "\" \"" + repoDir + "\""
                    : "rm -rf " + repoDir + " && git clone " + sq(cloneUrl) + " -b " + sq(deployment.getBranch()) + " " + repoDir;
            appendLog(deployment, "Cloning repository: " + deployment.getRepositoryUrl(), LogLevel.INFO);
            var cloneResult = sshService.execute(machine, cloneCmd);
            appendLog(deployment, sanitizeGitOutput(cloneResult.getStdout()), LogLevel.INFO);
            if (cloneResult.getExitCode() != 0) {
                appendLog(deployment, "Clone failed: " + sanitizeGitOutput(cloneResult.getStderr()), LogLevel.ERROR);
                fail(deployment);
                return;
            }

            deployment.setDeployDir(repoDir);
            deploymentRepository.save(deployment);

            if (deployment.getRepoConfigs() != null) {
                if (!isWindows) {
                    try {
                        List<ConfigFileDto> cfgFiles = objectMapper.readValue(deployment.getRepoConfigs(), new TypeReference<>() {});
                        for (ConfigFileDto cfg : cfgFiles) {
                            // path traversal check
                            String normalised = cfg.getPath().replace("\\", "/");
                            if (normalised.contains("..")) {
                                appendLog(deployment, "Skipping unsafe config path: " + cfg.getPath(), LogLevel.WARN);
                                continue;
                            }
                            String filePath = repoDir + "/" + normalised;
                            appendLog(deployment, "Writing config: " + cfg.getPath(), LogLevel.INFO);
                            var writeResult = sshService.writeFileViaShell(machine, filePath, cfg.getContent());
                            if (writeResult.getExitCode() != 0) {
                                appendLog(deployment, "Failed to write " + cfg.getPath() + ": " + writeResult.getStderr(), LogLevel.ERROR);
                                fail(deployment);
                                return;
                            }
                        }
                    } catch (Exception e) {
                        appendLog(deployment, "Failed to parse config files: " + e.getMessage(), LogLevel.ERROR);
                        fail(deployment);
                        return;
                    }
                } else {
                    appendLog(deployment, "Config file injection not supported for Windows targets — skipping", LogLevel.WARN);
                }
            }

            // Read .arise.yml for deployment hints (compose file override)
            String ariseComposeFile = null;
            if (!isWindows) {
                var ariseYml = sshService.execute(machine, "cat " + repoDir + "/.arise.yml 2>/dev/null || true");
                if (ariseYml.getExitCode() == 0 && !ariseYml.getStdout().isBlank()) {
                    try {
                        org.yaml.snakeyaml.Yaml yaml = new org.yaml.snakeyaml.Yaml();
                        @SuppressWarnings("unchecked")
                        var ariseData = (java.util.Map<String, Object>) yaml.load(ariseYml.getStdout());
                        if (ariseData != null && ariseData.get("compose") instanceof String cf) {
                            ariseComposeFile = cf;
                            appendLog(deployment, "Using compose file from .arise.yml: " + ariseComposeFile, LogLevel.INFO);
                        }
                    } catch (Exception e) {
                        appendLog(deployment, "Could not parse .arise.yml: " + e.getMessage(), LogLevel.WARN);
                    }
                }
            }

            // Detect stack — arise.yml compose hint overrides file-based detection
            String stack = ariseComposeFile != null ? "compose" : detectStack(machine, repoDir, isWindows);
            deployment.setDetectedStack(stack);
            appendLog(deployment, "Detected stack: " + stack, LogLevel.INFO);

            deployment.setStatus(DeploymentStatus.DEPLOYING);
            deploymentRepository.save(deployment);

            // Pre-flight: ensure stack-specific dependencies are installed
            if (!isWindows && !preflightAndInstall(machine, deployment, stack)) {
                fail(deployment);
                return;
            }

            // Tear down any previous successful deploy of this repo on this machine
            if (!isWindows && "compose".equals(stack)) {
                teardownPreviousDeployment(deployment, machine);
            }

            // Stack-specific build step
            String buildCmd = getBuildCommand(stack, repoDir, isWindows, ariseComposeFile);
            if (!buildCmd.isEmpty()) {
                appendLog(deployment, "Running build: " + buildCmd, LogLevel.INFO);
                var buildResult = sshService.execute(machine, buildCmd);
                appendLog(deployment, buildResult.getStdout(), LogLevel.INFO);
                if (buildResult.getExitCode() != 0) {
                    appendLog(deployment, "Build failed: " + buildResult.getStderr(), LogLevel.ERROR);
                    fail(deployment);
                    return;
                }
            }

            if ("compose".equals(stack) && !isWindows) {
                String composeFileFlag = ariseComposeFile != null ? " -f " + sq(ariseComposeFile) : "";
                var psResult = sshService.execute(machine, "cd " + repoDir + " && docker compose" + composeFileFlag + " ps 2>&1");
                appendLog(deployment, "--- Container status ---\n" + psResult.getStdout(), LogLevel.INFO);
            }

            // Optional Cloudflare tunnel for repo deployments
            if (deployment.getTunnelName() != null && !deployment.getTunnelName().isBlank()) {
                try {
                    appendLog(deployment, "Creating Cloudflare tunnel: " + deployment.getTunnelName(), LogLevel.INFO);
                    String secret = java.util.UUID.randomUUID().toString().replace("-", "");
                    var tunnel = cloudflareService.createTunnel(deployment.getOwner().getId(),
                            new CloudflareTunnelRequest(deployment.getTunnelName(), secret));
                    String serviceUrl = "http://localhost:" + deployment.getTunnelAppPort();
                    cloudflareService.configureTunnelIngress(deployment.getOwner().getId(), tunnel.getId(),
                            deployment.getTunnelHostname(), serviceUrl);
                    cloudflareService.createDnsCname(deployment.getOwner().getId(), deployment.getTunnelHostname(), tunnel.getId());
                    String tunnelToken = cloudflareService.getTunnelToken(deployment.getOwner().getId(), tunnel.getId());
                    sshService.execute(machine, cloudflaredDockerCmd("cloudflared_" + deploymentId, tunnelToken));
                    deployment.setCloudfareTunnelId(tunnel.getId());
                    deployment.setCloudfareTunnelUrl("https://" + deployment.getTunnelHostname());
                    appendLog(deployment, "Tunnel active: https://" + deployment.getTunnelHostname(), LogLevel.INFO);
                } catch (Exception e) {
                    appendLog(deployment, "Cloudflare tunnel setup failed: " + e.getMessage(), LogLevel.WARN);
                }
            }

            deployment.setStatus(DeploymentStatus.SUCCESS);
            deployment.setFinishedAt(LocalDateTime.now());
            deploymentRepository.save(deployment);
            appendLog(deployment, "Deployment completed successfully", LogLevel.INFO);
            logBroadcaster.complete(deployment.getId());

            rabbitTemplate.convertAndSend(
                    RabbitMQConfig.DEPLOYMENT_EXCHANGE,
                    RabbitMQConfig.DEPLOYMENT_ROUTING_KEY,
                    "DEPLOYMENT_SUCCESS:" + deploymentId
            );

        } catch (Exception e) {
            log.error("Deployment {} failed with exception", deploymentId, e);
            appendLog(deployment, "Unexpected error: " + e.getMessage(), LogLevel.ERROR);
            fail(deployment);
        }
    }

    private void executeApplicationDeploy(Deployment deployment, Machine machine, String ownerGithubToken) {
        try {
            List<AppServiceDto> services = deployment.getApplicationServices() != null
                    ? objectMapper.readValue(deployment.getApplicationServices(), new TypeReference<>() {})
                    : List.of();
            List<ConfigFileDto> configFiles = deployment.getApplicationConfigs() != null
                    ? objectMapper.readValue(deployment.getApplicationConfigs(), new TypeReference<>() {})
                    : List.of();

            fixDockerCredentials(deployment, machine, false);

            // Pre-flight: application deploys require git + docker + docker compose
            if (!preflightAndInstall(machine, deployment, "compose")) {
                fail(deployment);
                return;
            }

            // Resolve remote home dir first; fall back to /tmp if ssh fails
            var homeResult = sshService.execute(machine, "echo $HOME");
            String remoteHome = homeResult.getExitCode() == 0 && !homeResult.getStdout().isBlank()
                    ? homeResult.getStdout().strip() : "/tmp";
            String baseDir = remoteHome + "/arise-apps/" + deployment.getId();
            var mkdirResult = sshService.execute(machine, "mkdir -p " + baseDir);
            if (mkdirResult.getExitCode() != 0) {
                appendLog(deployment, "Failed to create app dir: " + mkdirResult.getStderr(), LogLevel.ERROR);
                fail(deployment);
                return;
            }

            deployment.setDeployDir(baseDir);
            deploymentRepository.save(deployment);

            for (AppServiceDto service : services) {
                String safeName = service.getName().replaceAll("[^a-zA-Z0-9_-]", "_");
                String serviceDir = baseDir + "/" + safeName;
                String repoUrl = service.getRepoUrl();
                if (ownerGithubToken != null && !ownerGithubToken.isBlank()
                        && repoUrl != null && repoUrl.startsWith("https://github.com/")) {
                    repoUrl = repoUrl.replace("https://github.com/", "https://" + ownerGithubToken + "@github.com/");
                }
                String branch = service.getBranch() != null ? service.getBranch() : "main";
                String cloneCmd = "rm -rf " + sq(serviceDir) + " && git clone " + sq(repoUrl) + " -b " + sq(branch) + " " + sq(serviceDir);
                appendLog(deployment, "Cloning service " + safeName, LogLevel.INFO);
                var cloneResult = sshService.execute(machine, cloneCmd);
                appendLog(deployment, sanitizeGitOutput(cloneResult.getStdout()), LogLevel.INFO);
                if (cloneResult.getExitCode() != 0) {
                    appendLog(deployment, "Clone failed for " + safeName + ": " + sanitizeGitOutput(cloneResult.getStderr()), LogLevel.ERROR);
                    fail(deployment);
                    return;
                }
            }

            for (ConfigFileDto cfg : configFiles) {
                String filePath = baseDir + "/" + cfg.getPath();
                appendLog(deployment, "Writing config: " + cfg.getPath(), LogLevel.INFO);
                var writeResult = sshService.writeFileViaShell(machine, filePath, cfg.getContent());
                if (writeResult.getExitCode() != 0) {
                    appendLog(deployment, "Failed to write " + cfg.getPath() + ": " + writeResult.getStderr(), LogLevel.ERROR);
                    fail(deployment);
                    return;
                }
            }

            deployment.setStatus(DeploymentStatus.DEPLOYING);
            deploymentRepository.save(deployment);

            teardownPreviousDeployment(deployment, machine);

            String composeCmd = "cd " + baseDir + " && docker compose up --build -d 2>&1";
            appendLog(deployment, "Running docker compose up --build -d", LogLevel.INFO);
            var composeResult = sshService.execute(machine, composeCmd);
            appendLog(deployment, composeResult.getStdout(), LogLevel.INFO);
            if (composeResult.getExitCode() != 0) {
                appendLog(deployment, "docker compose failed: " + composeResult.getStderr(), LogLevel.ERROR);
                fail(deployment);
                return;
            }

            var psResult = sshService.execute(machine, "cd " + baseDir + " && docker compose ps 2>&1");
            appendLog(deployment, "--- Container status ---\n" + psResult.getStdout(), LogLevel.INFO);

            if (deployment.getTunnelName() != null && !deployment.getTunnelName().isBlank()) {
                try {
                    appendLog(deployment, "Creating Cloudflare tunnel: " + deployment.getTunnelName(), LogLevel.INFO);
                    String secret = java.util.UUID.randomUUID().toString().replace("-", "");
                    CloudflareTunnelResponse tunnel = cloudflareService.createTunnel(
                            deployment.getOwner().getId(),
                            new CloudflareTunnelRequest(deployment.getTunnelName(), secret)
                    );
                    String serviceUrl = "http://localhost:" + deployment.getTunnelAppPort();
                    cloudflareService.configureTunnelIngress(
                            deployment.getOwner().getId(), tunnel.getId(),
                            deployment.getTunnelHostname(), serviceUrl
                    );
                    cloudflareService.createDnsCname(
                            deployment.getOwner().getId(), deployment.getTunnelHostname(), tunnel.getId()
                    );
                    String tunnelToken = cloudflareService.getTunnelToken(
                            deployment.getOwner().getId(), tunnel.getId()
                    );
                    sshService.execute(machine, cloudflaredDockerCmd("cloudflared_" + deployment.getId(), tunnelToken));
                    deployment.setCloudfareTunnelId(tunnel.getId());
                    deployment.setCloudfareTunnelUrl("https://" + deployment.getTunnelHostname());
                    appendLog(deployment, "Tunnel active: https://" + deployment.getTunnelHostname(), LogLevel.INFO);
                } catch (Exception e) {
                    appendLog(deployment, "Cloudflare tunnel setup failed: " + e.getMessage(), LogLevel.WARN);
                }
            }

            deployment.setStatus(DeploymentStatus.SUCCESS);
            deployment.setFinishedAt(LocalDateTime.now());
            deploymentRepository.save(deployment);
            appendLog(deployment, "Application deployed successfully", LogLevel.INFO);
            logBroadcaster.complete(deployment.getId());
            rabbitTemplate.convertAndSend(RabbitMQConfig.DEPLOYMENT_EXCHANGE,
                    RabbitMQConfig.DEPLOYMENT_ROUTING_KEY, "DEPLOYMENT_SUCCESS:" + deployment.getId());

        } catch (Exception e) {
            log.error("Application deployment {} failed", deployment.getId(), e);
            appendLog(deployment, "Unexpected error: " + e.getMessage(), LogLevel.ERROR);
            fail(deployment);
        }
    }

    public Page<DeploymentResponse> listByOwner(Long ownerId, Pageable pageable) {
        return deploymentRepository.findByOwnerId(ownerId, pageable).map(this::toResponse);
    }

    public DeploymentResponse getById(Long id, Long ownerId) {
        return toResponse(findByIdAndOwner(id, ownerId));
    }

    @org.springframework.transaction.annotation.Transactional
    public void delete(Long id, Long ownerId) {
        Deployment deployment = findByIdAndOwner(id, ownerId);

        // Stop running containers
        if (deployment.getDeployDir() != null && !deployment.getDeployDir().isBlank() && deployment.getMachine() != null) {
            try {
                sshService.execute(deployment.getMachine(),
                        "cd " + deployment.getDeployDir() + " && docker compose down 2>/dev/null; true");
            } catch (Exception e) {
                log.warn("Could not stop containers for deployment {}: {}", id, e.getMessage());
            }
        }

        // Delete Cloudflare tunnel
        if (deployment.getCloudfareTunnelId() != null && !deployment.getCloudfareTunnelId().isBlank()) {
            try {
                cloudflareService.deleteTunnel(ownerId, deployment.getCloudfareTunnelId());
            } catch (Exception e) {
                log.warn("Could not delete Cloudflare tunnel for deployment {}: {}", id, e.getMessage());
            }
        }

        logService.deleteByDeploymentId(id);
        deploymentRepository.delete(deployment);
    }

    public DeploymentResponse removeTunnel(Long id, Long ownerId) {
        Deployment deployment = findByIdAndOwner(id, ownerId);
        if (deployment.getCloudfareTunnelId() == null || deployment.getCloudfareTunnelId().isBlank()) {
            throw new IllegalArgumentException("This deployment has no Cloudflare tunnel");
        }
        // Best-effort delete from Cloudflare (cloudflared container on machine still runs until next restart)
        try {
            cloudflareService.deleteTunnel(ownerId, deployment.getCloudfareTunnelId());
        } catch (Exception e) {
            log.warn("Could not delete tunnel {} from Cloudflare: {}", deployment.getCloudfareTunnelId(), e.getMessage());
        }
        deployment.setCloudfareTunnelId(null);
        deployment.setCloudfareTunnelUrl(null);
        deployment.setTunnelName(null);
        deployment.setTunnelHostname(null);
        deployment.setTunnelAppPort(null);
        return toResponse(deploymentRepository.save(deployment));
    }

    public DeploymentResponse rollback(Long id, Long ownerId) {
        Deployment deployment = findByIdAndOwner(id, ownerId);
        DeploymentStatus currentStatus = deployment.getStatus();
        if (currentStatus == DeploymentStatus.BUILDING || currentStatus == DeploymentStatus.DEPLOYING || currentStatus == DeploymentStatus.PENDING) {
            throw new IllegalArgumentException("Cannot roll back a deployment that is still in progress");
        }
        Machine machine = deployment.getMachine();

        if (deployment.getDeployDir() != null && machine != null) {
            appendLog(deployment, "Rolling back: stopping containers in " + deployment.getDeployDir(), LogLevel.INFO);
            try {
                String downCmd = "cd " + deployment.getDeployDir() + " && docker compose down 2>&1";
                var result = sshService.execute(machine, downCmd);
                appendLog(deployment, result.getStdout(), LogLevel.INFO);
                if (result.getExitCode() != 0) {
                    appendLog(deployment, "docker compose down exited with code " + result.getExitCode() + ": " + result.getStderr(), LogLevel.WARN);
                }
            } catch (Exception e) {
                appendLog(deployment, "Rollback SSH failed: " + e.getMessage(), LogLevel.WARN);
            }
        }

        deployment.setStatus(DeploymentStatus.ROLLED_BACK);
        deployment.setFinishedAt(LocalDateTime.now());
        deploymentRepository.save(deployment);
        return toResponse(deployment);
    }

    public DeploymentResponse redeploy(Long sourceId, Long ownerId) {
        Deployment source = findByIdAndOwner(sourceId, ownerId);
        User owner = userRepository.findById(ownerId).orElseThrow();
        Machine machine = source.getMachine();

        Deployment.DeploymentBuilder builder = Deployment.builder()
                .name(source.getName())
                .type(source.getType())
                .repositoryUrl(source.getRepositoryUrl())
                .branch(source.getBranch())
                .version(source.getVersion())
                .machine(machine)
                .owner(owner);

        // Carry over stored configs (APPLICATION type)
        if (source.getApplicationServices() != null)
            builder.applicationServices(source.getApplicationServices());
        if (source.getApplicationConfigs() != null)
            builder.applicationConfigs(source.getApplicationConfigs());
        // Carry over REPOSITORY injected config files
        if (source.getRepoConfigs() != null)
            builder.repoConfigs(source.getRepoConfigs());
        // Carry over webhook URL
        if (source.getWebhookUrl() != null)
            builder.webhookUrl(source.getWebhookUrl());
        // Carry over tunnel config
        if (source.getTunnelName() != null)
            builder.tunnelName(source.getTunnelName())
                   .tunnelHostname(source.getTunnelHostname())
                   .tunnelAppPort(source.getTunnelAppPort());

        Deployment deployment = deploymentRepository.save(builder.build());
        executeAsync(deployment.getId());
        return toResponse(deployment);
    }

    public DeploymentResponse addTunnel(Long deploymentId, Long ownerId, String tunnelName, String tunnelHostname, int tunnelAppPort) {
        Deployment deployment = findByIdAndOwner(deploymentId, ownerId);
        Machine machine = deployment.getMachine();
        try {
            appendLog(deployment, "Creating Cloudflare tunnel: " + tunnelName, LogLevel.INFO);
            String secret = java.util.UUID.randomUUID().toString().replace("-", "");
            var tunnel = cloudflareService.createTunnel(ownerId, new com.automationcenter.dto.cloudflare.CloudflareTunnelRequest(tunnelName, secret));
            String serviceUrl = "http://localhost:" + tunnelAppPort;
            cloudflareService.configureTunnelIngress(ownerId, tunnel.getId(), tunnelHostname, serviceUrl);
            cloudflareService.createDnsCname(ownerId, tunnelHostname, tunnel.getId());
            String tunnelToken = cloudflareService.getTunnelToken(ownerId, tunnel.getId());
            sshService.execute(machine, cloudflaredDockerCmd("cloudflared_" + deploymentId, tunnelToken));
            deployment.setTunnelName(tunnelName);
            deployment.setTunnelHostname(tunnelHostname);
            deployment.setTunnelAppPort(tunnelAppPort);
            deployment.setCloudfareTunnelId(tunnel.getId());
            deployment.setCloudfareTunnelUrl("https://" + tunnelHostname);
            appendLog(deployment, "Tunnel active: https://" + tunnelHostname, LogLevel.INFO);
            return toResponse(deploymentRepository.save(deployment));
        } catch (Exception e) {
            appendLog(deployment, "Tunnel setup failed: " + e.getMessage(), LogLevel.ERROR);
            throw new RuntimeException("Tunnel setup failed: " + e.getMessage(), e);
        }
    }

    public Deployment findRawById(Long id, Long ownerId) {
        return findByIdAndOwner(id, ownerId);
    }

    private Deployment findByIdAndOwner(Long id, Long ownerId) {
        return deploymentRepository.findByIdAndOwnerId(id, ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("Deployment not found: " + id));
    }

    private void fail(Deployment deployment) {
        deployment.setStatus(DeploymentStatus.FAILED);
        deployment.setFinishedAt(LocalDateTime.now());
        deploymentRepository.save(deployment);
        rabbitTemplate.convertAndSend(
                RabbitMQConfig.DEPLOYMENT_EXCHANGE,
                RabbitMQConfig.DEPLOYMENT_ROUTING_KEY,
                "DEPLOYMENT_FAILED:" + deployment.getId()
        );
        logBroadcaster.complete(deployment.getId());
    }

    private void appendLog(Deployment deployment, String message, LogLevel level) {
        if (message == null || message.isBlank()) return;
        logService.save(deployment.getId(), message, level);
        String existing = deployment.getLogs() == null ? "" : deployment.getLogs();
        deployment.setLogs(existing + "\n" + message);
        deploymentRepository.save(deployment);
        logBroadcaster.publish(deployment.getId(), message);
    }

    private String detectStack(Machine machine, String repoDir, boolean isWindows) {
        String sep = isWindows ? "\\" : "/";
        // Single SSH call: list files and detect from output
        String listCmd = isWindows
                ? "dir /b \"" + repoDir + "\""
                : "ls " + repoDir;
        var listResult = sshService.execute(machine, listCmd);
        String files = listResult.getStdout().toLowerCase();
        if (files.contains("docker-compose.yml") || files.contains("docker-compose.yaml")) return "compose";
        if (files.contains("dockerfile"))  return "docker";
        if (files.contains("package.json")) return "node";
        if (files.contains("pom.xml"))      return "maven";
        if (files.contains("build.gradle")) return "gradle";
        if (files.contains("requirements.txt") || files.contains("pyproject.toml")) return "python";
        return "unknown";
    }

    /** Single-quote a string for safe use in Unix shell commands. */
    private static String sq(String s) {
        return "'" + (s == null ? "" : s).replace("'", "'\\''") + "'";
    }

    /**
     * Build a docker run command for cloudflared that passes the tunnel token via a
     * temp env file so it doesn't appear in `ps aux` or /proc/pid/cmdline.
     */
    private static String cloudflaredDockerCmd(String containerName, String tunnelToken) {
        String envFile = "/tmp/.cf_" + containerName + ".env";
        return "printf 'TUNNEL_TOKEN=%s\\n' " + sq(tunnelToken) + " > " + envFile +
               " && docker rm -f " + sq(containerName) + " 2>/dev/null || true" +
               " && docker run -d --name " + sq(containerName) +
               " --network host --env-file " + envFile +
               " cloudflare/cloudflared:latest tunnel run" +
               " && rm -f " + envFile;
    }

    private boolean commandExists(Machine machine, String cmd) {
        // Prepend Homebrew + common paths since ChannelExec skips shell profile
        var r = sshService.execute(machine,
            "PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:$PATH command -v " + cmd + " 2>/dev/null");
        if (!r.getStderr().isBlank()) log.debug("commandExists({}) stderr: {}", cmd, r.getStderr());
        if (r.getExitCode() < 0) log.warn("commandExists({}) SSH failed: {}", cmd, r.getStderr());
        return r.getExitCode() == 0 && !r.getStdout().isBlank();
    }

    private boolean dockerComposeAvailable(Machine machine) {
        if (commandExists(machine, "docker-compose")) return true;
        var r = sshService.execute(machine,
            "PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:$PATH docker compose version 2>/dev/null");
        return r.getExitCode() == 0;
    }

    private static final java.util.Map<String, java.util.Map<String, String>> INSTALL_MAP;
    static {
        INSTALL_MAP = new java.util.HashMap<>();
        INSTALL_MAP.put("pip", Map.of(
            "apt-get", "DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip",
            "yum",     "yum install -y python3-pip",
            "dnf",     "dnf install -y python3-pip",
            "apk",     "apk add --no-cache py3-pip",
            "brew",    "brew install python3",
            "pacman",  "pacman -Sy --noconfirm python-pip",
            "zypper",  "zypper install -y python3-pip"
        ));
        INSTALL_MAP.put("git", Map.of(
            "apt-get", "DEBIAN_FRONTEND=noninteractive apt-get install -y git",
            "yum",     "yum install -y git",
            "dnf",     "dnf install -y git",
            "apk",     "apk add --no-cache git",
            "brew",    "brew install git",
            "pacman",  "pacman -Sy --noconfirm git",
            "zypper",  "zypper install -y git"
        ));
        INSTALL_MAP.put("docker", Map.of(
            "apt-get", "curl -fsSL https://get.docker.com | sh && systemctl enable docker 2>/dev/null; systemctl start docker 2>/dev/null; true",
            "yum",     "curl -fsSL https://get.docker.com | sh && systemctl enable docker 2>/dev/null; systemctl start docker 2>/dev/null; true",
            "dnf",     "curl -fsSL https://get.docker.com | sh && systemctl enable docker 2>/dev/null; systemctl start docker 2>/dev/null; true",
            "apk",     "apk add --no-cache docker && rc-update add docker boot 2>/dev/null; service docker start 2>/dev/null; true",
            "brew",    "brew install --cask docker",
            "pacman",  "pacman -Sy --noconfirm docker && systemctl enable docker && systemctl start docker",
            "zypper",  "zypper install -y docker && systemctl enable docker && systemctl start docker"
        ));
        INSTALL_MAP.put("docker compose", Map.of(
            "apt-get", "DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin",
            "yum",     "yum install -y docker-compose-plugin",
            "dnf",     "dnf install -y docker-compose-plugin",
            "apk",     "apk add --no-cache docker-compose",
            "brew",    "brew install docker-compose",
            "pacman",  "pacman -Sy --noconfirm docker-compose",
            "zypper",  "zypper install -y docker-compose"
        ));
        INSTALL_MAP.put("node", Map.of(
            "apt-get", "DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs",
            "yum",     "yum install -y nodejs",
            "dnf",     "dnf install -y nodejs",
            "apk",     "apk add --no-cache nodejs",
            "brew",    "brew install node",
            "pacman",  "pacman -Sy --noconfirm nodejs",
            "zypper",  "zypper install -y nodejs"
        ));
        INSTALL_MAP.put("npm", Map.of(
            "apt-get", "DEBIAN_FRONTEND=noninteractive apt-get install -y npm",
            "yum",     "yum install -y npm",
            "dnf",     "dnf install -y npm",
            "apk",     "apk add --no-cache npm",
            "brew",    "brew install node",
            "pacman",  "pacman -Sy --noconfirm npm",
            "zypper",  "zypper install -y npm"
        ));
        INSTALL_MAP.put("java", Map.of(
            "apt-get", "DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-17-jdk",
            "yum",     "yum install -y java-17-openjdk-devel",
            "dnf",     "dnf install -y java-17-openjdk-devel",
            "apk",     "apk add --no-cache openjdk17",
            "brew",    "brew install openjdk",
            "pacman",  "pacman -Sy --noconfirm jdk17-openjdk",
            "zypper",  "zypper install -y java-17-openjdk"
        ));
        INSTALL_MAP.put("maven (mvn)", Map.of(
            "apt-get", "DEBIAN_FRONTEND=noninteractive apt-get install -y maven",
            "yum",     "yum install -y maven",
            "dnf",     "dnf install -y maven",
            "apk",     "apk add --no-cache maven",
            "brew",    "brew install maven",
            "pacman",  "pacman -Sy --noconfirm maven",
            "zypper",  "zypper install -y maven"
        ));
        INSTALL_MAP.put("python3", Map.of(
            "apt-get", "DEBIAN_FRONTEND=noninteractive apt-get install -y python3",
            "yum",     "yum install -y python3",
            "dnf",     "dnf install -y python3",
            "apk",     "apk add --no-cache python3",
            "brew",    "brew install python3",
            "pacman",  "pacman -Sy --noconfirm python",
            "zypper",  "zypper install -y python3"
        ));
    }

    /** Returns list of missing tool names for the given stack. Git is always checked. */
    private List<String> preflightCheck(Machine machine, String stack) {
        List<String> missing = new java.util.ArrayList<>();
        if (!commandExists(machine, "git")) missing.add("git");
        switch (stack) {
            case "compose" -> {
                if (!commandExists(machine, "docker")) missing.add("docker");
                if (!dockerComposeAvailable(machine)) missing.add("docker compose");
            }
            case "docker" -> { if (!commandExists(machine, "docker")) missing.add("docker"); }
            case "node"   -> {
                if (!commandExists(machine, "node")) missing.add("node");
                if (!commandExists(machine, "npm"))  missing.add("npm");
            }
            case "maven"  -> {
                if (!commandExists(machine, "java")) missing.add("java");
                if (!commandExists(machine, "mvn"))  missing.add("maven (mvn)");
            }
            case "gradle" -> { if (!commandExists(machine, "java")) missing.add("java"); }
            case "python" -> {
                if (!commandExists(machine, "python3")) missing.add("python3");
                if (!commandExists(machine, "pip3") && !commandExists(machine, "pip")) missing.add("pip");
            }
        }
        return missing;
    }

    private String detectPackageManager(Machine machine) {
        for (String pm : new String[]{"apt-get", "dnf", "yum", "apk", "brew", "pacman", "zypper"}) {
            if (commandExists(machine, pm)) return pm;
        }
        return "unknown";
    }

    /**
     * Check for missing deps and auto-install any that are absent.
     * Returns true if all deps are available after the attempt, false if any install failed.
     */
    private boolean preflightAndInstall(Machine machine, Deployment deployment, String stack) {
        List<String> missing = preflightCheck(machine, stack);
        if (missing.isEmpty()) return true;

        appendLog(deployment, "Missing dependencies: " + String.join(", ", missing) + ". Auto-installing...", LogLevel.INFO);

        String pkgManager = detectPackageManager(machine);
        if ("unknown".equals(pkgManager)) {
            appendLog(deployment, "Cannot auto-install: no supported package manager found (apt-get/yum/dnf/apk/brew). Install manually: " + String.join(", ", missing), LogLevel.ERROR);
            return false;
        }
        appendLog(deployment, "Package manager: " + pkgManager, LogLevel.INFO);

        boolean aptUpdated = false;
        for (String dep : missing) {
            if ("apt-get".equals(pkgManager) && !aptUpdated) {
                appendLog(deployment, "Running apt-get update...", LogLevel.INFO);
                sshService.execute(machine, "apt-get update -qq 2>&1");
                aptUpdated = true;
            }
            var cmds = INSTALL_MAP.get(dep);
            if (cmds == null || !cmds.containsKey(pkgManager)) {
                appendLog(deployment, "No installer for '" + dep + "' on " + pkgManager + " — install manually.", LogLevel.WARN);
                continue;
            }
            appendLog(deployment, "Installing " + dep + "...", LogLevel.INFO);
            var result = sshService.execute(machine, cmds.get(pkgManager));
            if (!result.getStdout().isBlank()) appendLog(deployment, result.getStdout(), LogLevel.INFO);
            if (result.getExitCode() != 0) {
                appendLog(deployment, "Failed to install " + dep + ": " + result.getStderr(), LogLevel.ERROR);
                return false;
            }
            appendLog(deployment, dep + " installed.", LogLevel.INFO);
        }

        List<String> stillMissing = preflightCheck(machine, stack);
        if (!stillMissing.isEmpty()) {
            appendLog(deployment, "Post-install check failed — still missing: " + String.join(", ", stillMissing), LogLevel.ERROR);
            return false;
        }
        appendLog(deployment, "All dependencies ready.", LogLevel.INFO);
        return true;
    }

    private void teardownPreviousDeployment(Deployment current, Machine machine) {
        try {
            var prev = current.getRepositoryUrl() != null
                    ? deploymentRepository.findTopByRepositoryUrlAndMachine_IdAndTypeAndStatusAndIdNotOrderByCreatedAtDesc(
                            current.getRepositoryUrl(), machine.getId(), current.getType(),
                            DeploymentStatus.SUCCESS, current.getId())
                    : deploymentRepository.findTopByMachine_IdAndTypeAndStatusAndIdNotOrderByCreatedAtDesc(
                            machine.getId(), current.getType(), DeploymentStatus.SUCCESS, current.getId());

            if (prev.isEmpty()) return;
            String prevDir = prev.get().getDeployDir();
            if (prevDir == null || prevDir.isBlank()) return;

            appendLog(current, "Tearing down previous deployment from " + prevDir, LogLevel.INFO);
            var result = sshService.execute(machine,
                    "cd " + sq(prevDir) + " && docker compose down --remove-orphans 2>&1");
            if (result.getExitCode() != 0) {
                appendLog(current, "Teardown warning: " + result.getStdout() + result.getStderr(), LogLevel.WARN);
            } else {
                appendLog(current, "Previous deployment torn down.", LogLevel.INFO);
            }
        } catch (Exception e) {
            appendLog(current, "Teardown failed (non-fatal): " + e.getMessage(), LogLevel.WARN);
        }
    }

    /** Strip embedded GitHub tokens from git output before logging. */
    private static String sanitizeGitOutput(String s) {
        if (s == null) return "";
        return s.replaceAll("https://[^@]+@github\\.com/", "https://github.com/");
    }

    private String getBuildCommand(String stack, String repoDir, boolean isWindows, String composeFile) {
        String cd = isWindows ? "cd /d \"" + repoDir + "\" && " : "cd " + repoDir + " && ";
        String composeFlag = composeFile != null ? "-f " + sq(composeFile) + " " : "";
        return switch (stack) {
            case "compose" -> cd + "docker compose " + composeFlag + "up --build -d 2>&1";
            case "docker" -> cd + "docker build -t app_" + System.currentTimeMillis() + " .";
            case "node"   -> cd + "npm ci && npm run build";
            case "maven"  -> cd + "mvn clean package -DskipTests";
            case "gradle" -> cd + (isWindows ? "gradlew.bat" : "./gradlew") + " build -x test";
            case "python" -> cd + "pip install -r requirements.txt";
            default -> "";
        };
    }

    private void fixDockerCredentials(Deployment deployment, Machine machine, boolean isWindows) {
        try {
            String cmd = isWindows
                    ? "powershell -NoProfile -NonInteractive -Command " +
                      "\"$f=[IO.Path]::Combine($env:USERPROFILE,'.docker','config.json');" +
                      "if(Test-Path $f){$c=Get-Content $f -Raw|ConvertFrom-Json;" +
                      "if($c.PSObject.Properties['credsStore']){$c.PSObject.Properties.Remove('credsStore');" +
                      "$c|ConvertTo-Json -Depth 10|Set-Content $f -Encoding UTF8}}\""
                    : "python3 -c 'import json,os; p=os.path.join(os.path.expanduser(\"~\"),\".docker\",\"config.json\"); " +
                      "d=json.load(open(p)) if os.path.exists(p) else {}; " +
                      "d.pop(\"credsStore\",None); open(p,\"w\").write(json.dumps(d,indent=2))' 2>/dev/null; true";
            sshService.execute(machine, cmd);
            appendLog(deployment, "Docker credential store configured", LogLevel.INFO);
        } catch (Exception e) {
            log.debug("Docker credentials pre-flight skipped: {}", e.getMessage());
        }
    }

    public DeploymentResponse toResponse(Deployment d) {
        return DeploymentResponse.builder()
                .id(d.getId())
                .name(d.getName())
                .type(d.getType().name())
                .status(d.getStatus().name())
                .repositoryUrl(d.getRepositoryUrl())
                .branch(d.getBranch())
                .logs(d.getLogs())
                .version(d.getVersion())
                .detectedStack(d.getDetectedStack())
                .applicationServices(d.getApplicationServices())
                .applicationConfigs(d.getApplicationConfigs())
                .tunnelName(d.getTunnelName())
                .tunnelHostname(d.getTunnelHostname())
                .cloudfareTunnelId(d.getCloudfareTunnelId())
                .cloudfareTunnelUrl(d.getCloudfareTunnelUrl())
                .deployDir(d.getDeployDir())
                .resolvedCommitSha(d.getResolvedCommitSha())
                .webhookUrl(d.getWebhookUrl())
                .machineId(d.getMachine() != null ? d.getMachine().getId() : null)
                .machineName(d.getMachine() != null ? d.getMachine().getName() : null)
                .ownerId(d.getOwner().getId())
                .startedAt(d.getStartedAt())
                .finishedAt(d.getFinishedAt())
                .createdAt(d.getCreatedAt())
                .build();
    }
}
