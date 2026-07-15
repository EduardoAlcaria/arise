package com.automationcenter.service;

import com.automationcenter.entity.AuditEntry;
import com.automationcenter.entity.Role;
import com.automationcenter.entity.User;
import com.automationcenter.repository.AuditEntryRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuditAspectTest {

    @Mock private AuditEntryRepository auditEntryRepository;
    @Mock private ProceedingJoinPoint joinPoint;
    @Mock private HttpServletRequest request;

    private AuditAspect aspect;

    @BeforeEach
    void setUp() {
        aspect = new AuditAspect(auditEntryRepository);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
        SecurityContextHolder.clearContext();
    }

    @Test
    void recordsSuccessfulMutationWithAuthenticatedUser() throws Throwable {
        when(request.getMethod()).thenReturn("POST");
        when(request.getRequestURI()).thenReturn("/api/deployments");
        User user = User.builder().id(7L).email("dev@example.com").role(Role.USER).build();
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
        when(joinPoint.proceed()).thenReturn("ok");

        Object result = aspect.audit(joinPoint);

        assertThat(result).isEqualTo("ok");
        ArgumentCaptor<AuditEntry> captor = ArgumentCaptor.forClass(AuditEntry.class);
        verify(auditEntryRepository).save(captor.capture());
        AuditEntry saved = captor.getValue();
        assertThat(saved.getUserId()).isEqualTo(7L);
        assertThat(saved.getUsername()).isEqualTo("dev@example.com");
        assertThat(saved.getHttpMethod()).isEqualTo("POST");
        assertThat(saved.getPath()).isEqualTo("/api/deployments");
        assertThat(saved.isSuccess()).isTrue();
        assertThat(saved.getErrorMessage()).isNull();
    }

    @Test
    void recordsFailureAndRethrowsWithoutAuthenticatedUser() throws Throwable {
        when(request.getMethod()).thenReturn("DELETE");
        when(request.getRequestURI()).thenReturn("/api/machines/5");
        RuntimeException boom = new RuntimeException("machine not found");
        when(joinPoint.proceed()).thenThrow(boom);

        org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class, () -> aspect.audit(joinPoint));

        ArgumentCaptor<AuditEntry> captor = ArgumentCaptor.forClass(AuditEntry.class);
        verify(auditEntryRepository).save(captor.capture());
        AuditEntry saved = captor.getValue();
        assertThat(saved.getUserId()).isNull();
        assertThat(saved.getUsername()).isEqualTo("anonymous");
        assertThat(saved.isSuccess()).isFalse();
        assertThat(saved.getErrorMessage()).isEqualTo("machine not found");
    }

    @Test
    void auditFailureDoesNotBreakUnderlyingRequest() throws Throwable {
        when(request.getMethod()).thenReturn("POST");
        when(request.getRequestURI()).thenReturn("/api/deployments");
        when(joinPoint.proceed()).thenReturn("ok");
        when(auditEntryRepository.save(any())).thenThrow(new RuntimeException("db down"));

        Object result = aspect.audit(joinPoint);

        assertThat(result).isEqualTo("ok");
    }
}
