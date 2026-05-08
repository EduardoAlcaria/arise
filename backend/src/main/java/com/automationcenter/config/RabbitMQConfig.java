package com.automationcenter.config;

import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitMQConfig {

    public static final String DEPLOYMENT_QUEUE = "deployment.queue";
    public static final String DEPLOYMENT_EXCHANGE = "deployment.exchange";
    public static final String DEPLOYMENT_ROUTING_KEY = "deployment.events";

    @Bean
    public Queue deploymentQueue() {
        return new Queue(DEPLOYMENT_QUEUE, true);
    }

    @Bean
    public TopicExchange deploymentExchange() {
        return new TopicExchange(DEPLOYMENT_EXCHANGE);
    }

    @Bean
    public Binding deploymentBinding(Queue deploymentQueue, TopicExchange deploymentExchange) {
        return BindingBuilder.bind(deploymentQueue).to(deploymentExchange).with(DEPLOYMENT_ROUTING_KEY);
    }

    @Bean
    public Jackson2JsonMessageConverter messageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(messageConverter());
        return template;
    }
}
