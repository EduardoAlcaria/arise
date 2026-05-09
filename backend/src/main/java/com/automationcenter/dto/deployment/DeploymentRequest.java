package com.automationcenter.dto.deployment;

import com.automationcenter.entity.DeploymentType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

@Data
public class DeploymentRequest {
    @NotBlank
    private String name;
    @NotNull
    private DeploymentType type;
    private String repositoryUrl;
    private String branch;
    private String version;
    @NotNull
    private Long machineId;
    private List<AppServiceDto> services;
    private List<ConfigFileDto> configFiles;
    private String tunnelName;
    private String tunnelHostname;
    private Integer tunnelAppPort;
}
