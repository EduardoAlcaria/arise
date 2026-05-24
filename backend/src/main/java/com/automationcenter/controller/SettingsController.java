package com.automationcenter.controller;

import com.automationcenter.entity.User;
import com.automationcenter.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/settings")
@RequiredArgsConstructor
public class SettingsController {

    private final UserService userService;

    @GetMapping("/webhook-token")
    public ResponseEntity<Map<String, String>> getWebhookToken(@AuthenticationPrincipal User user) {
        String token = userService.getOrCreateWebhookToken(user.getId());
        return ResponseEntity.ok(Map.of("webhookToken", token));
    }
}
