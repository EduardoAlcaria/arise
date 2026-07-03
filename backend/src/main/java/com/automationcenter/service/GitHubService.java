package com.automationcenter.service;

import com.automationcenter.dto.github.AriseConfig;
import com.automationcenter.dto.github.GitHubBranchResponse;
import com.automationcenter.dto.github.GitHubRepoResponse;
import com.automationcenter.dto.github.GitHubTreeItem;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kohsuke.github.GHRepository;
import org.kohsuke.github.GitHub;
import org.kohsuke.github.GitHubBuilder;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class GitHubService {

    private final UserRepository userRepository;
    private final WebClient.Builder webClientBuilder;

    public void saveToken(Long userId, String token) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        user.setGithubToken(token);
        userRepository.save(user);
    }

    public Map<String, String> getConnectedUser(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getGithubToken() == null || user.getGithubToken().isBlank()) return null;
        try {
            GitHub github = new GitHubBuilder().withOAuthToken(user.getGithubToken()).build();
            var myself = github.getMyself();
            return Map.of("login", myself.getLogin(), "avatar_url", myself.getAvatarUrl());
        } catch (IOException e) {
            return null;
        }
    }

    public List<GitHubRepoResponse> listRepos(Long userId) {
        User user = getUser(userId);
        try {
            GitHub github = new GitHubBuilder().withOAuthToken(user.getGithubToken()).build();
            return github.getMyself().listRepositories().toList().stream()
                    .map(repo -> {
                        try {
                            String updatedAt = repo.getUpdatedAt() != null
                                    ? repo.getUpdatedAt().toInstant().toString() : null;
                            String pushedAt = repo.getPushedAt() != null
                                    ? repo.getPushedAt().toInstant().toString() : null;
                            return new GitHubRepoResponse(
                                    repo.getName(),
                                    repo.getFullName(),
                                    repo.getDescription(),
                                    repo.getHtmlUrl().toString(),
                                    repo.isPrivate(),
                                    repo.getDefaultBranch(),
                                    repo.getLanguage(),
                                    repo.getStargazersCount(),
                                    updatedAt,
                                    pushedAt
                            );
                        } catch (IOException e) {
                            return new GitHubRepoResponse(
                                    repo.getName(),
                                    repo.getFullName(),
                                    repo.getDescription(),
                                    repo.getHtmlUrl().toString(),
                                    repo.isPrivate(),
                                    repo.getDefaultBranch(),
                                    null,
                                    0,
                                    null,
                                    null
                            );
                        }
                    })
                    .toList();
        } catch (IOException e) {
            throw new RuntimeException("GitHub API error: " + e.getMessage(), e);
        }
    }

    public List<GitHubBranchResponse> listBranches(Long userId, String owner, String repo) {
        User user = getUser(userId);
        try {
            GitHub github = new GitHubBuilder().withOAuthToken(user.getGithubToken()).build();
            GHRepository ghRepo = github.getRepository(owner + "/" + repo);
            Map<String, org.kohsuke.github.GHBranch> branches = ghRepo.getBranches();
            return branches.values().stream()
                    .map(b -> new GitHubBranchResponse(b.getName(), b.getSHA1()))
                    .toList();
        } catch (IOException e) {
            throw new RuntimeException("GitHub API error: " + e.getMessage(), e);
        }
    }

    public String getReadme(Long userId, String owner, String repo) {
        User user = getUser(userId);
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> response = webClientBuilder.build()
                    .get()
                    .uri("https://api.github.com/repos/{owner}/{repo}/readme", owner, repo)
                    .header("Authorization", "token " + user.getGithubToken())
                    .header("Accept", "application/vnd.github+json")
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

            if (response == null) return "";
            Object contentObj = response.get("content");
            if (contentObj == null) return "";
            String b64 = ((String) contentObj).replaceAll("\\s", "");
            return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.warn("Could not fetch README for {}/{}: {}", owner, repo, e.getMessage());
            return "";
        }
    }

    public List<GitHubTreeItem> getTree(Long userId, String owner, String repo, String branch) {
        User user = getUser(userId);
        try {
            GitHub github = new GitHubBuilder().withOAuthToken(user.getGithubToken()).build();
            GHRepository ghRepo = github.getRepository(owner + "/" + repo);
            return ghRepo.getTreeRecursive(branch, 1).getTree().stream()
                    .filter(entry -> !entry.getPath().contains("node_modules") && !entry.getPath().contains(".git"))
                    .map(entry -> new GitHubTreeItem(entry.getPath(), entry.getType(), entry.getSize()))
                    .toList();
        } catch (IOException e) {
            log.warn("Could not fetch tree for {}/{}: {}", owner, repo, e.getMessage());
            return List.of();
        }
    }

    public String getFileContent(Long userId, String owner, String repo, String path, String branch) {
        User user = getUser(userId);
        try {
            @SuppressWarnings("unchecked")
            Optional<Map<String, Object>> response = Optional.ofNullable((Map<String, Object>) webClientBuilder.build()
                    .get()
                    .uri(uriBuilder -> uriBuilder
                            .scheme("https").host("api.github.com")
                            .path("/repos/{owner}/{repo}/contents/{path}")
                            .queryParam("ref", branch)
                            .build(owner, repo, path))
                    .header("Authorization", "token " + user.getGithubToken())
                    .header("Accept", "application/vnd.github+json")
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block()
                    .get("content"));

            String b64 = ((String) response).replaceAll("\\s", "");
            return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.warn("Could not fetch file {}/{}/{}: {}", owner, repo, path, e.getMessage());
            return "";
        }
    }

    public List<String> getEnvVarKeys(Long userId, String owner, String repo, String branch) {
        User user = getUser(userId);
        try {
            GitHub github = new GitHubBuilder().withOAuthToken(user.getGithubToken()).build();
            GHRepository ghRepo = github.getRepository(owner + "/" + repo);

            String content = null;
            for (String filename : List.of(".env.example", ".env.sample", ".env.template")) {
                try {
                    var file = ghRepo.getFileContent(filename, branch);
                    if (file != null) {
                        String b64 = file.getContent().replaceAll("\\s", "");
                        content = new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
                        break;
                    }
                } catch (Exception ignored) {
                    // try next file
                }
            }

            if (content == null) return List.of();

            List<String> keys = new ArrayList<>();
            for (String line : content.split("\\r?\\n")) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) continue;
                // Match KEY= or # KEY= patterns but not pure comments
                String toMatch = trimmed.startsWith("#") ? trimmed.substring(1).trim() : trimmed;
                int eqIndex = toMatch.indexOf('=');
                if (eqIndex > 0) {
                    String key = toMatch.substring(0, eqIndex).trim();
                    if (key.matches("[A-Za-z_][A-Za-z0-9_]*")) {
                        keys.add(key);
                    }
                }
            }
            return keys;
        } catch (Exception e) {
            log.warn("Could not fetch env var keys for {}/{}: {}", owner, repo, e.getMessage());
            return List.of();
        }
    }

    public AriseConfig getAriseConfig(Long userId, String owner, String repo, String branch) {
        String content = getFileContent(userId, owner, repo, ".arise.yml", branch);
        if (content == null || content.isBlank()) return null;
        try {
            org.yaml.snakeyaml.Yaml yaml = new org.yaml.snakeyaml.Yaml();
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> data = yaml.load(content);
            if (data == null) return null;
            String compose = data.get("compose") instanceof String s ? s : null;
            Integer port = data.get("port") instanceof Number n ? n.intValue() : null;
            @SuppressWarnings("unchecked")
            java.util.List<String> env = data.get("env") instanceof java.util.List<?> l
                    ? l.stream().map(Object::toString).toList() : List.of();
            String name = data.get("name") instanceof String s ? s : null;
            String br = data.get("branch") instanceof String s ? s : null;
            return new AriseConfig(compose, port, env, name, br);
        } catch (Exception e) {
            log.warn("Could not parse .arise.yml for {}/{}: {}", owner, repo, e.getMessage());
            return null;
        }
    }

    public Map<String, String> getRunnerRegistrationToken(Long userId, String owner, String repo) {
        User user = getUser(userId);
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> response = webClientBuilder.build()
                    .post()
                    .uri("https://api.github.com/repos/{owner}/{repo}/actions/runners/registration-token", owner, repo)
                    .header("Authorization", "token " + user.getGithubToken())
                    .header("Accept", "application/vnd.github+json")
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

            if (response == null) return Map.of();
            String token = (String) response.get("token");
            String expiresAt = (String) response.get("expires_at");
            return Map.of("token", token != null ? token : "", "expiresAt", expiresAt != null ? expiresAt : "");
        } catch (Exception e) {
            log.error("Could not fetch runner registration token for {}/{}: {}", owner, repo, e.getMessage());
            return Map.of();
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
