package com.automationcenter.dto.cloudflare;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CloudflareTunnelRequest {
    @NotBlank
    private String name;
    @NotBlank
    private String tunnelSecret;
}
