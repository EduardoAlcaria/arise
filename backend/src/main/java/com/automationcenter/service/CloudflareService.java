package com.automationcenter.service;

import com.automationcenter.dto.cloudflare.CloudflareTunnelRequest;
import com.automationcenter.dto.cloudflare.CloudflareTunnelResponse;
import com.automationcenter.dto.cloudflare.CloudflareZoneResponse;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class CloudflareService {

    private final UserRepository userRepository;

    @SuppressWarnings("unchecked")
    public void saveToken(Long userId, String token, String accountId) {
        Map<String, Object> verify;
        try {
            verify = buildClient(token)
                    .get()
                    .uri("/user/tokens/verify")
                    .retrieve()
                    .onStatus(status -> !status.is2xxSuccessful(),
                            response -> Mono.error(new IllegalArgumentException(
                                    "Cloudflare rejected the token (HTTP " + response.statusCode().value() + ")")))
                    .bodyToMono(Map.class)
                    .block();
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("Could not verify Cloudflare token: " + e.getMessage());
        }

        if (verify == null || !Boolean.TRUE.equals(verify.get("success"))) {
            List<Map<String, Object>> errors = (List<Map<String, Object>>) verify.get("errors");
            String msg = (errors != null && !errors.isEmpty())
                    ? (String) errors.get(0).get("message")
                    : "Token verification failed";
            throw new IllegalArgumentException("Invalid Cloudflare token: " + msg);
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        user.setCloudflareToken(token);
        user.setCloudflareAccountId(accountId);
        userRepository.save(user);
    }

    @SuppressWarnings("unchecked")
    public List<CloudflareZoneResponse> listZones(Long userId) {
        User user = getUser(userId);
        Map<String, Object> response = buildClient(user.getCloudflareToken())
                .get()
                .uri("/zones")
                .retrieve()
                .bodyToMono(Map.class)
                .block();

        List<Map<String, Object>> results = (List<Map<String, Object>>) response.get("result");
        return results.stream().map(z -> new CloudflareZoneResponse(
                (String) z.get("id"),
                (String) z.get("name"),
                (String) z.get("status"),
                ((Map<String, String>) z.get("account")).get("id")
        )).toList();
    }

    @SuppressWarnings("unchecked")
    public CloudflareTunnelResponse createTunnel(Long userId, CloudflareTunnelRequest request) {
        User user = getUser(userId);
        Map<String, Object> body = Map.of(
                "name", request.getName(),
                "tunnel_secret", request.getTunnelSecret()
        );
        Map<String, Object> response = buildClient(user.getCloudflareToken())
                .post()
                .uri("/accounts/{accountId}/cfd_tunnel", user.getCloudflareAccountId())
                .bodyValue(body)
                .retrieve()
                .bodyToMono(Map.class)
                .block();

        Map<String, Object> result = (Map<String, Object>) response.get("result");
        return new CloudflareTunnelResponse(
                (String) result.get("id"),
                (String) result.get("name"),
                (String) result.get("status"),
                user.getCloudflareAccountId()
        );
    }

    @SuppressWarnings("unchecked")
    public List<CloudflareTunnelResponse> listTunnels(Long userId) {
        User user = getUser(userId);
        Map<String, Object> response = buildClient(user.getCloudflareToken())
                .get()
                .uri("/accounts/{accountId}/cfd_tunnel", user.getCloudflareAccountId())
                .retrieve()
                .bodyToMono(Map.class)
                .block();

        List<Map<String, Object>> results = (List<Map<String, Object>>) response.get("result");
        return results.stream().map(t -> new CloudflareTunnelResponse(
                (String) t.get("id"),
                (String) t.get("name"),
                (String) t.get("status"),
                user.getCloudflareAccountId()
        )).toList();
    }

    @SuppressWarnings("unchecked")
    public String getTunnelToken(Long userId, String tunnelId) {
        User user = getUser(userId);
        Map<String, Object> response = buildClient(user.getCloudflareToken())
                .get()
                .uri("/accounts/{accountId}/cfd_tunnel/{tunnelId}/token", user.getCloudflareAccountId(), tunnelId)
                .retrieve()
                .bodyToMono(Map.class)
                .block();
        return (String) response.get("result");
    }

    @SuppressWarnings("unchecked")
    public void configureTunnelIngress(Long userId, String tunnelId, String hostname, String serviceUrl) {
        User user = getUser(userId);
        Map<String, Object> config = Map.of(
                "config", Map.of(
                        "ingress", List.of(
                                Map.of("hostname", hostname, "service", serviceUrl),
                                Map.of("service", "http_status:404")
                        )
                )
        );
        buildClient(user.getCloudflareToken())
                .put()
                .uri("/accounts/{accountId}/cfd_tunnel/{tunnelId}/configurations",
                        user.getCloudflareAccountId(), tunnelId)
                .bodyValue(config)
                .retrieve()
                .bodyToMono(Map.class)
                .block();
    }

    @SuppressWarnings("unchecked")
    public void createDnsCname(Long userId, String hostname, String tunnelId) {
        User user = getUser(userId);
        // Find zone for the hostname
        String[] parts = hostname.split("\\.");
        String zoneName = parts.length >= 2 ? parts[parts.length - 2] + "." + parts[parts.length - 1] : hostname;
        Map<String, Object> zonesResp = buildClient(user.getCloudflareToken())
                .get()
                .uri("/zones?name={name}", zoneName)
                .retrieve()
                .bodyToMono(Map.class)
                .block();
        List<Map<String, Object>> zones = (List<Map<String, Object>>) zonesResp.get("result");
        if (zones == null || zones.isEmpty()) throw new RuntimeException("No Cloudflare zone found for: " + zoneName);
        String zoneId = (String) zones.get(0).get("id");

        String subdomain = hostname.substring(0, hostname.length() - zoneName.length() - 1);
        Map<String, Object> record = Map.of(
                "type", "CNAME",
                "name", subdomain,
                "content", tunnelId + ".cfargotunnel.com",
                "proxied", true,
                "ttl", 1
        );
        buildClient(user.getCloudflareToken())
                .post()
                .uri("/zones/{zoneId}/dns_records", zoneId)
                .bodyValue(record)
                .retrieve()
                .bodyToMono(Map.class)
                .block();
    }

    private WebClient buildClient(String token) {
        return WebClient.builder()
                .baseUrl("https://api.cloudflare.com/client/v4")
                .defaultHeader("Authorization", "Bearer " + token)
                .defaultHeader("Content-Type", "application/json")
                .build();
    }

    private User getUser(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getCloudflareToken() == null || user.getCloudflareToken().isBlank()) {
            throw new IllegalArgumentException("Cloudflare token not configured. Please save a token first.");
        }
        return user;
    }
}
