package com.automationcenter.config;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Hardcoded mock AWS responses for the demo-profile account.
 * Used by AwsService and AwsTopologyService when the account profile is "demo-profile".
 */
public final class MockAwsData {

    private MockAwsData() {}

    public static List<Map<String, Object>> ec2Instances(String region) {
        return List.of(
                ec2("i-0a1b2c3d4e5f00001", "web-server-prod", "t3.medium", "running", "10.0.1.10", "54.210.11.22", region),
                ec2("i-0a1b2c3d4e5f00002", "app-server-prod", "t3.large",  "running", "10.0.1.11", null,           region),
                ec2("i-0a1b2c3d4e5f00003", "db-server-prod",  "r5.xlarge", "stopped", "10.0.2.5",  null,           region),
                ec2("i-0a1b2c3d4e5f00004", "bastion",         "t3.micro",  "running", "10.0.0.5",  "3.88.41.99",  region)
        );
    }

    public static List<Map<String, Object>> s3Buckets() {
        return List.of(
                s3("demo-static-assets",    "2024-01-15T10:00:00Z"),
                s3("demo-data-lake",        "2024-02-03T08:30:00Z"),
                s3("demo-backups",          "2024-03-22T14:15:00Z"),
                s3("demo-terraform-state",  "2024-01-10T09:00:00Z")
        );
    }

    public static List<Map<String, Object>> ecsClusters(String region) {
        return List.of(
                ecs("arn:aws:ecs:" + region + ":123456789012:cluster/demo-prod-cluster",
                        "demo-prod-cluster", "ACTIVE", 3, 5, region),
                ecs("arn:aws:ecs:" + region + ":123456789012:cluster/demo-staging-cluster",
                        "demo-staging-cluster", "ACTIVE", 1, 1, region)
        );
    }

    public static List<Map<String, Object>> ecsServices(String clusterArn) {
        String region = "us-east-1";
        if (clusterArn.contains("staging")) {
            return List.of(
                    service("arn:aws:ecs:" + region + ":123456789012:service/staging-api",
                            "staging-api", "ACTIVE", 1, 1, "staging-api:12")
            );
        }
        return List.of(
                service("arn:aws:ecs:" + region + ":123456789012:service/frontend",
                        "frontend", "ACTIVE", 2, 2, "frontend-task:34"),
                service("arn:aws:ecs:" + region + ":123456789012:service/backend-api",
                        "backend-api", "ACTIVE", 2, 2, "backend-task:21"),
                service("arn:aws:ecs:" + region + ":123456789012:service/worker",
                        "worker", "ACTIVE", 1, 0, "worker-task:8")  // running < desired → shows red
        );
    }

    public static List<Map<String, Object>> traces() {
        return List.of(
                trace("1-demo0001-abcdef1234567890abcdef12", 0.182, false, false, "GET", "https://api.demo.alcaria.dev/users",         3),
                trace("1-demo0002-abcdef1234567890abcdef13", 0.041, false, false, "GET", "https://api.demo.alcaria.dev/health",        1),
                trace("1-demo0003-abcdef1234567890abcdef14", 1.534, true,  false, "POST","https://api.demo.alcaria.dev/deploy",        4),
                trace("1-demo0004-abcdef1234567890abcdef15", 0.215, false, true,  "GET", "https://api.demo.alcaria.dev/machines/99",   2),
                trace("1-demo0005-abcdef1234567890abcdef16", 0.093, false, false, "PUT", "https://api.demo.alcaria.dev/settings",      1)
        );
    }

    public static Map<String, Object> topology(String region) {
        String vpcId   = "vpc-0demo0000001";
        String subPub  = "subnet-0demo0public";
        String subPriv = "subnet-0demo0private";
        String sg1     = "sg-0demo0web";
        String sg2     = "sg-0demo0db";

        List<Map<String, Object>> nodes = List.of(
                node("vpc:"    + vpcId,   vpcId,              "vpc",            "live", Map.of("cidr","10.0.0.0/16","state","available")),
                node("subnet:" + subPub,  "public-subnet-1a", "subnet",         "live", Map.of("cidr","10.0.1.0/24","az",region+"a")),
                node("subnet:" + subPriv, "private-subnet-1b","subnet",         "live", Map.of("cidr","10.0.2.0/24","az",region+"b")),
                node("sg:"     + sg1,     "web-sg",           "security_group", "live", Map.of("description","HTTP/HTTPS inbound")),
                node("sg:"     + sg2,     "db-sg",            "security_group", "live", Map.of("description","DB access from app")),
                node("ec2:i-0a1b2c3d4e5f00001","web-server-prod","ec2",         "live", Map.of("state","running","instanceType","t3.medium","privateIp","10.0.1.10")),
                node("ec2:i-0a1b2c3d4e5f00002","app-server-prod","ec2",         "live", Map.of("state","running","instanceType","t3.large","privateIp","10.0.1.11")),
                node("ec2:i-0a1b2c3d4e5f00003","db-server-prod", "ec2",         "live", Map.of("state","stopped","instanceType","r5.xlarge","privateIp","10.0.2.5")),
                node("lambda:process-orders",   "process-orders", "lambda",      "live", Map.of("runtime","nodejs20.x","lastModified","2026-04-01T12:00:00")),
                node("lambda:send-notifications","send-notifications","lambda",  "live", Map.of("runtime","python3.12","lastModified","2026-03-15T09:30:00")),
                node("ecs:demo-prod-cluster",   "demo-prod-cluster","ecs",       "live", Map.of("status","ACTIVE","runningTasksCount",5))
        );

        List<Map<String, Object>> edges = List.of(
                edge("vpc:" + vpcId, "subnet:" + subPub,  "contains"),
                edge("vpc:" + vpcId, "subnet:" + subPriv, "contains"),
                edge("vpc:" + vpcId, "sg:" + sg1,         "contains"),
                edge("vpc:" + vpcId, "sg:" + sg2,         "contains"),
                edge("subnet:" + subPub,  "ec2:i-0a1b2c3d4e5f00001", "hosts"),
                edge("subnet:" + subPub,  "ec2:i-0a1b2c3d4e5f00002", "hosts"),
                edge("subnet:" + subPriv, "ec2:i-0a1b2c3d4e5f00003", "hosts")
        );

        return Map.of("nodes", nodes, "edges", edges, "region", region);
    }

    // ── Builders ──────────────────────────────────────────────────────────────

    private static Map<String, Object> ec2(String id, String name, String type,
                                            String state, String privateIp, String publicIp, String region) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("instanceId",   id);
        m.put("name",         name);
        m.put("instanceType", type);
        m.put("state",        state);
        m.put("privateIp",    privateIp);
        m.put("publicIp",     publicIp);
        m.put("launchTime",   "2026-01-01T00:00:00Z");
        m.put("platform",     "Linux/UNIX");
        m.put("region",       region);
        return m;
    }

    private static Map<String, Object> s3(String name, String creationDate) {
        return Map.of("name", name, "creationDate", creationDate);
    }

    private static Map<String, Object> ecs(String arn, String name, String status,
                                            int services, int tasks, String region) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("clusterArn",          arn);
        m.put("clusterName",         name);
        m.put("status",              status);
        m.put("activeServicesCount", services);
        m.put("runningTasksCount",   tasks);
        m.put("region",              region);
        return m;
    }

    private static Map<String, Object> service(String arn, String name, String status,
                                                int desired, int running, String taskDef) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("serviceArn",    arn);
        m.put("serviceName",   name);
        m.put("status",        status);
        m.put("desiredCount",  desired);
        m.put("runningCount",  running);
        m.put("taskDefinition", taskDef);
        return m;
    }

    private static Map<String, Object> trace(String id, double duration, boolean fault,
                                              boolean error, String method, String url, int services) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id",           id);
        m.put("duration",     duration);
        m.put("responseTime", duration);
        m.put("hasFault",     fault);
        m.put("hasError",     error);
        m.put("hasThrottle",  false);
        m.put("method",       method);
        m.put("url",          url);
        m.put("serviceCount", services);
        return m;
    }

    private static Map<String, Object> node(String id, String label, String service,
                                             String source, Map<String, Object> extra) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id",      id);
        m.put("label",   label);
        m.put("service", service);
        m.put("source",  source);
        m.putAll(extra);
        return m;
    }

    private static Map<String, Object> edge(String from, String to, String label) {
        return Map.of("id", from + "->" + to, "source", from, "target", to, "label", label);
    }
}
