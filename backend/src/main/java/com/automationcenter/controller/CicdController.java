package com.automationcenter.controller;

import com.automationcenter.entity.User;
import com.automationcenter.service.CicdService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/api/cicd")
@RequiredArgsConstructor
public class CicdController {

    private final CicdService cicdService;

    @GetMapping("/workflows/{owner}/{repo}")
    public ResponseEntity<List<String>> detectWorkflows(
            @PathVariable String owner,
            @PathVariable String repo,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(cicdService.detectWorkflows(user.getId(), owner, repo));
    }

    @PostMapping("/runner/{owner}/{repo}/setup")
    public ResponseEntity<Map<String, String>> setupRunner(
            @PathVariable String owner,
            @PathVariable String repo,
            @RequestParam Long machineId,
            @AuthenticationPrincipal User user) {
        cicdService.setupRunner(user.getId(), machineId, owner, repo);
        return ResponseEntity.accepted().body(Map.of("message", "Runner setup started asynchronously"));
    }

    @GetMapping("/runs/{owner}/{repo}")
    public ResponseEntity<List<Map<String, Object>>> getWorkflowRuns(
            @PathVariable String owner,
            @PathVariable String repo,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(cicdService.getWorkflowRuns(user.getId(), owner, repo));
    }

    @PostMapping("/runs/{owner}/{repo}/{runId}/rerun")
    public ResponseEntity<Void> rerunWorkflow(
            @PathVariable String owner,
            @PathVariable String repo,
            @PathVariable Long runId,
            @AuthenticationPrincipal User user) {
        cicdService.rerunWorkflow(user.getId(), owner, repo, runId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/workflows/{owner}/{repo}/{workflowId}/dispatch")
    public ResponseEntity<Void> triggerWorkflow(
            @PathVariable String owner,
            @PathVariable String repo,
            @PathVariable String workflowId,
            @RequestParam(defaultValue = "main") String ref,
            @AuthenticationPrincipal User user) {
        cicdService.triggerWorkflow(user.getId(), owner, repo, workflowId, ref);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/jobs/{owner}/{repo}/{runId}")
    public ResponseEntity<List<Map<String, Object>>> getWorkflowJobs(
            @PathVariable String owner,
            @PathVariable String repo,
            @PathVariable Long runId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(cicdService.getWorkflowJobs(user.getId(), owner, repo, runId));
    }

    @GetMapping("/runners/{owner}/{repo}")
    public ResponseEntity<List<Map<String, Object>>> listRunners(
            @PathVariable String owner,
            @PathVariable String repo,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(cicdService.listRunners(user.getId(), owner, repo));
    }

    @DeleteMapping("/runners/{owner}/{repo}/{runnerId}")
    public ResponseEntity<Void> deleteRunner(
            @PathVariable String owner,
            @PathVariable String repo,
            @PathVariable Long runnerId,
            @AuthenticationPrincipal User user) {
        cicdService.deleteRunner(user.getId(), owner, repo, runnerId);
        return ResponseEntity.noContent().build();
    }
}
