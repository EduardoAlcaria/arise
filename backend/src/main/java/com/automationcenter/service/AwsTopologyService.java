package com.automationcenter.service;

import com.automationcenter.entity.AwsAccount;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.AwsAccountRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.auth.credentials.ProfileCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.ec2.Ec2Client;
import software.amazon.awssdk.services.ec2.model.*;
import software.amazon.awssdk.services.ecs.EcsClient;
import software.amazon.awssdk.services.ecs.model.DescribeClustersRequest;
import software.amazon.awssdk.services.lambda.LambdaClient;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class AwsTopologyService {

    private final AwsAccountRepository accountRepository;
    private final TerraformParserService terraformParserService;

    public Map<String, Object> getTopology(Long userId, Long accountId, String region) {
        AwsAccount account = accountRepository.findByIdAndOwnerId(accountId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("AWS account not found"));
        String effectiveRegion = region != null ? region : account.getDefaultRegion();

        List<Map<String, Object>> nodes = new ArrayList<>();
        List<Map<String, Object>> edges = new ArrayList<>();

        ProfileCredentialsProvider creds = ProfileCredentialsProvider.create(account.getProfileName());

        // VPCs
        try (Ec2Client ec2 = Ec2Client.builder().credentialsProvider(creds).region(Region.of(effectiveRegion)).build()) {
            collectVpcTopology(ec2, effectiveRegion, nodes, edges);
            collectEc2Topology(ec2, effectiveRegion, nodes, edges);
        } catch (Exception e) {
            log.warn("EC2/VPC topology fetch failed: {}", e.getMessage());
        }

        // Lambda
        try (LambdaClient lambda = LambdaClient.builder().credentialsProvider(creds).region(Region.of(effectiveRegion)).build()) {
            lambda.listFunctionsPaginator().functions().forEach(fn -> {
                Map<String, Object> node = new LinkedHashMap<>();
                node.put("id", "lambda:" + fn.functionName());
                node.put("label", fn.functionName());
                node.put("service", "lambda");
                node.put("source", "live");
                node.put("runtime", fn.runtimeAsString());
                node.put("lastModified", fn.lastModified());
                nodes.add(node);
            });
        } catch (Exception e) {
            log.warn("Lambda topology fetch failed: {}", e.getMessage());
        }

        // ECS Clusters
        try (EcsClient ecs = EcsClient.builder().credentialsProvider(creds).region(Region.of(effectiveRegion)).build()) {
            List<String> clusterArns = ecs.listClusters().clusterArns();
            if (!clusterArns.isEmpty()) {
                ecs.describeClusters(DescribeClustersRequest.builder().clusters(clusterArns).build())
                        .clusters().forEach(c -> {
                            Map<String, Object> node = new LinkedHashMap<>();
                            node.put("id", "ecs:" + c.clusterName());
                            node.put("label", c.clusterName());
                            node.put("service", "ecs");
                            node.put("source", "live");
                            node.put("status", c.status());
                            node.put("runningTasksCount", c.runningTasksCount());
                            nodes.add(node);
                        });
            }
        } catch (Exception e) {
            log.warn("ECS topology fetch failed: {}", e.getMessage());
        }

        // Terraform overlay
        if (account.getTerraformRepoUrl() != null && !account.getTerraformRepoUrl().isBlank()) {
            try {
                List<Map<String, Object>> tfNodes = terraformParserService.parseRepo(account.getTerraformRepoUrl());
                for (Map<String, Object> tfNode : tfNodes) {
                    String tfId = (String) tfNode.get("id");
                    boolean alreadyExists = nodes.stream().anyMatch(n -> tfId.equals(n.get("id")));
                    if (!alreadyExists) nodes.add(tfNode);
                }
            } catch (Exception e) {
                log.warn("Terraform overlay failed: {}", e.getMessage());
            }
        }

        return Map.of("nodes", nodes, "edges", edges, "region", effectiveRegion);
    }

    private void collectVpcTopology(Ec2Client ec2, String region, List<Map<String, Object>> nodes, List<Map<String, Object>> edges) {
        ec2.describeVpcs().vpcs().forEach(vpc -> {
            String name = tagName(vpc.tags(), vpc.vpcId());
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", "vpc:" + vpc.vpcId());
            node.put("label", name);
            node.put("service", "vpc");
            node.put("source", "live");
            node.put("cidr", vpc.cidrBlock());
            node.put("state", vpc.stateAsString());
            nodes.add(node);
        });

        ec2.describeSubnets().subnets().forEach(sub -> {
            String name = tagName(sub.tags(), sub.subnetId());
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", "subnet:" + sub.subnetId());
            node.put("label", name);
            node.put("service", "subnet");
            node.put("source", "live");
            node.put("cidr", sub.cidrBlock());
            node.put("az", sub.availabilityZone());
            nodes.add(node);
            edges.add(edge("vpc:" + sub.vpcId(), "subnet:" + sub.subnetId(), "contains"));
        });

        ec2.describeSecurityGroups().securityGroups().forEach(sg -> {
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", "sg:" + sg.groupId());
            node.put("label", sg.groupName());
            node.put("service", "security_group");
            node.put("source", "live");
            node.put("description", sg.description());
            nodes.add(node);
            edges.add(edge("vpc:" + sg.vpcId(), "sg:" + sg.groupId(), "contains"));
        });
    }

    private void collectEc2Topology(Ec2Client ec2, String region, List<Map<String, Object>> nodes, List<Map<String, Object>> edges) {
        ec2.describeInstances().reservations().stream()
                .flatMap(r -> r.instances().stream())
                .filter(i -> !"terminated".equals(i.state().nameAsString()))
                .forEach(i -> {
                    String name = tagName(i.tags(), i.instanceId());
                    Map<String, Object> node = new LinkedHashMap<>();
                    node.put("id", "ec2:" + i.instanceId());
                    node.put("label", name);
                    node.put("service", "ec2");
                    node.put("source", "live");
                    node.put("state", i.state().nameAsString());
                    node.put("instanceType", i.instanceTypeAsString());
                    node.put("privateIp", i.privateIpAddress());
                    nodes.add(node);
                    if (i.subnetId() != null)
                        edges.add(edge("subnet:" + i.subnetId(), "ec2:" + i.instanceId(), "hosts"));
                });
    }

    private String tagName(List<software.amazon.awssdk.services.ec2.model.Tag> tags, String fallback) {
        return tags.stream()
                .filter(t -> "Name".equals(t.key()))
                .map(software.amazon.awssdk.services.ec2.model.Tag::value)
                .findFirst().orElse(fallback);
    }

    private Map<String, Object> edge(String from, String to, String label) {
        return Map.of("id", from + "->" + to, "source", from, "target", to, "label", label);
    }
}
