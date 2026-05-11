package com.automationcenter.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

@Service
@Slf4j
public class LogBroadcaster {

    private final ConcurrentHashMap<Long, Set<SseEmitter>> subscribers = new ConcurrentHashMap<>();

    public void register(Long deploymentId, SseEmitter emitter) {
        Set<SseEmitter> emitters = subscribers.computeIfAbsent(deploymentId, id -> new CopyOnWriteArraySet<>());
        emitters.add(emitter);

        emitter.onCompletion(() -> removeEmitter(deploymentId, emitter));
        emitter.onTimeout(() -> removeEmitter(deploymentId, emitter));
        emitter.onError(e -> removeEmitter(deploymentId, emitter));
    }

    public void publish(Long deploymentId, String message) {
        Set<SseEmitter> emitters = subscribers.get(deploymentId);
        if (emitters == null || emitters.isEmpty()) return;

        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().data(message));
            } catch (IOException e) {
                log.debug("SSE send failed for deployment {}, removing dead emitter", deploymentId);
                removeEmitter(deploymentId, emitter);
            }
        }
    }

    public void complete(Long deploymentId) {
        Set<SseEmitter> emitters = subscribers.remove(deploymentId);
        if (emitters == null) return;

        for (SseEmitter emitter : emitters) {
            try {
                emitter.complete();
            } catch (Exception e) {
                log.debug("Failed to complete SSE emitter for deployment {}: {}", deploymentId, e.getMessage());
            }
        }
    }

    private void removeEmitter(Long deploymentId, SseEmitter emitter) {
        Set<SseEmitter> emitters = subscribers.get(deploymentId);
        if (emitters != null) {
            emitters.remove(emitter);
        }
    }
}
