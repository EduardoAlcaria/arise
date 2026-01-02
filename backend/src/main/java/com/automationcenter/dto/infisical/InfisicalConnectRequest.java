package com.automationcenter.dto.infisical;

import lombok.Data;

@Data
public class InfisicalConnectRequest {
    private String clientId;
    private String clientSecret;
    private String baseUrl;
    private String projectId;
}
