package com.automationcenter.service;

import com.automationcenter.dto.github.GitHubBranchResponse;
import com.automationcenter.dto.github.GitHubRepoResponse;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kohsuke.github.GHRepository;
import org.kohsuke.github.GitHub;
import org.kohsuke.github.GitHubBuilder;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class GitHubService {

    private final UserRepository userRepository;

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
                    .map(repo -> new GitHubRepoResponse(
                            repo.getName(),
                            repo.getFullName(),
                            repo.getDescription(),
                            repo.getHtmlUrl().toString(),
                            repo.isPrivate(),
                            repo.getDefaultBranch()
                    ))
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

    private User getUser(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getGithubToken() == null || user.getGithubToken().isBlank()) {
            throw new IllegalArgumentException("GitHub token not configured. Please save a token first.");
        }
        return user;
    }
}
