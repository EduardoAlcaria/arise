package com.automationcenter.config;

import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

@Configuration
@EnableCaching
public class RedisConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory factory) {
        RedisCacheConfiguration base = RedisCacheConfiguration.defaultCacheConfig()
                .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(
                        new GenericJackson2JsonRedisSerializer()));

        Map<String, RedisCacheConfiguration> configs = new HashMap<>();
        configs.put("aws-ec2",          base.entryTtl(Duration.ofMinutes(2)));
        configs.put("aws-s3",           base.entryTtl(Duration.ofMinutes(15)));
        configs.put("aws-ecs",          base.entryTtl(Duration.ofMinutes(2)));
        configs.put("aws-ecs-services", base.entryTtl(Duration.ofMinutes(2)));
        configs.put("aws-topology",     base.entryTtl(Duration.ofMinutes(5)));
        configs.put("aws-explorer",     base.entryTtl(Duration.ofMinutes(5)));
        configs.put("aws-traces",       base.entryTtl(Duration.ofMinutes(1)));

        return RedisCacheManager.builder(factory)
                .withInitialCacheConfigurations(configs)
                .build();
    }
}
