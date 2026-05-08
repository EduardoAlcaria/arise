package com.automationcenter.controller;

import com.automationcenter.dto.container.ContainerDeployRequest;
import com.automationcenter.dto.container.ContainerDeploymentResponse;
import com.automationcenter.entity.User;
import com.automationcenter.service.ContainerDeploymentService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/containers")
@RequiredArgsConstructor
public class ContainerController {

    private final ContainerDeploymentService containerDeploymentService;

    @PostMapping
    public ResponseEntity<ContainerDeploymentResponse> deploy(
            @RequestBody @Valid ContainerDeployRequest request,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(containerDeploymentService.deploy(request, user.getId()));
    }

    @GetMapping
    public ResponseEntity<List<ContainerDeploymentResponse>> list(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(containerDeploymentService.listByOwner(user.getId()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ContainerDeploymentResponse> get(
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(containerDeploymentService.getById(id, user.getId()));
    }

    @PostMapping("/{id}/stop")
    public ResponseEntity<ContainerDeploymentResponse> stop(
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(containerDeploymentService.stop(id, user.getId()));
    }

    @PostMapping("/{id}/restart")
    public ResponseEntity<ContainerDeploymentResponse> restart(
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(containerDeploymentService.restart(id, user.getId()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> remove(@PathVariable Long id, @AuthenticationPrincipal User user) {
        containerDeploymentService.remove(id, user.getId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/logs")
    public ResponseEntity<Map<String, String>> logs(
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(Map.of("logs", containerDeploymentService.getLogs(id, user.getId())));
    }
}
