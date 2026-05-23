package com.automationcenter.listener;

import com.automationcenter.config.RabbitMQConfig;
import com.automationcenter.websocket.NotificationHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

@Component
@RequiredArgsConstructor
@Slf4j
public class DeploymentEventListener {

    private final NotificationHandler notificationHandler;
    private final RabbitTemplate rabbitTemplate;

    @RabbitListener(queues = RabbitMQConfig.DEPLOYMENT_QUEUE)
    public void onDeploymentEvent(Message message) {
        String event = new String(message.getBody(), StandardCharsets.UTF_8)
                .replace("\"", "");
        log.info("[RabbitMQ] Deployment event received: {}", event);

        String[] parts = event.split(":", 2);
        if (parts.length != 2) {
            log.warn("[RabbitMQ] Unrecognised deployment event format: {}", event);
            return;
        }
        String type = parts[0];
        String deploymentId = parts[1];
        String status = type.equals("DEPLOYMENT_SUCCESS") ? "SUCCESS" : "FAILED";
        String json = String.format(
                "{\"type\":\"DEPLOYMENT_UPDATE\",\"deploymentId\":%s,\"status\":\"%s\"}",
                deploymentId, status
        );

        try {
            notificationHandler.broadcast(json);
        } catch (Exception e) {
            log.error("[RabbitMQ] Failed to broadcast WS notification for deployment {}: {}", deploymentId, e.getMessage(), e);
        }

        if ("SUCCESS".equals(status)) {
            try {
                Message hookMsg = MessageBuilder
                        .withBody(deploymentId.getBytes(StandardCharsets.UTF_8))
                        .build();
                rabbitTemplate.send(RabbitMQConfig.HOOKS_EXCHANGE, RabbitMQConfig.HOOKS_KEY, hookMsg);
                log.info("[RabbitMQ] Published post-deploy hook event for deployment {}", deploymentId);
            } catch (Exception e) {
                log.error("[RabbitMQ] Failed to publish post-deploy hook for deployment {}: {}", deploymentId, e.getMessage(), e);
            }
        }
    }
}
