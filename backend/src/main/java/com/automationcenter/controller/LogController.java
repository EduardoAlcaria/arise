package com.automationcenter.controller;

import com.automationcenter.entity.LogEntry;
import com.automationcenter.entity.User;
import com.automationcenter.service.DeploymentService;
import com.automationcenter.service.LogService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/deployments/{deploymentId}/logs")
@RequiredArgsConstructor
public class LogController {

    private final LogService logService;
    private final DeploymentService deploymentService;

    @GetMapping
    public ResponseEntity<List<LogEntry>> getLogs(
            @PathVariable Long deploymentId,
            @AuthenticationPrincipal User user) {
        deploymentService.getById(deploymentId, user.getId()); // ownership check
        return ResponseEntity.ok(logService.findByDeploymentId(deploymentId));
    }
}
