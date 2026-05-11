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
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class DeploymentService {

    private final DeploymentRepository deploymentRepository;
    private final UserRepository userRepository;
    private final MachineService machineService;
    private final SshService sshService;
    private final LogService logService;
    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;
    private final CloudflareService cloudflareService;

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

        Deployment deployment = deploymentRepository.save(builder.build());
        executeAsync(deployment.getId());
        return toResponse(deployment);
    }

    @Async
    public void executeAsync(Long deploymentId) {
        Deployment deployment = deploymentRepository.findById(deploymentId)
                .orElseThrow(() -> new ResourceNotFoundException("Deployment not found: " + deploymentId));
        Machine machine = deployment.getMachine();
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
                    ? "rmdir /s /q \"" + repoDir + "\" 2>nul & git clone " + cloneUrl + " -b " + deployment.getBranch() + " \"" + repoDir + "\""
                    : "rm -rf " + repoDir + " && git clone " + cloneUrl + " -b " + deployment.getBranch() + " " + repoDir;
            appendLog(deployment, "Cloning repository: " + deployment.getRepositoryUrl(), LogLevel.INFO);
            var cloneResult = sshService.execute(machine, cloneCmd);
            appendLog(deployment, cloneResult.getStdout(), LogLevel.INFO);
            if (cloneResult.getExitCode() != 0) {
                appendLog(deployment, "Clone failed: " + cloneResult.getStderr(), LogLevel.ERROR);
                fail(deployment);
                return;
            }

            deployment.setDeployDir(repoDir);
            deploymentRepository.save(deployment);

            if (!isWindows) {
                var shaResult = sshService.execute(machine, "cd " + repoDir + " && git rev-parse HEAD 2>/dev/null || echo ''");
                if (shaResult.getExitCode() == 0 && !shaResult.getStdout().isBlank()) {
                    deployment.setResolvedCommitSha(shaResult.getStdout().trim());
                    deploymentRepository.save(deployment);
                }
            }

            // Detect stack
            String stack = detectStack(machine, repoDir, isWindows);
            deployment.setDetectedStack(stack);
            appendLog(deployment, "Detected stack: " + stack, LogLevel.INFO);

            deployment.setStatus(DeploymentStatus.DEPLOYING);
            deploymentRepository.save(deployment);

            // Stack-specific build step
            String buildCmd = getBuildCommand(stack, repoDir, isWindows);
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
                    String cfCmd = "docker rm -f cloudflared_" + deploymentId + " 2>/dev/null || true" +
                            " && docker run -d --name cloudflared_" + deploymentId +
                            " --network host cloudflare/cloudflared:latest tunnel run --token " + tunnelToken;
                    sshService.execute(machine, cfCmd);
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

            String baseDir = "/apps/" + deployment.getId();
            var mkdirResult = sshService.execute(machine, "mkdir -p " + baseDir);
            if (mkdirResult.getExitCode() != 0) {
                appendLog(deployment, "Failed to create app dir: " + mkdirResult.getStderr(), LogLevel.ERROR);
                fail(deployment);
                return;
            }

            deployment.setDeployDir(baseDir);
            deploymentRepository.save(deployment);

            for (AppServiceDto service : services) {
                String serviceDir = baseDir + "/" + service.getName();
                String repoUrl = service.getRepoUrl();
                if (ownerGithubToken != null && !ownerGithubToken.isBlank()
                        && repoUrl != null && repoUrl.startsWith("https://github.com/")) {
                    repoUrl = repoUrl.replace("https://github.com/", "https://" + ownerGithubToken + "@github.com/");
                }
                String branch = service.getBranch() != null ? service.getBranch() : "main";
                String cloneCmd = "rm -rf " + serviceDir + " && git clone " + repoUrl + " -b " + branch + " " + serviceDir;
                appendLog(deployment, "Cloning service " + service.getName(), LogLevel.INFO);
                var cloneResult = sshService.execute(machine, cloneCmd);
                appendLog(deployment, cloneResult.getStdout(), LogLevel.INFO);
                if (cloneResult.getExitCode() != 0) {
                    appendLog(deployment, "Clone failed for " + service.getName() + ": " + cloneResult.getStderr(), LogLevel.ERROR);
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

            String composeCmd = "cd " + baseDir + " && docker compose up --build -d 2>&1";
            appendLog(deployment, "Running docker compose up --build -d", LogLevel.INFO);
            var composeResult = sshService.execute(machine, composeCmd);
            appendLog(deployment, composeResult.getStdout(), LogLevel.INFO);
            if (composeResult.getExitCode() != 0) {
                appendLog(deployment, "docker compose failed: " + composeResult.getStderr(), LogLevel.ERROR);
                fail(deployment);
                return;
            }

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
                    String cfCmd = "docker rm -f cloudflared_" + deployment.getId() + " 2>/dev/null || true" +
                            " && docker run -d --name cloudflared_" + deployment.getId() +
                            " --network host cloudflare/cloudflared:latest" +
                            " tunnel run --token " + tunnelToken;
                    sshService.execute(machine, cfCmd);
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
            String cfCmd = "docker rm -f cloudflared_" + deploymentId + " 2>/dev/null || true" +
                    " && docker run -d --name cloudflared_" + deploymentId +
                    " --network host cloudflare/cloudflared:latest tunnel run --token " + tunnelToken;
            sshService.execute(machine, cfCmd);
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
    }

    private void appendLog(Deployment deployment, String message, LogLevel level) {
        if (message == null || message.isBlank()) return;
        logService.save(deployment.getId(), message, level);
        String existing = deployment.getLogs() == null ? "" : deployment.getLogs();
        deployment.setLogs(existing + "\n" + message);
        deploymentRepository.save(deployment);
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

    private String getBuildCommand(String stack, String repoDir, boolean isWindows) {
        String cd = isWindows ? "cd /d \"" + repoDir + "\" && " : "cd " + repoDir + " && ";
        return switch (stack) {
            case "compose" -> cd + "docker compose up --build -d 2>&1";
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
                .machineId(d.getMachine() != null ? d.getMachine().getId() : null)
                .machineName(d.getMachine() != null ? d.getMachine().getName() : null)
                .ownerId(d.getOwner().getId())
                .startedAt(d.getStartedAt())
                .finishedAt(d.getFinishedAt())
                .createdAt(d.getCreatedAt())
                .build();
    }
}
