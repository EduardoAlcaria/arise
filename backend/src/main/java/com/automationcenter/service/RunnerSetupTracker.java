package com.automationcenter.service;

import org.springframework.stereotype.Service;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RunnerSetupTracker {

    public record Session(String status, String output, Long ownerId) {}

    private final ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

    public String create(Long ownerId) {
        String id = UUID.randomUUID().toString();
        sessions.put(id, new Session("RUNNING", "Starting runner setup…\n", ownerId));
        return id;
    }

    public void complete(String sessionId, String output) {
        Session s = sessions.get(sessionId);
        if (s != null) sessions.put(sessionId, new Session("DONE", output, s.ownerId()));
    }

    public void fail(String sessionId, String output) {
        Session s = sessions.get(sessionId);
        if (s != null) sessions.put(sessionId, new Session("FAILED", output, s.ownerId()));
    }

    public Session get(String sessionId, Long requestingUserId) {
        Session s = sessions.get(sessionId);
        if (s == null || !s.ownerId().equals(requestingUserId)) return null;
        return s;
    }
}
