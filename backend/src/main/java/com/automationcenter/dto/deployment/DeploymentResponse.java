package com.automationcenter.dto.deployment;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Builder
public class DeploymentResponse {
    private Long id;
    private String name;
    private String type;
    private String status;
    private String repositoryUrl;
    private String branch;
    private String logs;
    private String version;
    private String detectedStack;
    private String applicationServices;
    private String applicationConfigs;
    private String tunnelName;
    private String tunnelHostname;
    private String cloudfareTunnelId;
    private String cloudfareTunnelUrl;
    private Long machineId;
    private String machineName;
    private Long ownerId;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
    private LocalDateTime createdAt;
}
