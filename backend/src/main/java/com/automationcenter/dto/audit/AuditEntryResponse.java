package com.automationcenter.dto.audit;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Builder
public class AuditEntryResponse {
    private Long id;
    private String username;
    private String httpMethod;
    private String path;
    private boolean success;
    private String errorMessage;
    private LocalDateTime timestamp;
}
