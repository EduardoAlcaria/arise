package com.automationcenter.dto.aws;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Builder
public class AwsAccountResponse {
    private Long id;
    private String name;
    private String profileName;
    private String defaultRegion;
    private String terraformRepoUrl;
    private LocalDateTime createdAt;
    private boolean reachable;
    private String accountId;
}
