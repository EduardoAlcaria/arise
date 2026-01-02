package com.automationcenter.controller;

import com.automationcenter.dto.cloudflare.CloudflareTunnelRequest;
import com.automationcenter.dto.cloudflare.CloudflareTunnelResponse;
import com.automationcenter.dto.cloudflare.CloudflareTokenRequest;
import com.automationcenter.dto.cloudflare.CloudflareZoneResponse;
import com.automationcenter.entity.User;
import com.automationcenter.service.CloudflareService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/cloudflare")
@RequiredArgsConstructor
public class CloudflareController {

    private final CloudflareService cloudflareService;

    @PostMapping("/token")
    public ResponseEntity<Map<String, String>> saveToken(
            @RequestBody @Valid CloudflareTokenRequest request,
            @AuthenticationPrincipal User user) {
        cloudflareService.saveToken(user.getId(), request.getToken(), request.getAccountId());
        return ResponseEntity.ok(Map.of("message", "Cloudflare token saved successfully"));
    }

    @GetMapping("/zones")
    public ResponseEntity<List<CloudflareZoneResponse>> listZones(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(cloudflareService.listZones(user.getId()));
    }

    @PostMapping("/tunnels")
    public ResponseEntity<CloudflareTunnelResponse> createTunnel(
            @RequestBody @Valid CloudflareTunnelRequest request,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(cloudflareService.createTunnel(user.getId(), request));
    }

    @GetMapping("/tunnels")
    public ResponseEntity<List<CloudflareTunnelResponse>> listTunnels(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(cloudflareService.listTunnels(user.getId()));
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Boolean>> getStatus(@AuthenticationPrincipal User user) {
        boolean configured = user.getCloudflareToken() != null && !user.getCloudflareToken().isBlank()
                && user.getCloudflareAccountId() != null && !user.getCloudflareAccountId().isBlank();
        return ResponseEntity.ok(Map.of("configured", configured));
    }
}
