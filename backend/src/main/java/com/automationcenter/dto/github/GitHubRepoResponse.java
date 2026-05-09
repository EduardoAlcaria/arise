package com.automationcenter.dto.github;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class GitHubRepoResponse {
    private String name;
    private String fullName;
    private String description;
    private String url;
    private boolean isPrivate;
    private String defaultBranch;
    private String language;
    private int stargazersCount;
    private String updatedAt;
}
