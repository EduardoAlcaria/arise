package com.automationcenter.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SecretRedactorTest {

    @Test
    void redactsTokenEmbeddedInGithubCloneUrl() {
        String input = "fatal: Authentication failed for 'https://ghp_abc123XYZ@github.com/acme/widgets.git/'";
        assertThat(SecretRedactor.redact(input))
                .isEqualTo("fatal: Authentication failed for 'https://github.com/acme/widgets.git/'");
    }

    @Test
    void redactsBareGithubTokenByPrefix() {
        String input = "using token ghp_1234567890abcdefghijklmnop for auth";
        assertThat(SecretRedactor.redact(input)).isEqualTo("using token ***REDACTED-GITHUB-TOKEN*** for auth");
    }

    @Test
    void redactsGithubFineGrainedPatToken() {
        String input = "token=github_pat_11ABCDEFG0123456789012345678901234567890abcdefghijklmnop";
        assertThat(SecretRedactor.redact(input)).isEqualTo("token=***REDACTED-GITHUB-TOKEN***");
    }

    @Test
    void redactsAwsAccessKeyId() {
        String input = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
        assertThat(SecretRedactor.redact(input)).isEqualTo("AWS_ACCESS_KEY_ID=***REDACTED-AWS-KEY***");
    }

    @Test
    void redactsBearerTokenButKeepsScheme() {
        String input = "Authorization: Bearer abc123.def456-ghi789";
        assertThat(SecretRedactor.redact(input)).isEqualTo("Authorization: Bearer ***REDACTED***");
    }

    @Test
    void leavesOrdinaryTextUntouched() {
        String input = "Running build: docker compose up --build -d";
        assertThat(SecretRedactor.redact(input)).isEqualTo(input);
    }

    @Test
    void handlesNullAndEmptyGracefully() {
        assertThat(SecretRedactor.redact(null)).isNull();
        assertThat(SecretRedactor.redact("")).isEmpty();
    }
}
