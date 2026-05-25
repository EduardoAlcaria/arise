package com.automationcenter.config;

import com.automationcenter.websocket.NotificationHandler;
import com.automationcenter.websocket.SshTerminalHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketConfigurer {

    private final SshTerminalHandler sshTerminalHandler;
    private final NotificationHandler notificationHandler;

    @Value("${cors.allowed-origins:http://localhost:3000,http://localhost:5173}")
    private String corsAllowedOrigins;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        String[] origins = corsAllowedOrigins.split(",");
        registry.addHandler(sshTerminalHandler, "/ws/terminal/*")
                .setAllowedOrigins(origins);
        registry.addHandler(notificationHandler, "/ws/notifications")
                .setAllowedOrigins(origins);
    }
}
