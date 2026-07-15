package com.automationcenter.controller;

import com.automationcenter.dto.auth.AuthResponse;
import com.automationcenter.exception.EmailAlreadyExistsException;
import com.automationcenter.security.JwtAuthFilter;
import com.automationcenter.service.AuthService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(AuthController.class)
@AutoConfigureMockMvc(addFilters = false)
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private AuthService authService;

    @MockBean
    private JwtAuthFilter jwtAuthFilter;

    @MockBean
    private UserDetailsService userDetailsService;

    @Test
    void registerReturnsTokenOnSuccess() throws Exception {
        when(authService.register(any())).thenReturn(
                new AuthResponse("jwt-token", "new@example.com", "New User", "USER"));

        mockMvc.perform(post("/api/auth/register")
                        .contentType("application/json")
                        .content("""
                                {"name":"New User","email":"new@example.com","password":"secret1"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").value("jwt-token"))
                .andExpect(jsonPath("$.email").value("new@example.com"));
    }

    @Test
    void registerRejectsBlankFields() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .contentType("application/json")
                        .content("""
                                {"name":"","email":"not-an-email","password":"a"}
                                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void registerReturnsConflictWhenEmailTaken() throws Exception {
        when(authService.register(any())).thenThrow(new EmailAlreadyExistsException("dup@example.com"));

        mockMvc.perform(post("/api/auth/register")
                        .contentType("application/json")
                        .content("""
                                {"name":"Dup","email":"dup@example.com","password":"secret1"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409));
    }

    @Test
    void loginReturnsTokenOnSuccess() throws Exception {
        when(authService.login(any())).thenReturn(
                new AuthResponse("jwt-token", "user@example.com", "User", "USER"));

        mockMvc.perform(post("/api/auth/login")
                        .contentType("application/json")
                        .content("""
                                {"email":"user@example.com","password":"secret1"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").value("jwt-token"));
    }

    @Test
    void loginReturnsUnauthorizedOnBadCredentials() throws Exception {
        when(authService.login(any())).thenThrow(new BadCredentialsException("bad creds"));

        mockMvc.perform(post("/api/auth/login")
                        .contentType("application/json")
                        .content("""
                                {"email":"user@example.com","password":"wrong"}
                                """))
                .andExpect(status().isUnauthorized());
    }
}
