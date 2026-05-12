package com.automationcenter.dto.aws;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AwsCredentialsRequest {

    @NotBlank(message = "Access key ID is required")
    private String accessKeyId;

    @NotBlank(message = "Secret access key is required")
    private String secretAccessKey;

    @NotBlank(message = "Default region is required")
    private String region;
}
