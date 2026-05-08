package com.automationcenter.dto.machine;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class SshCommandRequest {
    @NotBlank
    private String command;
}
