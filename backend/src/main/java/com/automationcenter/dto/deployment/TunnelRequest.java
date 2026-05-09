package com.automationcenter.dto.deployment;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class TunnelRequest {
    @NotBlank
    private String tunnelName;
    @NotBlank
    private String tunnelHostname;
    @NotNull
    private Integer tunnelAppPort;
}
