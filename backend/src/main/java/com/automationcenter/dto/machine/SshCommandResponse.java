package com.automationcenter.dto.machine;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class SshCommandResponse {
    private String stdout;
    private String stderr;
    private int exitCode;
}
