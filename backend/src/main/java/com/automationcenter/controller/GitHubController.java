package com.automationcenter.controller;

import com.automationcenter.dto.github.GitHubBranchResponse;
import com.automationcenter.dto.github.GitHubRepoResponse;
import com.automationcenter.dto.github.GitHubTokenRequest;
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
}
