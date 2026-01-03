package com.automationcenter.dto.aws;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AwsAccountRequest {

    @NotBlank(message = "Account name is required")
    private String name;

    @NotBlank(message = "AWS profile name is required")
    private String profileName;

    @NotBlank(message = "Default region is required")
    private String region;

    private String terraformRepoUrl;
}
