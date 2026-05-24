package com.automationcenter.controller;

import com.automationcenter.entity.Deployment;
import com.automationcenter.repository.DeploymentRepository;
import com.automationcenter.repository.UserRepository;
import com.automationcenter.service.DeploymentService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.List;

@RestController
@RequestMapping("/api/webhooks")
@RequiredArgsConstructor
@Slf4j
public class WebhookController {

    private final UserRepository userRepository;
    private final DeploymentRepository deploymentRepository;
    private final DeploymentService deploymentService;
    private final ObjectMapper objectMapper;

    @PostMapping("/github/{webhookToken}")
    public ResponseEntity<Void> githubPush(
            @PathVariable String webhookToken,
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature,
            @RequestHeader(value = "X-GitHub-Event", defaultValue = "") String event,
            @RequestBody String body) {

        var user = userRepository.findByWebhookToken(webhookToken).orElse(null);
        if (user == null) {
            log.warn("[Webhook] Unknown webhookToken: {}", webhookToken);
            return ResponseEntity.notFound().build();
        }

        if (user.getWebhookSecret() == null || !verifySignature(user.getWebhookSecret(), body, signature)) {
            log.warn("[Webhook] Invalid signature for user {}", user.getId());
            return ResponseEntity.status(401).build();
        }

        if (!"push".equals(event)) {
            return ResponseEntity.ok().build();
        }

        try {
            JsonNode payload = objectMapper.readTree(body);
            String ref = payload.path("ref").asText();
            String repoUrl = payload.path("repository").path("html_url").asText();

            if (ref.isBlank() || repoUrl.isBlank()) {
                return ResponseEntity.badRequest().build();
            }

            String branch = ref.startsWith("refs/heads/") ? ref.substring("refs/heads/".length()) : ref;
            String repoUrlNorm = repoUrl.replaceAll("\\.git$", "").toLowerCase();

            List<Deployment> matches = deploymentRepository.findByOwnerId(user.getId()).stream()
                    .filter(d -> d.getRepositoryUrl() != null && d.getBranch() != null)
                    .filter(d -> d.getRepositoryUrl().replaceAll("\\.git$", "").toLowerCase().equals(repoUrlNorm))
                    .filter(d -> d.getBranch().equals(branch))
                    .toList();

            log.info("[Webhook] Push to {}/{} — {} matching deployment(s) for user {}", repoUrl, branch, matches.size(), user.getId());

            for (Deployment d : matches) {
                try {
                    deploymentService.redeploy(d.getId(), user.getId());
                    log.info("[Webhook] Triggered redeploy for deployment {}", d.getId());
                } catch (Exception e) {
                    log.error("[Webhook] Failed to redeploy deployment {}: {}", d.getId(), e.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("[Webhook] Failed to process push event: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }

        return ResponseEntity.ok().build();
    }

    private boolean verifySignature(String secret, String body, String signature) {
        if (signature == null || !signature.startsWith("sha256=")) return false;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String expected = "sha256=" + HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
            return expected.equals(signature);
        } catch (Exception e) {
            log.error("[Webhook] HMAC verification failed: {}", e.getMessage());
            return false;
        }
    }
}
