package com.automationcenter.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RunnerSetupTracker {

    public record Session(String status, String output, Long ownerId, Instant createdAt) {}

    private final ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

    public String create(Long ownerId) {
        String id = UUID.randomUUID().toString();
        sessions.put(id, new Session("RUNNING", "Starting runner setup…\n", ownerId, Instant.now()));
        return id;
    }

    public void complete(String sessionId, String output) {
        Session s = sessions.get(sessionId);
        if (s != null) sessions.put(sessionId, new Session("DONE", output, s.ownerId(), s.createdAt()));
    }

    public void fail(String sessionId, String output) {
        Session s = sessions.get(sessionId);
        if (s != null) sessions.put(sessionId, new Session("FAILED", output, s.ownerId(), s.createdAt()));
    }

    public Session get(String sessionId, Long requestingUserId) {
        Session s = sessions.get(sessionId);
        if (s == null || !s.ownerId().equals(requestingUserId)) return null;
        return s;
    }

    /** Remove terminal (non-RUNNING) sessions created before the cutoff. */
    public void evictStale(Instant cutoff) {
        sessions.entrySet().removeIf(e ->
                !"RUNNING".equals(e.getValue().status()) && e.getValue().createdAt().isBefore(cutoff));
    }

    @Scheduled(fixedRate = 600_000) // every 10 minutes
    public void evictStaleScheduled() {
        evictStale(Instant.now().minus(Duration.ofHours(1)));
    }
}
