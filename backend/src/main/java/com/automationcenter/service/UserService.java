package com.automationcenter.service;

import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;

    @Transactional
    public Map<String, String> getOrCreateWebhookCredentials(Long userId) {
        var user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        boolean changed = false;
        if (user.getWebhookToken() == null) {
            user.setWebhookToken(UUID.randomUUID().toString());
            changed = true;
        }
        if (user.getWebhookSecret() == null) {
            user.setWebhookSecret(UUID.randomUUID().toString());
            changed = true;
        }
        if (changed) userRepository.save(user);
        return Map.of("webhookToken", user.getWebhookToken(), "webhookSecret", user.getWebhookSecret());
    }
}
