package com.automationcenter.dto.cloudflare;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CloudflareTokenRequest {
    @NotBlank
    private String token;
    @NotBlank
    private String accountId;
}
