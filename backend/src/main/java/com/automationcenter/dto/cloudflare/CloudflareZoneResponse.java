package com.automationcenter.dto.cloudflare;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class CloudflareZoneResponse {
    private String id;
    private String name;
    private String status;
    private String accountId;
}
