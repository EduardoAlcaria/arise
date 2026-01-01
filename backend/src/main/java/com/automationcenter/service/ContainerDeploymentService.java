package com.automationcenter.service;

import com.automationcenter.dto.container.ContainerDeployRequest;
import com.automationcenter.dto.container.ContainerDeploymentResponse;
import com.automationcenter.entity.ContainerDeployment;
import com.automationcenter.entity.ContainerStatus;
import com.automationcenter.entity.Machine;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.ContainerDeploymentRepository;
import com.automationcenter.repository.UserRepository;
import com.github.dockerjava.api.DockerClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class ContainerDeploymentService {

    private final ContainerDeploymentRepository containerDeploymentRepository;
    private final UserRepository userRepository;
    private final MachineService machineService;
    private final DockerService dockerService;

    public ContainerDeploymentResponse deploy(ContainerDeployRequest request, Long ownerId) {
        User owner = userRepository.findById(ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        Machine machine = machineService.findByIdAndOwner(request.getMachineId(), ownerId);

        ContainerDeployment deployment = ContainerDeployment.builder()
                .name(request.getName())
                .image(request.getImage())
                .hostPort(request.getHostPort())
                .containerPort(request.getContainerPort())
                .envVars(request.getEnvVars() != null ? new HashMap<>(request.getEnvVars()) : new HashMap<>())
                .machine(machine)
                .owner(owner)
                .build();
        deployment = containerDeploymentRepository.save(deployment);

        try {
            DockerClient client = dockerService.buildClient(machine.getHost());

            deployment.setStatus(ContainerStatus.PULLING);
            containerDeploymentRepository.save(deployment);
            dockerService.pullImage(client, request.getImage());

            String containerId = dockerService.createContainer(
                    client, request.getName(), request.getImage(),
                    request.getHostPort(), request.getContainerPort(), request.getEnvVars()
            );
            deployment.setContainerId(containerId);

            dockerService.startContainer(client, containerId);
            deployment.setStatus(ContainerStatus.RUNNING);
        } catch (Exception e) {
            log.error("Container deployment failed: {}", e.getMessage(), e);
            deployment.setStatus(ContainerStatus.FAILED);
        }

        return toResponse(containerDeploymentRepository.save(deployment));
    }

    public List<ContainerDeploymentResponse> listByOwner(Long ownerId) {
        return containerDeploymentRepository.findByOwnerId(ownerId).stream().map(this::toResponse).toList();
    }

    public ContainerDeploymentResponse getById(Long id, Long ownerId) {
        return toResponse(findByIdAndOwner(id, ownerId));
    }

    public ContainerDeploymentResponse stop(Long id, Long ownerId) {
        ContainerDeployment deployment = findByIdAndOwner(id, ownerId);
        DockerClient client = dockerService.buildClient(deployment.getMachine().getHost());
        dockerService.stopContainer(client, deployment.getContainerId());
        deployment.setStatus(ContainerStatus.STOPPED);
        return toResponse(containerDeploymentRepository.save(deployment));
    }

    public ContainerDeploymentResponse restart(Long id, Long ownerId) {
        ContainerDeployment deployment = findByIdAndOwner(id, ownerId);
        DockerClient client = dockerService.buildClient(deployment.getMachine().getHost());
        dockerService.stopContainer(client, deployment.getContainerId());
        dockerService.startContainer(client, deployment.getContainerId());
        deployment.setStatus(ContainerStatus.RUNNING);
        return toResponse(containerDeploymentRepository.save(deployment));
    }

    public void remove(Long id, Long ownerId) {
        ContainerDeployment deployment = findByIdAndOwner(id, ownerId);
        DockerClient client = dockerService.buildClient(deployment.getMachine().getHost());
        try {
            dockerService.removeContainer(client, deployment.getContainerId());
        } catch (Exception e) {
            log.warn("Could not remove container {}: {}", deployment.getContainerId(), e.getMessage());
        }
        deployment.setStatus(ContainerStatus.REMOVED);
        containerDeploymentRepository.save(deployment);
    }

    public String getLogs(Long id, Long ownerId) {
        ContainerDeployment deployment = findByIdAndOwner(id, ownerId);
        DockerClient client = dockerService.buildClient(deployment.getMachine().getHost());
        return dockerService.getLogs(client, deployment.getContainerId());
    }

    private ContainerDeployment findByIdAndOwner(Long id, Long ownerId) {
        return containerDeploymentRepository.findByIdAndOwnerId(id, ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("Container deployment not found: " + id));
    }

    private ContainerDeploymentResponse toResponse(ContainerDeployment c) {
        return ContainerDeploymentResponse.builder()
                .id(c.getId())
                .name(c.getName())
                .image(c.getImage())
                .hostPort(c.getHostPort())
                .containerPort(c.getContainerPort())
                .envVars(c.getEnvVars())
                .containerId(c.getContainerId())
                .status(c.getStatus().name())
                .machineId(c.getMachine().getId())
                .machineName(c.getMachine().getName())
                .ownerId(c.getOwner().getId())
                .createdAt(c.getCreatedAt())
                .updatedAt(c.getUpdatedAt())
                .build();
    }
}
