package com.automationcenter.service;

import com.automationcenter.entity.AuditEntry;
import com.automationcenter.entity.User;
import com.automationcenter.repository.AuditEntryRepository;
import com.automationcenter.util.SecretRedactor;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;

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
    private final ObjectMapper objectMapper;

    private static final int MAX_BODY_LENGTH = 4000;

    // Catches secret-shaped JSON fields (privateKey, githubToken, password, JWT in login
    // responses, ...) by key name, at any nesting depth and regardless of value type —
    // SecretRedactor only matches known token *formats* inside free text, not field identity.
    private static final java.util.Set<String> SENSITIVE_KEYWORDS = java.util.Set.of(
            "key", "secret", "token", "password", "credential", "authorization",
            "bearer", "cookie", "session", "otp", "pin", "hash", "refresh", "access");

    @Around("within(com.automationcenter.controller..*) && "
            + "(@annotation(org.springframework.web.bind.annotation.PostMapping) "
            + "|| @annotation(org.springframework.web.bind.annotation.PutMapping) "
            + "|| @annotation(org.springframework.web.bind.annotation.DeleteMapping) "
            + "|| @annotation(org.springframework.web.bind.annotation.PatchMapping))")
    public Object audit(ProceedingJoinPoint pjp) throws Throwable {
        HttpServletRequest request = currentRequest();
        String httpMethod = request != null ? request.getMethod() : "?";
        String path = request != null ? request.getRequestURI() : pjp.getSignature().toShortString();
        String requestBody = serialize(pjp.getArgs());

        try {
            Object result = pjp.proceed();
            recordAudit(httpMethod, path, true, null, requestBody, serialize(unwrapBody(result)));
            return result;
        } catch (Throwable t) {
            recordAudit(httpMethod, path, false, t.getMessage(), requestBody, null);
            throw t;
        }
    }

    private Object unwrapBody(Object result) {
        return result instanceof ResponseEntity<?> re ? re.getBody() : result;
    }

    /** Best-effort JSON serialization for audit visibility — never fails the request. */
    private String serialize(Object value) {
        if (value == null) return null;
        Object[] values = value instanceof Object[] arr ? arr : new Object[]{value};
        Object[] filtered = java.util.Arrays.stream(values)
                .filter(v -> !(v instanceof User) && !(v instanceof HttpServletRequest) && !(v instanceof MultipartFile))
                .toArray();
        if (filtered.length == 0) return null;
        try {
            Object toWrite = value instanceof Object[] ? filtered : filtered[0];
            JsonNode tree = objectMapper.valueToTree(toWrite);
            redactSensitiveFields(tree);
            String redacted = SecretRedactor.redact(objectMapper.writeValueAsString(tree));
            return redacted.length() > MAX_BODY_LENGTH ? redacted.substring(0, MAX_BODY_LENGTH) + "…" : redacted;
        } catch (Exception e) {
            return null;
        }
    }

    /** Walks the JSON tree and blanks any field whose name looks sensitive, at any depth,
     * regardless of whether the value is a string, number, or nested object/array. */
    private void redactSensitiveFields(JsonNode node) {
        if (node.isObject()) {
            ObjectNode obj = (ObjectNode) node;
            var fieldNames = new java.util.ArrayList<String>();
            obj.fieldNames().forEachRemaining(fieldNames::add);
            for (String name : fieldNames) {
                if (isSensitiveKey(name)) {
                    obj.put(name, "***REDACTED***");
                } else {
                    redactSensitiveFields(obj.get(name));
                }
            }
        } else if (node.isArray()) {
            node.forEach(this::redactSensitiveFields);
        }
    }

    private boolean isSensitiveKey(String name) {
        String lower = name.toLowerCase();
        return SENSITIVE_KEYWORDS.stream().anyMatch(lower::contains);
    }

    private void recordAudit(String httpMethod, String path, boolean success, String errorMessage,
                              String requestBody, String responseBody) {
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
                    .requestBody(requestBody)
                    .responseBody(responseBody)
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
