package com.automationcenter.controller;

import com.automationcenter.dto.deployment.DeploymentResponse;
import com.automationcenter.entity.Role;
import com.automationcenter.entity.User;
import com.automationcenter.security.JwtAuthFilter;
import com.automationcenter.service.DeploymentService;
import com.automationcenter.service.LogBroadcaster;
import com.automationcenter.service.LogService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(DeploymentController.class)
@AutoConfigureMockMvc(addFilters = false)
class DeploymentControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private DeploymentService deploymentService;

    @MockBean
    private LogService logService;

    @MockBean
    private LogBroadcaster logBroadcaster;

    @MockBean
    private JwtAuthFilter jwtAuthFilter;

    @MockBean
    private UserDetailsService userDetailsService;

    private static final User OWNER = User.builder()
            .id(1L).email("owner@example.com").name("Owner").role(Role.USER).build();

    @BeforeEach
    void authenticateAsOwner() {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(OWNER, null, OWNER.getAuthorities()));
    }

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void createReturnsCreatedDeployment() throws Exception {
        when(deploymentService.create(any(), eq(1L))).thenReturn(
                DeploymentResponse.builder().id(10L).name("my-app").status("PENDING").ownerId(1L).build());

        mockMvc.perform(post("/api/deployments")
                        .contentType("application/json")
                        .content("""
                                {"name":"my-app","type":"REPOSITORY","machineId":5}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(10))
                .andExpect(jsonPath("$.name").value("my-app"));
    }

    @Test
    void createRejectsMissingRequiredFields() throws Exception {
        mockMvc.perform(post("/api/deployments")
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void listReturnsPageForOwner() throws Exception {
        Page<DeploymentResponse> page = new PageImpl<>(
                List.of(DeploymentResponse.builder().id(1L).name("a").build()));
        when(deploymentService.listByOwner(eq(1L), any())).thenReturn(page);

        mockMvc.perform(get("/api/deployments"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(1));
    }

    @Test
    void getByIdReturnsDeployment() throws Exception {
        when(deploymentService.getById(eq(10L), eq(1L))).thenReturn(
                DeploymentResponse.builder().id(10L).name("my-app").build());

        mockMvc.perform(get("/api/deployments/10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("my-app"));
    }

    @Test
    void deleteReturnsNoContent() throws Exception {
        mockMvc.perform(delete("/api/deployments/10"))
                .andExpect(status().isNoContent());
    }
}
