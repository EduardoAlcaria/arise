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

            var result = sshService.execute(machine, command);
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

    public void rerunWorkflow(Long userId, String owner, String repo, Long runId) {
        User user = getUser(userId);
        webClientBuilder.build()
                .post()
                .uri("https://api.github.com/repos/{owner}/{repo}/actions/runs/{runId}/rerun", owner, repo, runId)
                .header("Authorization", "token " + user.getGithubToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .bodyToMono(Map.class)
                .block();
    }

    public void triggerWorkflow(Long userId, String owner, String repo, String workflowId, String ref) {
        User user = getUser(userId);
        webClientBuilder.build()
                .post()
                .uri("https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflowId}/dispatches",
                        owner, repo, workflowId)
                .header("Authorization", "token " + user.getGithubToken())
                .header("Accept", "application/vnd.github+json")
                .bodyValue(Map.of("ref", ref))
                .retrieve()
                .bodyToMono(Map.class)
                .block();
    }

    public List<Map<String, Object>> getWorkflowJobs(Long userId, String owner, String repo, Long runId) {
        User user = getUser(userId);
        @SuppressWarnings("unchecked")
        Map<String, Object> response = webClientBuilder.build()
                .get()
                .uri("https://api.github.com/repos/{owner}/{repo}/actions/runs/{runId}/jobs", owner, repo, runId)
                .header("Authorization", "token " + user.getGithubToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .bodyToMono(Map.class)
                .block();
        if (response == null) return List.of();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> jobs = (List<Map<String, Object>>) response.get("jobs");
        if (jobs == null) return List.of();
        return jobs.stream().map(job -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", job.get("id"));
            item.put("name", job.get("name"));
            item.put("status", job.get("status"));
            item.put("conclusion", job.get("conclusion"));
            item.put("startedAt", job.get("started_at"));
            item.put("completedAt", job.get("completed_at"));
            item.put("htmlUrl", job.get("html_url"));
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> steps = (List<Map<String, Object>>) job.get("steps");
            if (steps != null) {
                item.put("steps", steps.stream().map(s -> Map.of(
                        "name", s.getOrDefault("name", ""),
                        "status", s.getOrDefault("status", ""),
                        "conclusion", s.getOrDefault("conclusion", ""),
                        "number", s.getOrDefault("number", 0)
                )).toList());
            }
            return item;
        }).toList();
    }

    public List<Map<String, Object>> listRunners(Long userId, String owner, String repo) {
        User user = getUser(userId);
        @SuppressWarnings("unchecked")
        Map<String, Object> response = webClientBuilder.build()
                .get()
                .uri("https://api.github.com/repos/{owner}/{repo}/actions/runners", owner, repo)
                .header("Authorization", "token " + user.getGithubToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .bodyToMono(Map.class)
                .block();
        if (response == null) return List.of();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> runners = (List<Map<String, Object>>) response.get("runners");
        if (runners == null) return List.of();
        return runners.stream().map(r -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", r.get("id"));
            item.put("name", r.get("name"));
            item.put("status", r.get("status"));
            item.put("busy", r.get("busy"));
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> labels = (List<Map<String, Object>>) r.get("labels");
            item.put("labels", labels != null ? labels.stream().map(l -> l.get("name")).toList() : List.of());
            return item;
        }).toList();
    }

    public void deleteRunner(Long userId, String owner, String repo, Long runnerId) {
        User user = getUser(userId);
        webClientBuilder.build()
                .delete()
                .uri("https://api.github.com/repos/{owner}/{repo}/actions/runners/{runnerId}", owner, repo, runnerId)
                .header("Authorization", "token " + user.getGithubToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .bodyToMono(Void.class)
                .block();
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
