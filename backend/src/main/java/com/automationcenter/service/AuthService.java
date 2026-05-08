package com.automationcenter.service;

import com.automationcenter.dto.auth.AuthResponse;
import com.automationcenter.dto.auth.LoginRequest;
import com.automationcenter.dto.auth.RegisterRequest;
import com.automationcenter.entity.Role;
import com.automationcenter.entity.User;
import com.automationcenter.exception.EmailAlreadyExistsException;
import com.automationcenter.repository.UserRepository;
import com.automationcenter.security.JwtService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuthenticationManager authenticationManager;

    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new EmailAlreadyExistsException(request.getEmail());
        }
        User user = User.builder()
                .name(request.getName())
                .email(request.getEmail())
                .password(passwordEncoder.encode(request.getPassword()))
                .role(Role.USER)
                .build();
        userRepository.save(user);
        return new AuthResponse(jwtService.generateToken(user), user.getEmail(), user.getName(), user.getRole().name());
    }

    public AuthResponse login(LoginRequest request) {
        authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(request.getEmail(), request.getPassword())
        );
        User user = userRepository.findByEmail(request.getEmail())
                .orElseThrow(() -> new RuntimeException("User not found"));
        return new AuthResponse(jwtService.generateToken(user), user.getEmail(), user.getName(), user.getRole().name());
    }
}
