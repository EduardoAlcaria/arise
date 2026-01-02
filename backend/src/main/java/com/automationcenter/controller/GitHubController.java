package com.automationcenter.controller;

import com.automationcenter.dto.github.GitHubBranchResponse;
import com.automationcenter.dto.github.GitHubRepoResponse;
import com.automationcenter.dto.github.GitHubTokenRequest;
import com.automationcenter.dto.github.GitHubTreeItem;
import com.automationcenter.entity.User;
import com.automationcenter.service.GitHubService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/github")
@RequiredArgsConstructor
public class GitHubController {

    private final GitHubService gitHubService;

    @GetMapping("/me")
    public ResponseEntity<Map<String, String>> getMe(@AuthenticationPrincipal User user) {
        Map<String, String> info = gitHubService.getConnectedUser(user.getId());
        return info != null ? ResponseEntity.ok(info) : ResponseEntity.noContent().build();
    }

    @PostMapping("/token")
    public ResponseEntity<Map<String, String>> saveToken(
            @RequestBody @Valid GitHubTokenRequest request,
            @AuthenticationPrincipal User user) {
        gitHubService.saveToken(user.getId(), request.getToken());
        return ResponseEntity.ok(Map.of("message", "GitHub token saved successfully"));
    }

    @GetMapping("/repos")
    public ResponseEntity<List<GitHubRepoResponse>> listRepos(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(gitHubService.listRepos(user.getId()));
    }

    @GetMapping("/repos/{owner}/{repo}/branches")
    public ResponseEntity<List<GitHubBranchResponse>> listBranches(
            @PathVariable String owner,
            @PathVariable String repo,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(gitHubService.listBranches(user.getId(), owner, repo));
    }

    @GetMapping("/repos/{owner}/{repo}/readme")
    public ResponseEntity<Map<String, String>> getReadme(
            @PathVariable String owner,
            @PathVariable String repo,
            @AuthenticationPrincipal User user) {
        String content = gitHubService.getReadme(user.getId(), owner, repo);
        return ResponseEntity.ok(Map.of("content", content));
    }

    @GetMapping("/repos/{owner}/{repo}/tree")
    public ResponseEntity<List<GitHubTreeItem>> getTree(
            @PathVariable String owner,
            @PathVariable String repo,
            @RequestParam(defaultValue = "main") String branch,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(gitHubService.getTree(user.getId(), owner, repo, branch));
    }

    @GetMapping("/repos/{owner}/{repo}/envvars")
    public ResponseEntity<Map<String, Object>> getEnvVars(
            @PathVariable String owner,
            @PathVariable String repo,
            @RequestParam(defaultValue = "main") String branch,
            @AuthenticationPrincipal User user) {
        List<String> vars = gitHubService.getEnvVarKeys(user.getId(), owner, repo, branch);
        return ResponseEntity.ok(Map.of("vars", vars));
    }

    @PostMapping("/repos/{owner}/{repo}/runner-token")
    public ResponseEntity<Map<String, String>> getRunnerToken(
            @PathVariable String owner,
            @PathVariable String repo,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(gitHubService.getRunnerRegistrationToken(user.getId(), owner, repo));
    }
}
