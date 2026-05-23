package com.automationcenter.service;

import com.automationcenter.entity.Machine;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.util.Base64;
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

    @SuppressWarnings("unchecked")
    public List<String> detectWorkflows(Long userId, String owner, String repo) {
        User user = getUser(userId);
        try {
            // Use the Contents API directly — more reliable than full-tree scan
            List<Map<String, Object>> items = webClientBuilder.build()
                    .get()
                    .uri("https://api.github.com/repos/{owner}/{repo}/contents/.github/workflows",
                            owner, repo)
                    .header("Authorization", "token " + user.getGithubToken())
                    .header("Accept", "application/vnd.github+json")
                    .retrieve()
                    .bodyToMono(List.class)
                    .block();

            if (items == null) return List.of();
            return items.stream()
                    .filter(item -> "file".equals(item.get("type")))
                    .map(item -> (String) item.get("name"))
                    .filter(name -> name != null && (name.endsWith(".yml") || name.endsWith(".yaml")))
                    .toList();
        } catch (WebClientResponseException e) {
            if (e.getStatusCode().value() == 404) {
                log.debug("No .github/workflows/ directory in {}/{}", owner, repo);
            } else {
                log.error("Could not detect workflows for {}/{}: HTTP {}", owner, repo, e.getStatusCode().value());
            }
            return List.of();
        } catch (Exception e) {
            log.error("Could not detect workflows for {}/{}: {}", owner, repo, e.getMessage());
            return List.of();
        }
    }

    private String fetchLatestRunnerVersion() {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> release = webClientBuilder.build()
                    .get()
                    .uri("https://api.github.com/repos/actions/runner/releases/latest")
                    .header("Accept", "application/vnd.github+json")
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();
            if (release != null) {
                String tag = (String) release.get("tag_name"); // e.g. "v2.317.0"
                if (tag != null && tag.startsWith("v")) return tag.substring(1);
            }
        } catch (Exception e) {
            log.warn("Could not fetch latest runner version, using fallback: {}", e.getMessage());
        }
        return "2.317.0";
    }

    @Async
    public CompletableFuture<String> setupRunner(Long userId, Long machineId, String owner, String repo) {
        StringBuilder output = new StringBuilder();
        try {
            Map<String, String> tokenData = gitHubService.getRunnerRegistrationToken(userId, owner, repo);
            String token = tokenData.get("token");
            if (token == null || token.isBlank()) {
                return CompletableFuture.completedFuture("ERROR: Could not obtain runner registration token. " +
                        "Ensure your GitHub token has 'repo' scope and you have admin access to the repository.");
            }

            Machine machine = machineService.findByIdAndOwner(machineId, userId);
            String machineName = machine.getName().replaceAll("[^A-Za-z0-9_-]", "-");
            String version = fetchLatestRunnerVersion();

            // Detect OS and architecture
            var osResult = sshService.execute(machine, "uname -s");
            var archResult = sshService.execute(machine, "uname -m");
            String os = osResult.getStdout().trim().toLowerCase();
            String arch = archResult.getStdout().trim().toLowerCase();

            String platform;
            String archLabel;
            if (os.contains("darwin")) {
                platform = arch.contains("arm") || arch.contains("aarch64") ? "osx-arm64" : "osx-x64";
                archLabel = arch.contains("arm") || arch.contains("aarch64") ? "ARM64" : "X64";
            } else {
                platform = arch.contains("arm") || arch.contains("aarch64") ? "linux-arm64" : "linux-x64";
                archLabel = arch.contains("arm") || arch.contains("aarch64") ? "ARM64" : "X64";
            }
            String osLabel = os.contains("darwin") ? "macOS" : "Linux";
            String runnerDir = (os.contains("darwin") ? "/Users/" + machine.getSshUser() : "/opt")
                    + "/actions-runner/" + owner + "-" + repo;

            String tarFile = "actions-runner-" + platform + "-" + version + ".tar.gz";
            String downloadUrl = "https://github.com/actions/runner/releases/download/v" + version + "/" + tarFile;

            String svcInstall = os.contains("darwin") ? "./svc.sh install" : "sudo ./svc.sh install";
            String svcStart   = os.contains("darwin") ? "./svc.sh start"   : "sudo ./svc.sh start";

            String command = String.join(" && ",
                    "mkdir -p " + runnerDir,
                    "cd " + runnerDir,
                    "curl -fsSL " + downloadUrl + " | tar xz",
                    "./config.sh --url https://github.com/" + owner + "/" + repo
                            + " --token " + token
                            + " --unattended"
                            + " --name " + machineName
                            + " --labels self-hosted," + osLabel + "," + archLabel + "," + machineName
                            + " --replace",
                    svcInstall,
                    svcStart
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
        try {
            webClientBuilder.build()
                    .post()
                    .uri("https://api.github.com/repos/{owner}/{repo}/actions/runs/{runId}/rerun", owner, repo, runId)
                    .header("Authorization", "token " + user.getGithubToken())
                    .header("Accept", "application/vnd.github+json")
                    .retrieve()
                    .bodyToMono(Void.class)
                    .block();
        } catch (WebClientResponseException e) {
            throw new IllegalArgumentException("GitHub API error " + e.getStatusCode().value() + ": " + e.getResponseBodyAsString());
        }
    }

    public void triggerWorkflow(Long userId, String owner, String repo, String workflowId, String ref) {
        User user = getUser(userId);
        try {
            webClientBuilder.build()
                    .post()
                    .uri("https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflowId}/dispatches",
                            owner, repo, workflowId)
                    .header("Authorization", "token " + user.getGithubToken())
                    .header("Accept", "application/vnd.github+json")
                    .bodyValue(Map.of("ref", ref))
                    .retrieve()
                    .bodyToMono(Void.class)
                    .block();
        } catch (WebClientResponseException e) {
            String msg = e.getStatusCode().value() == 422
                    ? "Workflow '" + workflowId + "' does not have 'on: workflow_dispatch' trigger. Add it to enable manual runs."
                    : "GitHub API error " + e.getStatusCode().value() + ": " + e.getResponseBodyAsString();
            throw new IllegalArgumentException(msg);
        }
    }

    @SuppressWarnings("unchecked")
    public void triggerByPush(Long userId, String owner, String repo, String ref) {
        User user = getUser(userId);
        String path = ".arise/deploy-trigger";
        String content = Base64.getEncoder().encodeToString(
                ("Triggered by Arise at " + java.time.Instant.now()).getBytes()
        );

        // Get current file SHA if it already exists (required for updates)
        String existingSha = null;
        try {
            Map<String, Object> existing = webClientBuilder.build()
                    .get()
                    .uri("https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={ref}",
                            owner, repo, path, ref)
                    .header("Authorization", "token " + user.getGithubToken())
                    .header("Accept", "application/vnd.github+json")
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();
            if (existing != null) existingSha = (String) existing.get("sha");
        } catch (WebClientResponseException e) {
            if (e.getStatusCode().value() != 404) {
                throw new IllegalArgumentException("GitHub API error " + e.getStatusCode().value()
                        + " checking trigger file: " + e.getResponseBodyAsString());
            }
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("message", "chore: trigger deployment via Arise");
        body.put("content", content);
        body.put("branch", ref);
        if (existingSha != null) body.put("sha", existingSha);

        try {
            webClientBuilder.build()
                    .put()
                    .uri("https://api.github.com/repos/{owner}/{repo}/contents/{path}", owner, repo, path)
                    .header("Authorization", "token " + user.getGithubToken())
                    .header("Accept", "application/vnd.github+json")
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(Void.class)
                    .block();
        } catch (WebClientResponseException e) {
            throw new IllegalArgumentException("Failed to push trigger commit: HTTP " + e.getStatusCode().value()
                    + " — " + e.getResponseBodyAsString());
        }
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

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> listAllRunners(Long userId) {
        User user = getUser(userId);
        try {
            List<Map<String, Object>> repoList = webClientBuilder.build()
                    .get()
                    .uri("https://api.github.com/user/repos?per_page=100&type=owner")
                    .header("Authorization", "token " + user.getGithubToken())
                    .header("Accept", "application/vnd.github+json")
                    .retrieve()
                    .bodyToFlux(Map.class)
                    .collectList()
                    .block();

            if (repoList == null || repoList.isEmpty()) return List.of();

            Map<Long, Map<String, Object>> byId = new java.util.concurrent.ConcurrentHashMap<>();
            repoList.parallelStream().forEach(ghRepo -> {
                try {
                    String fullName = (String) ghRepo.get("full_name");
                    if (fullName == null) return;
                    String[] parts = fullName.split("/");
                    if (parts.length != 2) return;
                    List<Map<String, Object>> runners = listRunners(userId, parts[0], parts[1]);
                    for (Map<String, Object> r : runners) {
                        Object id = r.get("id");
                        if (id instanceof Number n) {
                            Map<String, Object> enriched = new java.util.HashMap<>(r);
                            enriched.put("repo", fullName);
                            byId.put(n.longValue(), enriched);
                        }
                    }
                } catch (Exception e) {
                    log.warn("Could not list runners for {}: {}", ghRepo.get("full_name"), e.getMessage());
                }
            });

            return new java.util.ArrayList<>(byId.values());
        } catch (Exception e) {
            log.warn("Could not list all runners: {}", e.getMessage());
            return List.of();
        }
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

    private User getUser(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getGithubToken() == null || user.getGithubToken().isBlank()) {
            throw new IllegalArgumentException("GitHub token not configured. Please save a token first.");
        }
        return user;
    }
}
