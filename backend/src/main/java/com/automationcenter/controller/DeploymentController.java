package com.automationcenter.controller;

import com.automationcenter.dto.deployment.DeploymentRequest;
import com.automationcenter.dto.deployment.DeploymentResponse;
import com.automationcenter.entity.LogEntry;
import com.automationcenter.entity.User;
import com.automationcenter.service.DeploymentService;
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
import java.util.concurrent.Executors;

@RestController
@RequestMapping("/api/deployments")
@RequiredArgsConstructor
public class DeploymentController {

    private final DeploymentService deploymentService;
    private final LogService logService;

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

    @GetMapping(value = "/{id}/logs/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamLogs(@PathVariable Long id, @AuthenticationPrincipal User user) {
        SseEmitter emitter = new SseEmitter(300_000L);
        final long[] lastId = {0L};

        Executors.newSingleThreadExecutor().submit(() -> {
            try {
                while (true) {
                    List<LogEntry> newLogs = logService.findByDeploymentIdAfter(id, lastId[0]);
                    for (LogEntry log : newLogs) {
                        emitter.send(SseEmitter.event()
                                .id(log.getId().toString())
                                .data(log.getMessage()));
                        lastId[0] = log.getId();
                    }

                    var deployment = deploymentService.findRawById(id, user.getId());
                    var status = deployment.getStatus();
                    if (status.name().equals("SUCCESS") || status.name().equals("FAILED") ||
                            status.name().equals("ROLLED_BACK")) {
                        emitter.complete();
                        return;
                    }
                    Thread.sleep(1000);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                emitter.complete();
            } catch (IOException e) {
                emitter.completeWithError(e);
            } catch (Exception e) {
                emitter.completeWithError(e);
            }
        });

        return emitter;
    }
}
