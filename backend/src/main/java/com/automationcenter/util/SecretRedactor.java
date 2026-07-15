package com.automationcenter.util;

import java.util.regex.Pattern;

/**
 * Best-effort scrubber for credentials that can end up echoed in command output —
 * GitHub HTTPS clone URLs, GitHub/AWS tokens, and Authorization headers. Applied to
 * deployment logs (and their SSE broadcast), audit log error messages, and the SSH
 * terminal relay. Not a guarantee against every possible secret shape, but catches
 * the known patterns Arise itself injects into commands.
 */
public final class SecretRedactor {

    private SecretRedactor() {}

    private static final Pattern GITHUB_URL_TOKEN = Pattern.compile("https://[^@\\s]+@github\\.com/");
    private static final Pattern GITHUB_TOKEN = Pattern.compile(
            "\\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\\b");
    private static final Pattern AWS_ACCESS_KEY = Pattern.compile("\\bAKIA[0-9A-Z]{16}\\b");
    private static final Pattern BEARER_TOKEN = Pattern.compile(
            "(?i)(Bearer\\s+)[A-Za-z0-9\\-._~+/]+=*");

    public static String redact(String s) {
        if (s == null || s.isEmpty()) return s;
        String out = GITHUB_URL_TOKEN.matcher(s).replaceAll("https://github.com/");
        out = GITHUB_TOKEN.matcher(out).replaceAll("***REDACTED-GITHUB-TOKEN***");
        out = AWS_ACCESS_KEY.matcher(out).replaceAll("***REDACTED-AWS-KEY***");
        out = BEARER_TOKEN.matcher(out).replaceAll("$1***REDACTED***");
        return out;
    }
}
