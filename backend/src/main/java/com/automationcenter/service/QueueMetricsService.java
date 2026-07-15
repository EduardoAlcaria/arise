package com.automationcenter.service;

import com.automationcenter.config.RabbitMQConfig;
import com.automationcenter.dto.queue.QueueDepthResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.net.URI;
import java.util.List;
import java.util.Map;

/** Reads queue depth from the RabbitMQ management HTTP API (a separate port/
 * protocol from the AMQP connection used for actual messaging). */
@Service
@Slf4j
public class QueueMetricsService {

    private final WebClient.Builder webClientBuilder;

    @Value("${spring.rabbitmq.host}")
    private String rabbitHost;

    @Value("${rabbitmq.management-port:15672}")
    private int managementPort;

    @Value("${spring.rabbitmq.username}")
    private String rabbitUsername;

    @Value("${spring.rabbitmq.password}")
    private String rabbitPassword;

    private static final List<String> QUEUES = List.of(
            RabbitMQConfig.DEPLOYMENT_RUN_QUEUE, RabbitMQConfig.DEPLOYMENT_QUEUE, RabbitMQConfig.HOOKS_QUEUE);

    public QueueMetricsService(WebClient.Builder webClientBuilder) {
        this.webClientBuilder = webClientBuilder;
    }

    public List<QueueDepthResponse> getQueueDepths() {
        return QUEUES.stream().map(this::fetchOne).toList();
    }

    private QueueDepthResponse fetchOne(String queueName) {
        try {
            // Pre-built URI (not .uri(String)) so the already-encoded %2F vhost separator
            // isn't re-escaped into %252F by WebClient's URI-template resolution.
            URI uri = URI.create("http://" + rabbitHost + ":" + managementPort + "/api/queues/%2F/" + queueName);
            @SuppressWarnings("unchecked")
            Map<String, Object> body = webClientBuilder.build()
                    .get()
                    .uri(uri)
                    .headers(h -> h.setBasicAuth(rabbitUsername, rabbitPassword))
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

            int ready = asInt(body, "messages_ready");
            int unacked = asInt(body, "messages_unacknowledged");
            return new QueueDepthResponse(queueName, ready, unacked, ready + unacked);
        } catch (Exception e) {
            log.debug("Could not fetch queue depth for {}: {}", queueName, e.getMessage());
            return new QueueDepthResponse(queueName, 0, 0, 0);
        }
    }

    private static int asInt(Map<String, Object> body, String key) {
        Object v = body != null ? body.get(key) : null;
        return v instanceof Number n ? n.intValue() : 0;
    }
}
