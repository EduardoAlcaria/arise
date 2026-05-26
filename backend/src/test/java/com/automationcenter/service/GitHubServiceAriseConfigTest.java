package com.automationcenter.service;

import com.automationcenter.dto.github.AriseConfig;
import com.automationcenter.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.doReturn;

@ExtendWith(MockitoExtension.class)
class GitHubServiceAriseConfigTest {

    @Mock UserRepository userRepository;
    @Mock WebClient.Builder webClientBuilder;

    private GitHubService spy;

    @BeforeEach
    void setUp() {
        spy = Mockito.spy(new GitHubService(userRepository, webClientBuilder));
    }

    private void mockFile(String content) {
        doReturn(content).when(spy).getFileContent(anyLong(), eq("owner"), eq("repo"), eq(".arise.yml"), eq("main"));
    }

    @Test
    void returnsNullWhenFileAbsent() {
        mockFile("");
        assertNull(spy.getAriseConfig(1L, "owner", "repo", "main"));
    }

    @Test
    void parsesFullConfig() {
        mockFile("""
                compose: docker-compose.prod.yml
                port: 4100
                name: my-app
                branch: prod
                env:
                  - DB_URL
                  - SECRET_KEY
                """);

        AriseConfig cfg = spy.getAriseConfig(1L, "owner", "repo", "main");

        assertNotNull(cfg);
        assertEquals("docker-compose.prod.yml", cfg.compose());
        assertEquals(4100, cfg.port());
        assertEquals("my-app", cfg.name());
        assertEquals("prod", cfg.branch());
        assertEquals(List.of("DB_URL", "SECRET_KEY"), cfg.env());
    }

    @Test
    void parsesComposeOnly() {
        mockFile("compose: docker-compose.prod.yml\n");

        AriseConfig cfg = spy.getAriseConfig(1L, "owner", "repo", "main");

        assertNotNull(cfg);
        assertEquals("docker-compose.prod.yml", cfg.compose());
        assertNull(cfg.port());
        assertNull(cfg.name());
        assertNull(cfg.branch());
        assertTrue(cfg.env().isEmpty());
    }

    @Test
    void parsesPortAsInteger() {
        mockFile("port: 8080\n");

        AriseConfig cfg = spy.getAriseConfig(1L, "owner", "repo", "main");

        assertNotNull(cfg);
        assertEquals(8080, cfg.port());
    }

    @Test
    void parsesEnvList() {
        mockFile("""
                env:
                  - DB_HOST
                  - DB_PORT
                  - JWT_SECRET
                """);

        AriseConfig cfg = spy.getAriseConfig(1L, "owner", "repo", "main");

        assertNotNull(cfg);
        assertEquals(List.of("DB_HOST", "DB_PORT", "JWT_SECRET"), cfg.env());
        assertNull(cfg.compose());
    }

    @Test
    void returnsNullOnMalformedYaml() {
        mockFile(": bad : yaml ::: {{{");

        assertNull(spy.getAriseConfig(1L, "owner", "repo", "main"));
    }

    @Test
    void returnsNullOnBlankContent() {
        mockFile("   \n\n  ");

        assertNull(spy.getAriseConfig(1L, "owner", "repo", "main"));
    }

    @Test
    void handlesEmptyYamlDocument() {
        mockFile("{}");

        AriseConfig cfg = spy.getAriseConfig(1L, "owner", "repo", "main");

        assertNotNull(cfg);
        assertNull(cfg.compose());
        assertNull(cfg.port());
        assertTrue(cfg.env().isEmpty());
    }

    @Test
    void ignoresUnknownFields() {
        mockFile("""
                compose: docker-compose.yml
                unknown_field: some_value
                another: 123
                """);

        AriseConfig cfg = spy.getAriseConfig(1L, "owner", "repo", "main");

        assertNotNull(cfg);
        assertEquals("docker-compose.yml", cfg.compose());
    }
}
