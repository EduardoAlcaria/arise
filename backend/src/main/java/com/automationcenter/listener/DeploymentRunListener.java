package com.automationcenter.listener;

import com.automationcenter.service.DeploymentService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@Slf4j
public class DeploymentRunListener {

    private final DeploymentService deploymentService;

    @RabbitListener(queues = "${rabbitmq.queue.deployment-run:deployment.run.queue}")
    public void onRunDeployment(Long deploymentId) {
        log.info("[RabbitMQ] Picked up deployment job: {}", deploymentId);
        deploymentService.executeAsync(deploymentId);
    }
}
