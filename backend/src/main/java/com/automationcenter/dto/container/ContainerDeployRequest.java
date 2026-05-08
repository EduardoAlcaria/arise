package com.automationcenter.dto.container;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.Map;

@Data
public class ContainerDeployRequest {
    @NotBlank
    private String name;
    @NotBlank
    private String image;
    private Integer hostPort;
    private Integer containerPort;
    private Map<String, String> envVars;
    @NotNull
    private Long machineId;
}
