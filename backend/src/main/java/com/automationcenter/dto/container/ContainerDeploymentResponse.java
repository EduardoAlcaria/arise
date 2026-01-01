package com.automationcenter.dto.container;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.Map;

@Data
@Builder
public class ContainerDeploymentResponse {
    private Long id;
    private String name;
    private String image;
    private Integer hostPort;
    private Integer containerPort;
    private Map<String, String> envVars;
    private String containerId;
    private String status;
    private Long machineId;
    private String machineName;
    private Long ownerId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
