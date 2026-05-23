package com.automationcenter.service;

import com.automationcenter.entity.*;
import com.automationcenter.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
public class TopologyService {

    private final MachineRepository machineRepository;
    private final DeploymentRepository deploymentRepository;
    private final ContainerDeploymentRepository containerRepository;

    public record TopologyNode(String id, String type, String label, String status, Map<String, Object> meta) {}
    public record TopologyEdge(String source, String target, String label) {}
    public record TopologyGraph(List<TopologyNode> nodes, List<TopologyEdge> edges) {}

    @Transactional(readOnly = true)
    public TopologyGraph buildGraph(Long ownerId) {
        List<TopologyNode> nodes = new ArrayList<>();
        List<TopologyEdge> edges = new ArrayList<>();

        // Machines
        List<Machine> machines = machineRepository.findByOwnerId(ownerId);
        for (Machine m : machines) {
            nodes.add(new TopologyNode(
                "machine-" + m.getId(),
                "machine",
                m.getName(),
                m.getStatus().name(),
                Map.of("host", m.getHost(), "tunnelType", m.getTunnelType().name())
            ));
        }

        // Deployments — only latest per repositoryUrl (or latest overall if no success)
        List<Deployment> allDeps = deploymentRepository.findByOwnerId(ownerId);
        Map<String, Deployment> latestByRepo = new LinkedHashMap<>();
        // Sort newest-first
        allDeps.sort(Comparator.comparing(Deployment::getCreatedAt).reversed());
        for (Deployment d : allDeps) {
            String key = d.getRepositoryUrl() != null ? d.getRepositoryUrl() : "app-" + d.getName();
            latestByRepo.putIfAbsent(key, d);
        }
        for (Deployment d : latestByRepo.values()) {
            Map<String, Object> meta = new HashMap<>();
            if (d.getRepositoryUrl() != null) meta.put("repositoryUrl", d.getRepositoryUrl());
            if (d.getBranch() != null) meta.put("branch", d.getBranch());
            if (d.getDetectedStack() != null) meta.put("stack", d.getDetectedStack());
            if (d.getTunnelHostname() != null) meta.put("hostname", "https://" + d.getTunnelHostname());
            else if (d.getCloudfareTunnelUrl() != null) meta.put("tunnelUrl", d.getCloudfareTunnelUrl());

            nodes.add(new TopologyNode(
                "deploy-" + d.getId(),
                "deployment",
                d.getName(),
                d.getStatus().name(),
                meta
            ));

            if (d.getMachine() != null) {
                edges.add(new TopologyEdge("deploy-" + d.getId(), "machine-" + d.getMachine().getId(), "deployed on"));
            }

            // Tunnel node — created whenever hostname OR tunnel URL is available
            String tunnelHost = d.getTunnelHostname();
            String tunnelUrl  = d.getCloudfareTunnelUrl();
            if (tunnelHost != null || tunnelUrl != null) {
                String tunnelId = "tunnel-dep-" + d.getId();
                String label    = tunnelHost != null ? tunnelHost : tunnelUrl;
                Map<String, Object> tunnelMeta = new HashMap<>();
                tunnelMeta.put("url", tunnelHost != null ? "https://" + tunnelHost : tunnelUrl);
                if (d.getTunnelAppPort() != null) tunnelMeta.put("port", d.getTunnelAppPort());
                nodes.add(new TopologyNode(tunnelId, "tunnel", label, "ACTIVE", tunnelMeta));
                edges.add(new TopologyEdge(tunnelId, "deploy-" + d.getId(), "exposes"));
            }
        }

        // Containers
        List<ContainerDeployment> containers = containerRepository.findByOwnerId(ownerId);
        for (ContainerDeployment c : containers) {
            Map<String, Object> meta = new HashMap<>();
            meta.put("image", c.getImage());
            if (c.getHostPort() != null) meta.put("port", c.getHostPort());

            nodes.add(new TopologyNode(
                "container-" + c.getId(),
                "container",
                c.getName(),
                c.getStatus().name(),
                meta
            ));

            if (c.getMachine() != null) {
                edges.add(new TopologyEdge("container-" + c.getId(), "machine-" + c.getMachine().getId(), "running on"));
            }
        }

        return new TopologyGraph(nodes, edges);
    }
}
