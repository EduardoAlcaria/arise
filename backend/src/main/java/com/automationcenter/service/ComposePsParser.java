package com.automationcenter.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;

/**
 * Parses `docker compose ps --format json` output and identifies services that
 * are not healthy. A service is healthy when it is running, or when it has exited
 * cleanly with code 0 (run-once jobs: migrations, seeders, init containers).
 * Blank/unparseable input yields an empty list — callers decide what an empty
 * reading means (the deploy health gate treats "no positive reading" as a failure).
 */
public final class ComposePsParser {

    private ComposePsParser() {}

    /** exitCode is null when docker did not report one (e.g. still running). */
    public record ServiceState(String service, String state, Integer exitCode) {}

    public static List<ServiceState> parse(String output, ObjectMapper mapper) {
        List<ServiceState> result = new ArrayList<>();
        if (output == null || output.isBlank()) return result;
        String trimmed = output.trim();
        try {
            if (trimmed.startsWith("[")) {
                for (JsonNode node : mapper.readTree(trimmed)) {
                    result.add(toState(node));
                }
            } else {
                for (String line : trimmed.split("\\R")) {
                    if (line.isBlank()) continue;
                    String t = line.trim();
                    if (!t.startsWith("{")) continue; // skip non-JSON lines
                    result.add(toState(mapper.readTree(t)));
                }
            }
        } catch (Exception e) {
            return new ArrayList<>(); // unparseable -> empty
        }
        return result;
    }

    public static List<ServiceState> unhealthy(List<ServiceState> states) {
        return states.stream()
                .filter(s -> !isHealthy(s))
                .toList();
    }

    /** Healthy = running, or exited cleanly with code 0 (run-once containers). */
    private static boolean isHealthy(ServiceState s) {
        if ("running".equalsIgnoreCase(s.state())) return true;
        return "exited".equalsIgnoreCase(s.state())
                && s.exitCode() != null && s.exitCode() == 0;
    }

    private static ServiceState toState(JsonNode node) {
        String svc = node.hasNonNull("Service") ? node.get("Service").asText()
                : node.hasNonNull("Name") ? node.get("Name").asText()
                : "unknown";
        String state = node.hasNonNull("State") ? node.get("State").asText() : "unknown";
        Integer exitCode = node.hasNonNull("ExitCode") ? node.get("ExitCode").asInt() : null;
        return new ServiceState(svc, state, exitCode);
    }
}
