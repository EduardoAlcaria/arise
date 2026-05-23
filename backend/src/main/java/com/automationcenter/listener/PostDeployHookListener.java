package com.automationcenter.listener;

import com.automationcenter.config.RabbitMQConfig;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

@Component
@Slf4j
public class PostDeployHookListener {

    @RabbitListener(queues = RabbitMQConfig.HOOKS_QUEUE)
    public void onPostDeployHook(Message message) {
        try {
            String deploymentId = new String(message.getBody(), StandardCharsets.UTF_8)
                    .replace("\"", "");
            log.info("[PostDeployHook] Deployment {} completed successfully. " +
                    "Webhook invocation placeholder — no webhook URL configured.", deploymentId);
        } catch (Exception e) {
            log.error("[PostDeployHook] Failed to handle hook message: {}", e.getMessage(), e);
        }
    }
}
