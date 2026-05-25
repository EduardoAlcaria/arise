package com.automationcenter.config;

import org.springframework.boot.web.reactive.function.client.WebClientCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.codec.ClientCodecConfigurer;
import org.springframework.web.reactive.function.client.ExchangeStrategies;
import org.springframework.web.reactive.function.client.WebClient;

@Configuration
public class WebClientConfig {

    private static final int MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10 MB

    @Bean
    public WebClientCustomizer webClientCustomizer() {
        return builder -> builder.exchangeStrategies(
                ExchangeStrategies.builder()
                        .codecs(cfg -> cfg.defaultCodecs().maxInMemorySize(MAX_BUFFER_SIZE))
                        .build());
    }
}
