package com.automationcenter.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;

/**
 * Parses `docker compose ps --format json` output and identifies services that
 * are not in a running state. Conservative: blank/unparseable input yields an
 * empty list, so callers never produce a false failure from a missing parse.
 */
public final class ComposePsParser {

    private ComposePsParser() {}

    public record ServiceState(String service, String state) {}

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
                .filter(s -> !"running".equalsIgnoreCase(s.state()))
                .toList();
    }

    private static ServiceState toState(JsonNode node) {
        String svc = node.hasNonNull("Service") ? node.get("Service").asText()
                : node.hasNonNull("Name") ? node.get("Name").asText()
                : "unknown";
        String state = node.hasNonNull("State") ? node.get("State").asText() : "unknown";
        return new ServiceState(svc, state);
    }
}
