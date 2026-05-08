package com.automationcenter.dto.machine;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class MachineRequest {
    @NotBlank
    private String name;
    @NotBlank
    private String host;
    @NotNull @Min(1) @Max(65535)
    private Integer port;
    @NotBlank
    private String sshUser;
    @NotBlank
    private String privateKey;
}
