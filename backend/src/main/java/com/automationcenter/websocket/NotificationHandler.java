package com.automationcenter.websocket;

import com.automationcenter.security.JwtService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

@Component
@RequiredArgsConstructor
@Slf4j
public class NotificationHandler extends AbstractWebSocketHandler {

    private final JwtService jwtService;
    private final UserDetailsService userDetailsService;

    private final Set<WebSocketSession> sessions = new CopyOnWriteArraySet<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String query = session.getUri() != null ? session.getUri().getQuery() : null;
        String token = extractParam(query, "token");

        if (token == null || token.isBlank()) {
            log.warn("[WS:notify] Rejected unauthenticated connection from {}", session.getRemoteAddress());
            closeQuietly(session, CloseStatus.POLICY_VIOLATION);
            return;
        }

        try {
            String username = jwtService.extractUsername(token);
            var userDetails = userDetailsService.loadUserByUsername(username);
            if (!jwtService.isTokenValid(token, userDetails)) {
                log.warn("[WS:notify] Invalid JWT from {}", session.getRemoteAddress());
                closeQuietly(session, CloseStatus.POLICY_VIOLATION);
                return;
            }
        } catch (Exception e) {
            log.warn("[WS:notify] JWT validation failed: {}", e.getMessage());
            closeQuietly(session, CloseStatus.POLICY_VIOLATION);
            return;
        }

        sessions.add(session);
        log.debug("[WS:notify] Authenticated client connected: {}", session.getId());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
        log.debug("[WS:notify] Client disconnected: {}", session.getId());
    }

    public void broadcast(String json) {
        TextMessage msg = new TextMessage(json);
        for (WebSocketSession session : sessions) {
            if (session.isOpen()) {
                try {
                    synchronized (session) {
                        session.sendMessage(msg);
                    }
                } catch (IOException e) {
                    log.warn("[WS:notify] Send failed to {}: {}", session.getId(), e.getMessage());
                    sessions.remove(session);
                }
            }
        }
    }

    private String extractParam(String query, String name) {
        if (query == null) return null;
        for (String part : query.split("&")) {
            String[] kv = part.split("=", 2);
            if (kv.length == 2 && name.equals(kv[0])) return kv[1];
        }
        return null;
    }

    private void closeQuietly(WebSocketSession session, CloseStatus status) {
        try { session.close(status); } catch (IOException ignored) {}
    }
}
