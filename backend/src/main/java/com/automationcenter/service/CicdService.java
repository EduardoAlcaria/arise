package com.automationcenter.service;

import com.automationcenter.entity.Machine;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kohsuke.github.GitHub;
import org.kohsuke.github.GitHubBuilder;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@Service
@RequiredArgsConstructor
@Slf4j
public class CicdService {

    private final GitHubService gitHubService;
    private final MachineService machineService;
    private final SshService sshService;
    private final UserRepository userRepository;
    private final WebClient.Builder webClientBuilder;

    public List<String> detectWorkflows(Long userId, String owner, String repo) {
        try {
            String branch = getDefaultBranch(userId, owner, repo);
            return gitHubService.getTree(userId, owner, repo, branch)
                    .stream()
                    .filter(item -> item.getPath().startsWith(".github/workflows/")
                            && "blob".equals(item.getType())
                            && (item.getPath().endsWith(".yml") || item.getPath().endsWith(".yaml")))
                    .map(item -> item.getPath().substring(".github/workflows/".length()))
                    .toList();
        } catch (Exception e) {
            log.error("Could not detect workflows for {}/{}: {}", owner, repo, e.getMessage());
            return List.of();
        }
    }

    @Async
    public CompletableFuture<String> setupRunner(Long userId, Long machineId, String owner, String repo) {
        StringBuilder output = new StringBuilder();
        try {
            Map<String, String> tokenData = gitHubService.getRunnerRegistrationToken(userId, owner, repo);
            String token = tokenData.get("token");
            if (token == null || token.isBlank()) {
                return CompletableFuture.completedFuture("ERROR: Could not obtain runner registration token");
            }

            Machine machine = machineService.findByIdAndOwner(machineId, userId);
            String machineName = machine.getName().replaceAll("[^A-Za-z0-9_-]", "-");

            String command = String.join(" && ",
                    "mkdir -p /opt/actions-runner/" + owner + "-" + repo,
                    "cd /opt/actions-runner/" + owner + "-" + repo,
                    "curl -sL https://github.com/actions/runner/releases/download/v2.322.0/actions-runner-linux-x64-2.322.0.tar.gz | tar xz",
                    "./config.sh --url https://github.com/" + owner + "/" + repo
                            + " --token " + token
                            + " --unattended"
                            + " --name " + machineName
                            + " --labels self-hosted,Linux,X64," + machineName
                            + " --replace",
                    "sudo ./svc.sh install",
                    "sudo ./svc.sh start"
            );

            var result = sshService.execute(
                    machine.getHost(), machine.getPort(), machine.getSshUser(), machine.getPrivateKey(), command);
            output.append("STDOUT:\n").append(result.getStdout());
            if (result.getStderr() != null && !result.getStderr().isBlank()) {
                output.append("\nSTDERR:\n").append(result.getStderr());
            }
            output.append("\nExit code: ").append(result.getExitCode());
        } catch (Exception e) {
            log.error("Runner setup failed for {}/{}: {}", owner, repo, e.getMessage());
            output.append("ERROR: ").append(e.getMessage());
        }
        return CompletableFuture.completedFuture(output.toString());
    }

    public List<Map<String, Object>> getWorkflowRuns(Long userId, String owner, String repo) {
        User user = getUser(userId);
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> response = webClientBuilder.build()
                    .get()
                    .uri("https://api.github.com/repos/{owner}/{repo}/actions/runs?per_page=30", owner, repo)
                    .header("Authorization", "token " + user.getGithubToken())
                    .header("Accept", "application/vnd.github+json")
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

            if (response == null) return List.of();

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> runs = (List<Map<String, Object>>) response.get("workflow_runs");
            if (runs == null) return List.of();

            return runs.stream().map(run -> {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", run.get("id"));
                item.put("name", run.get("name"));
                item.put("status", run.get("status"));
                item.put("conclusion", run.get("conclusion"));
                item.put("createdAt", run.get("created_at"));
                item.put("updatedAt", run.get("updated_at"));
                item.put("headBranch", run.get("head_branch"));
                item.put("event", run.get("event"));
                return item;
            }).toList();
        } catch (Exception e) {
            log.error("Could not fetch workflow runs for {}/{}: {}", owner, repo, e.getMessage());
            return List.of();
        }
    }

    private String getDefaultBranch(Long userId, String owner, String repo) {
        User user = getUser(userId);
        try {
            GitHub github = new GitHubBuilder().withOAuthToken(user.getGithubToken()).build();
            return github.getRepository(owner + "/" + repo).getDefaultBranch();
        } catch (Exception e) {
            log.warn("Could not get default branch for {}/{}, falling back to 'main': {}", owner, repo, e.getMessage());
            return "main";
        }
    }

    private User getUser(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getGithubToken() == null || user.getGithubToken().isBlank()) {
            throw new IllegalArgumentException("GitHub token not configured. Please save a token first.");
        }
        return user;
    }
}
