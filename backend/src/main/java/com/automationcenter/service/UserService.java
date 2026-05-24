package com.automationcenter.service;

import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;

    @Transactional
    public String getOrCreateWebhookToken(Long userId) {
        var user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getWebhookToken() == null) {
            user.setWebhookToken(UUID.randomUUID().toString());
            userRepository.save(user);
        }
        return user.getWebhookToken();
    }
}
