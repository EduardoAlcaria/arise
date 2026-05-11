package com.automationcenter.controller;

import com.automationcenter.dto.deployment.DeploymentRequest;
import com.automationcenter.dto.deployment.DeploymentResponse;
import com.automationcenter.dto.deployment.TunnelRequest;
import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.DeploymentStatus;
import com.automationcenter.entity.LogEntry;
import com.automationcenter.entity.User;
import com.automationcenter.service.DeploymentService;
import com.automationcenter.service.LogBroadcaster;
import com.automationcenter.service.LogService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/api/deployments")
@RequiredArgsConstructor
public class DeploymentController {

    private final DeploymentService deploymentService;
    private final LogService logService;
    private final LogBroadcaster logBroadcaster;

    @PostMapping
    public ResponseEntity<DeploymentResponse> create(
            @RequestBody @Valid DeploymentRequest request,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(deploymentService.create(request, user.getId()));
    }

    @GetMapping
    public ResponseEntity<Page<DeploymentResponse>> list(
            @AuthenticationPrincipal User user,
            @PageableDefault(size = 20, sort = "createdAt") Pageable pageable) {
        return ResponseEntity.ok(deploymentService.listByOwner(user.getId(), pageable));
    }

    @GetMapping("/{id}")
    public ResponseEntity<DeploymentResponse> get(
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(deploymentService.getById(id, user.getId()));
    }

    @PostMapping("/{id}/rollback")
    public ResponseEntity<DeploymentResponse> rollback(
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(deploymentService.rollback(id, user.getId()));
    }

    @PostMapping("/{id}/tunnel")
    public ResponseEntity<DeploymentResponse> addTunnel(
            @PathVariable Long id,
            @RequestBody @Valid TunnelRequest request,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(deploymentService.addTunnel(
                id, user.getId(), request.getTunnelName(), request.getTunnelHostname(), request.getTunnelAppPort()));
    }

    @GetMapping(value = "/{id}/logs/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamLogs(@PathVariable Long id, @AuthenticationPrincipal User user) {
        Deployment deployment = deploymentService.findRawById(id, user.getId());

        SseEmitter emitter = new SseEmitter(300_000L);

        // Replay all existing log entries
        List<LogEntry> existing = logService.findByDeploymentId(id);
        for (LogEntry entry : existing) {
            try {
                emitter.send(SseEmitter.event()
                        .id(entry.getId().toString())
                        .data(entry.getMessage()));
            } catch (IOException e) {
                emitter.completeWithError(e);
                return emitter;
            }
        }

        // If already terminal, complete immediately — no need to subscribe
        DeploymentStatus status = deployment.getStatus();
        if (status == DeploymentStatus.SUCCESS
                || status == DeploymentStatus.FAILED
                || status == DeploymentStatus.ROLLED_BACK) {
            emitter.complete();
            return emitter;
        }

        // Still running — subscribe for live push from the broadcaster
        logBroadcaster.register(id, emitter);

        // Guard against TOCTOU: if deployment finished during replay, close now
        Deployment fresh = deploymentService.findRawById(id, user.getId());
        if (fresh.getStatus() == DeploymentStatus.SUCCESS
                || fresh.getStatus() == DeploymentStatus.FAILED
                || fresh.getStatus() == DeploymentStatus.ROLLED_BACK) {
            logBroadcaster.complete(id);
        }

        return emitter;
    }
}
