package com.automationcenter.dto.github;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class GitHubTokenRequest {
    @NotBlank
    private String token;
}
