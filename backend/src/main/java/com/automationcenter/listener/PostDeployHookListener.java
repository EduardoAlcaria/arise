package com.automationcenter.listener;

import com.automationcenter.config.RabbitMQConfig;
import com.automationcenter.entity.Deployment;
import com.automationcenter.repository.DeploymentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.nio.charset.StandardCharsets;
import java.time.format.DateTimeFormatter;
import java.util.Map;

@Component
@RequiredArgsConstructor
@Slf4j
public class PostDeployHookListener {

    private final DeploymentRepository deploymentRepository;
    private final WebClient.Builder webClientBuilder;

    @RabbitListener(queues = RabbitMQConfig.HOOKS_QUEUE)
    public void onPostDeployHook(Message message) {
        String deploymentIdStr = new String(message.getBody(), StandardCharsets.UTF_8);
        try {
            Long deploymentId = Long.parseLong(deploymentIdStr.trim());
            Deployment deployment = deploymentRepository.findById(deploymentId).orElse(null);
            if (deployment == null) {
                log.warn("[PostDeployHook] Deployment {} not found", deploymentId);
                return;
            }
            if (deployment.getWebhookUrl() == null || deployment.getWebhookUrl().isBlank()) {
                log.debug("[PostDeployHook] No webhook URL for deployment {}", deploymentId);
                return;
            }
            Map<String, Object> payload = Map.of(
                    "deploymentId", deploymentId,
                    "name", deployment.getName(),
                    "status", "SUCCESS",
                    "repositoryUrl", deployment.getRepositoryUrl() != null ? deployment.getRepositoryUrl() : "",
                    "branch", deployment.getBranch() != null ? deployment.getBranch() : "",
                    "finishedAt", deployment.getFinishedAt() != null
                            ? deployment.getFinishedAt().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME) : ""
            );
            webClientBuilder.build()
                    .post()
                    .uri(deployment.getWebhookUrl())
                    .bodyValue(payload)
                    .retrieve()
                    .bodyToMono(Void.class)
                    .block();
            log.info("[PostDeployHook] Webhook called for deployment {}: {}", deploymentId, deployment.getWebhookUrl());
        } catch (Exception e) {
            log.error("[PostDeployHook] Failed to call webhook for deployment {}: {}", deploymentIdStr, e.getMessage(), e);
        }
    }
}
