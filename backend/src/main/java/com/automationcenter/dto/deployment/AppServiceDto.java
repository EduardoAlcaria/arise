package com.automationcenter.dto.deployment;

import lombok.Data;

@Data
public class AppServiceDto {
    private String name;
    private String repoUrl;
    private String branch;
}
