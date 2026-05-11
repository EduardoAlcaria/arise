package com.automationcenter.controller;

import com.automationcenter.dto.infisical.InfisicalConnectRequest;
import com.automationcenter.dto.infisical.InfisicalSecret;
import com.automationcenter.entity.User;
import com.automationcenter.service.InfisicalService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/infisical")
@RequiredArgsConstructor
public class InfisicalController {

    private final InfisicalService infisicalService;

    @PostMapping("/connect")
    public ResponseEntity<Map<String, Object>> connect(
            @RequestBody InfisicalConnectRequest request,
            @AuthenticationPrincipal User user) {
        String baseUrl = request.getBaseUrl() != null && !request.getBaseUrl().isBlank()
                ? request.getBaseUrl()
                : "https://app.infisical.com";

        // authenticate() throws IllegalArgumentException on failure — caught by GlobalExceptionHandler
        infisicalService.authenticate(request.getClientId(), request.getClientSecret(), baseUrl);

        infisicalService.saveCredentials(user.getId(), request.getClientId(), request.getClientSecret(), baseUrl, request.getProjectId());
        return ResponseEntity.ok(Map.of("connected", true, "user", user.getEmail()));
    }

    @GetMapping("/secrets")
    public ResponseEntity<List<InfisicalSecret>> listSecrets(
            @RequestParam(defaultValue = "dev") String environment,
            @RequestParam(defaultValue = "/") String secretPath,
            @AuthenticationPrincipal User user) {
        String projectId = user.getInfisicalProjectId();
        List<InfisicalSecret> secrets = infisicalService.listSecrets(user.getId(), projectId, environment, secretPath);
        return ResponseEntity.ok(secrets);
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status(@AuthenticationPrincipal User user) {
        boolean connected = infisicalService.hasCredentials(user.getId());
        return ResponseEntity.ok(Map.of(
                "connected", connected,
                "projectId", user.getInfisicalProjectId() != null ? user.getInfisicalProjectId() : "",
                "baseUrl", user.getInfisicalBaseUrl() != null ? user.getInfisicalBaseUrl() : "https://app.infisical.com"
        ));
    }
}
