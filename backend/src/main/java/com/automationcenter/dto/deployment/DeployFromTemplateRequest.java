package com.automationcenter.dto.deployment;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class DeployFromTemplateRequest {
    @NotBlank
    private String name;
    @NotNull
    private Long machineId;
}
