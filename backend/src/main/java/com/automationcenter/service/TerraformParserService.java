package com.automationcenter.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@Slf4j
public class TerraformParserService {

    private static final Pattern RESOURCE_PATTERN =
            Pattern.compile("resource\\s+\"([^\"]+)\"\\s+\"([^\"]+)\"");
    private static final Pattern MODULE_PATTERN =
            Pattern.compile("module\\s+\"([^\"]+)\"");
    private static final Pattern TAG_NAME_PATTERN =
            Pattern.compile("Name\\s*=\\s*\"([^\"]+)\"");

    public List<Map<String, Object>> parseRepo(String repoUrl) {
        Path tempDir = null;
        try {
            tempDir = Files.createTempDirectory("tf-parse-");
            cloneRepo(repoUrl, tempDir);
            return parseTfFiles(tempDir);
        } catch (Exception e) {
            log.error("Failed to parse Terraform repo {}: {}", repoUrl, e.getMessage());
            throw new IllegalArgumentException("Failed to parse Terraform repo: " + e.getMessage());
        } finally {
            if (tempDir != null) deleteDirQuietly(tempDir.toFile());
        }
    }

    private void cloneRepo(String repoUrl, Path target) throws IOException, InterruptedException {
        ProcessBuilder pb = new ProcessBuilder("git", "clone", "--depth=1", repoUrl, target.toString());
        pb.redirectErrorStream(true);
        Process p = pb.start();
        int exit = p.waitFor();
        if (exit != 0) {
            String out = new String(p.getInputStream().readAllBytes());
            throw new IllegalArgumentException("git clone failed (exit " + exit + "): " + out);
        }
    }

    private List<Map<String, Object>> parseTfFiles(Path root) throws IOException {
        List<Map<String, Object>> nodes = new ArrayList<>();
        Files.walk(root)
                .filter(p -> p.toString().endsWith(".tf"))
                .forEach(tf -> {
                    try {
                        String content = Files.readString(tf);
                        String relPath = root.relativize(tf).toString();
                        extractResources(content, relPath, nodes);
                        extractModules(content, relPath, nodes);
                    } catch (IOException e) {
                        log.warn("Could not read {}: {}", tf, e.getMessage());
                    }
                });
        return nodes;
    }

    private void extractResources(String content, String filePath, List<Map<String, Object>> nodes) {
        Matcher m = RESOURCE_PATTERN.matcher(content);
        while (m.find()) {
            String resourceType = m.group(1);
            String resourceName = m.group(2);
            int end = Math.min(m.end() + 300, content.length());
            String snippet = content.substring(m.start(), end);
            String displayName = findTagName(snippet);

            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", "tf:" + resourceType + ":" + resourceName);
            node.put("source", "terraform");
            node.put("resourceType", resourceType);
            node.put("resourceName", resourceName);
            node.put("label", displayName != null ? displayName : resourceName);
            node.put("service", resourceTypeToService(resourceType));
            node.put("file", filePath);
            nodes.add(node);
        }
    }

    private void extractModules(String content, String filePath, List<Map<String, Object>> nodes) {
        Matcher m = MODULE_PATTERN.matcher(content);
        while (m.find()) {
            String moduleName = m.group(1);
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", "tf:module:" + moduleName);
            node.put("source", "terraform");
            node.put("resourceType", "module");
            node.put("resourceName", moduleName);
            node.put("label", moduleName);
            node.put("service", "module");
            node.put("file", filePath);
            nodes.add(node);
        }
    }

    private String findTagName(String snippet) {
        Matcher m = TAG_NAME_PATTERN.matcher(snippet);
        return m.find() ? m.group(1) : null;
    }

    private String resourceTypeToService(String resourceType) {
        if (resourceType.startsWith("aws_lambda")) return "lambda";
        if (resourceType.startsWith("aws_ecs")) return "ecs";
        if (resourceType.startsWith("aws_rds") || resourceType.startsWith("aws_db")) return "rds";
        if (resourceType.startsWith("aws_s3")) return "s3";
        if (resourceType.startsWith("aws_vpc") || resourceType.startsWith("aws_subnet")
                || resourceType.startsWith("aws_security_group")) return "vpc";
        if (resourceType.startsWith("aws_api_gateway") || resourceType.startsWith("aws_apigatewayv2")) return "apigateway";
        if (resourceType.startsWith("aws_sqs")) return "sqs";
        if (resourceType.startsWith("aws_sns")) return "sns";
        if (resourceType.startsWith("aws_dynamodb")) return "dynamodb";
        if (resourceType.startsWith("aws_cloudfront")) return "cloudfront";
        if (resourceType.startsWith("aws_iam")) return "iam";
        if (resourceType.startsWith("aws_ec2") || resourceType.startsWith("aws_instance")) return "ec2";
        return "other";
    }

    private void deleteDirQuietly(File dir) {
        try {
            Files.walk(dir.toPath())
                    .sorted(java.util.Comparator.reverseOrder())
                    .map(Path::toFile)
                    .forEach(File::delete);
        } catch (IOException ignored) {}
    }
}
