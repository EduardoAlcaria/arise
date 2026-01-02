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
}
