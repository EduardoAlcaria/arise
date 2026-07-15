package com.automationcenter.controller;

import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.DeploymentType;
import com.automationcenter.entity.Role;
import com.automationcenter.entity.User;
import com.automationcenter.repository.DeploymentRepository;
import com.automationcenter.repository.UserRepository;
import com.automationcenter.security.JwtAuthFilter;
import com.automationcenter.service.DeploymentService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(WebhookController.class)
@AutoConfigureMockMvc(addFilters = false)
class WebhookControllerTest {

    private static final String SECRET = "shhh-its-a-secret";

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserRepository userRepository;

    @MockBean
    private DeploymentRepository deploymentRepository;

    @MockBean
    private DeploymentService deploymentService;

    @MockBean
    private JwtAuthFilter jwtAuthFilter;

    @MockBean
    private UserDetailsService userDetailsService;

    private static String sign(String body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return "sha256=" + HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
    }

    private static User userWithSecret() {
        return User.builder().id(1L).email("u@example.com").role(Role.USER)
                .webhookToken("tok-123").webhookSecret(SECRET).build();
    }

    @Test
    void unknownTokenReturnsNotFound() throws Exception {
        when(userRepository.findByWebhookToken("missing")).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/webhooks/github/missing")
                        .header("X-GitHub-Event", "push")
                        .content("{}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void invalidSignatureReturnsUnauthorized() throws Exception {
        when(userRepository.findByWebhookToken("tok-123")).thenReturn(Optional.of(userWithSecret()));
        String body = "{\"ref\":\"refs/heads/main\"}";

        mockMvc.perform(post("/api/webhooks/github/tok-123")
                        .header("X-GitHub-Event", "push")
                        .header("X-Hub-Signature-256", "sha256=deadbeef")
                        .content(body))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(deploymentService);
    }

    @Test
    void missingSignatureReturnsUnauthorized() throws Exception {
        when(userRepository.findByWebhookToken("tok-123")).thenReturn(Optional.of(userWithSecret()));

        mockMvc.perform(post("/api/webhooks/github/tok-123")
                        .header("X-GitHub-Event", "push")
                        .content("{}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void validPushTriggersRedeployForMatchingDeployment() throws Exception {
        User user = userWithSecret();
        when(userRepository.findByWebhookToken("tok-123")).thenReturn(Optional.of(user));

        Deployment match = Deployment.builder()
                .id(42L).name("d").type(DeploymentType.REPOSITORY)
                .repositoryUrl("https://github.com/acme/widgets").branch("main").build();
        when(deploymentRepository.findByOwnerId(1L)).thenReturn(List.of(match));

        String body = """
                {"ref":"refs/heads/main","repository":{"html_url":"https://github.com/acme/widgets"}}
                """;

        mockMvc.perform(post("/api/webhooks/github/tok-123")
                        .header("X-GitHub-Event", "push")
                        .header("X-Hub-Signature-256", sign(body))
                        .content(body))
                .andExpect(status().isOk());

        verify(deploymentService).redeploy(42L, 1L);
    }

    @Test
    void validSignatureNonPushEventDoesNotRedeploy() throws Exception {
        when(userRepository.findByWebhookToken("tok-123")).thenReturn(Optional.of(userWithSecret()));
        String body = "{\"zen\":\"ping\"}";

        mockMvc.perform(post("/api/webhooks/github/tok-123")
                        .header("X-GitHub-Event", "ping")
                        .header("X-Hub-Signature-256", sign(body))
                        .content(body))
                .andExpect(status().isOk());

        verify(deploymentService, never()).redeploy(anyLong(), anyLong());
    }
}
