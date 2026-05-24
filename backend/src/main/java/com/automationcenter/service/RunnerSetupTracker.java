package com.automationcenter.service;

import org.springframework.stereotype.Service;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RunnerSetupTracker {

    public record Session(String status, String output) {}

    private final ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

    public String create() {
        String id = UUID.randomUUID().toString();
        sessions.put(id, new Session("RUNNING", "Starting runner setup…\n"));
        return id;
    }

    public void complete(String sessionId, String output) {
        sessions.put(sessionId, new Session("DONE", output));
    }

    public void fail(String sessionId, String output) {
        sessions.put(sessionId, new Session("FAILED", output));
    }

    public Session get(String sessionId) {
        return sessions.get(sessionId);
    }
}
