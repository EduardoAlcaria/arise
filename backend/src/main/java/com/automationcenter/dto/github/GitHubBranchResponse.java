package com.automationcenter.dto.github;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class GitHubBranchResponse {
    private String name;
    private String sha;
}
