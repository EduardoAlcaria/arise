package com.automationcenter.service;

import com.automationcenter.entity.AuditEntry;
import com.automationcenter.entity.User;
import com.automationcenter.repository.AuditEntryRepository;
import com.automationcenter.util.SecretRedactor;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Records who/what/when for every mutating controller endpoint (POST/PUT/DELETE/PATCH).
 * Never fails the underlying request — audit persistence errors are logged and swallowed.
 */
@Aspect
@Component
@RequiredArgsConstructor
@Slf4j
public class AuditAspect {

    private final AuditEntryRepository auditEntryRepository;

    @Around("within(com.automationcenter.controller..*) && "
            + "(@annotation(org.springframework.web.bind.annotation.PostMapping) "
            + "|| @annotation(org.springframework.web.bind.annotation.PutMapping) "
            + "|| @annotation(org.springframework.web.bind.annotation.DeleteMapping) "
            + "|| @annotation(org.springframework.web.bind.annotation.PatchMapping))")
    public Object audit(ProceedingJoinPoint pjp) throws Throwable {
        HttpServletRequest request = currentRequest();
        String httpMethod = request != null ? request.getMethod() : "?";
        String path = request != null ? request.getRequestURI() : pjp.getSignature().toShortString();

        try {
            Object result = pjp.proceed();
            recordAudit(httpMethod, path, true, null);
            return result;
        } catch (Throwable t) {
            recordAudit(httpMethod, path, false, t.getMessage());
            throw t;
        }
    }

    private void recordAudit(String httpMethod, String path, boolean success, String errorMessage) {
        try {
            Long userId = null;
            String username = "anonymous";
            var auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.getPrincipal() instanceof User user) {
                userId = user.getId();
                username = user.getEmail();
            }
            auditEntryRepository.save(AuditEntry.builder()
                    .userId(userId)
                    .username(username)
                    .httpMethod(httpMethod)
                    .path(path)
                    .success(success)
                    .errorMessage(SecretRedactor.redact(errorMessage))
                    .build());
        } catch (Exception e) {
            log.warn("Failed to persist audit entry for {} {}: {}", httpMethod, path, e.getMessage());
        }
    }

    private HttpServletRequest currentRequest() {
        var attrs = RequestContextHolder.getRequestAttributes();
        return attrs instanceof ServletRequestAttributes sra ? sra.getRequest() : null;
    }
}
