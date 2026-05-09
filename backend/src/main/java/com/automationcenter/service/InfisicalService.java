package com.automationcenter.service;

import com.automationcenter.dto.infisical.InfisicalSecret;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class InfisicalService {

    private final UserRepository userRepository;
    private final WebClient.Builder webClientBuilder;

    public String authenticate(String clientId, String clientSecret, String baseUrl) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> response = webClientBuilder.build()
                    .post()
                    .uri(baseUrl + "/api/v1/auth/universal-auth/login")
                    .bodyValue(Map.of("clientId", clientId, "clientSecret", clientSecret))
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

            if (response == null) return null;
            return (String) response.get("accessToken");
        } catch (Exception e) {
            log.error("Infisical authentication failed: {}", e.getMessage());
            return null;
        }
    }

    public List<InfisicalSecret> listSecrets(Long userId, String projectId, String environment, String secretPath) {
        User user = getUser(userId);
        String base = resolveBaseUrl(user);

        String accessToken = authenticate(user.getInfisicalClientId(), user.getInfisicalClientSecret(), base);
        if (accessToken == null) {
            log.error("Could not authenticate with Infisical for user {}", userId);
            return List.of();
        }

        try {
            String url = base + "/api/v3/secrets/raw"
                    + "?workspaceId=" + java.net.URLEncoder.encode(projectId, java.nio.charset.StandardCharsets.UTF_8)
                    + "&environment=" + java.net.URLEncoder.encode(environment, java.nio.charset.StandardCharsets.UTF_8)
                    + "&secretPath=" + java.net.URLEncoder.encode(secretPath, java.nio.charset.StandardCharsets.UTF_8);

            @SuppressWarnings("unchecked")
            Map<String, Object> response = webClientBuilder.build()
                    .get()
                    .uri(url)
                    .header("Authorization", "Bearer " + accessToken)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

            if (response == null) return List.of();

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> secrets = (List<Map<String, Object>>) response.get("secrets");
            if (secrets == null) return List.of();

            return secrets.stream()
                    .map(s -> new InfisicalSecret(
                            (String) s.get("secretName"),
                            (String) s.get("secretValue")
                    ))
                    .toList();
        } catch (Exception e) {
            log.error("Could not list Infisical secrets for user {}: {}", userId, e.getMessage());
            return List.of();
        }
    }

    public void saveCredentials(Long userId, String clientId, String clientSecret, String baseUrl, String projectId) {
        User user = getUser(userId);
        user.setInfisicalClientId(clientId);
        user.setInfisicalClientSecret(clientSecret);
        user.setInfisicalBaseUrl(baseUrl != null && !baseUrl.isBlank() ? baseUrl : "https://app.infisical.com");
        user.setInfisicalProjectId(projectId);
        userRepository.save(user);
    }

    public boolean hasCredentials(Long userId) {
        User user = getUser(userId);
        return user.getInfisicalClientId() != null && !user.getInfisicalClientId().isBlank()
                && user.getInfisicalClientSecret() != null && !user.getInfisicalClientSecret().isBlank();
    }

    private String resolveBaseUrl(User user) {
        String base = user.getInfisicalBaseUrl();
        return (base != null && !base.isBlank()) ? base : "https://app.infisical.com";
    }

    private User getUser(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }
}
