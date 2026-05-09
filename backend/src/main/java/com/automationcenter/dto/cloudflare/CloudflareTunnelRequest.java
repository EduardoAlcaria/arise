package com.automationcenter.dto.cloudflare;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class CloudflareTunnelRequest {
    @NotBlank
    private String name;
    @NotBlank
    private String tunnelSecret;
}
