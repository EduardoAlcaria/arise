package com.automationcenter.listener;

import com.automationcenter.config.RabbitMQConfig;
import com.automationcenter.websocket.NotificationHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

@Component
@RequiredArgsConstructor
@Slf4j
public class DeploymentEventListener {

    private final NotificationHandler notificationHandler;

    @RabbitListener(queues = RabbitMQConfig.DEPLOYMENT_QUEUE)
    public void onDeploymentEvent(Message message) {
        String event = new String(message.getBody(), StandardCharsets.UTF_8)
                .replace("\"", "");
        log.info("[RabbitMQ] Deployment event received: {}", event);
        try {
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
            notificationHandler.broadcast(json);
        } catch (Exception e) {
            log.error("[RabbitMQ] Failed to handle deployment event {}: {}", event, e.getMessage(), e);
        }
    }
}
