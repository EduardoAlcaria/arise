package com.automationcenter.controller;

import com.automationcenter.dto.audit.AuditEntryResponse;
import com.automationcenter.entity.User;
import com.automationcenter.repository.AuditEntryRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/audit")
@RequiredArgsConstructor
public class AuditController {

    private final AuditEntryRepository auditEntryRepository;

    @GetMapping
    public ResponseEntity<Page<AuditEntryResponse>> list(
            @AuthenticationPrincipal User user,
            @PageableDefault(size = 20) Pageable pageable) {
        Page<AuditEntryResponse> page = auditEntryRepository
                .findByUserIdOrderByTimestampDesc(user.getId(), pageable)
                .map(e -> AuditEntryResponse.builder()
                        .id(e.getId())
                        .username(e.getUsername())
                        .httpMethod(e.getHttpMethod())
                        .path(e.getPath())
                        .success(e.isSuccess())
                        .errorMessage(e.getErrorMessage())
                        .timestamp(e.getTimestamp())
                        .build());
        return ResponseEntity.ok(page);
    }
}
