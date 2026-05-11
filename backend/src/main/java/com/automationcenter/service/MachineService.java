package com.automationcenter.service;

import com.automationcenter.dto.machine.MachineRequest;
import com.automationcenter.dto.machine.MachineResponse;
import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.Machine;
import com.automationcenter.entity.MachineStatus;
import com.automationcenter.entity.TunnelType;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.MachineRepository;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class MachineService {

    private final MachineRepository machineRepository;
    private final UserRepository userRepository;
    private final SshService sshService;

    public MachineResponse create(MachineRequest request, Long ownerId) {
        User owner = userRepository.findById(ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        Machine machine = Machine.builder()
                .name(request.getName())
                .host(request.getHost())
                .port(request.getPort())
                .sshUser(request.getSshUser())
                .privateKey(request.getPrivateKey())
                .tunnelType(request.getTunnelType() != null ? request.getTunnelType() : TunnelType.DIRECT)
                .proxyCommand(request.getProxyCommand())
                .owner(owner)
                .build();
        return toResponse(machineRepository.save(machine));
    }

    public List<MachineResponse> listByOwner(Long ownerId) {
        return machineRepository.findByOwnerId(ownerId).stream().map(this::toResponse).toList();
    }

    public MachineResponse getById(Long id, Long ownerId) {
        return toResponse(findByIdAndOwner(id, ownerId));
    }

    public MachineResponse update(Long id, MachineRequest request, Long ownerId) {
        Machine machine = findByIdAndOwner(id, ownerId);
        machine.setName(request.getName());
        machine.setHost(request.getHost());
        machine.setPort(request.getPort());
        machine.setSshUser(request.getSshUser());
        if (request.getPrivateKey() != null && !request.getPrivateKey().isBlank()) {
            machine.setPrivateKey(request.getPrivateKey());
        }
        if (request.getTunnelType() != null) {
            machine.setTunnelType(request.getTunnelType());
        }
        // empty string clears the proxy; null leaves it unchanged
        if (request.getProxyCommand() != null) {
            machine.setProxyCommand(request.getProxyCommand().isBlank() ? null : request.getProxyCommand());
        }
        return toResponse(machineRepository.save(machine));
    }

    public void delete(Long id, Long ownerId) {
        Machine machine = findByIdAndOwner(id, ownerId);
        machineRepository.delete(machine);
    }

    public boolean testConnection(Long machineId, Long ownerId) {
        Machine machine = findByIdAndOwner(machineId, ownerId);
        return ping(machine);
    }

    public SshCommandResponse exec(Long machineId, String command, Long ownerId) {
        Machine machine = findByIdAndOwner(machineId, ownerId);
        return sshService.execute(machine, command);
    }

    @Scheduled(fixedDelay = 60_000)
    public void pingAll() {
        machineRepository.findAll().forEach(machine -> {
            try {
                ping(machine);
            } catch (Exception e) {
                log.warn("Ping failed for machine {}: {}", machine.getId(), e.getMessage());
            }
        });
    }

    private boolean ping(Machine machine) {
        SshCommandResponse response = sshService.execute(machine, "echo ok");
        boolean online = response.getExitCode() == 0 && response.getStdout().contains("ok");
        machine.setStatus(online ? MachineStatus.ONLINE : MachineStatus.ERROR);
        if (online) machine.setLastSeen(LocalDateTime.now());
        machineRepository.save(machine);
        return online;
    }

    public Machine findByIdAndOwner(Long id, Long ownerId) {
        return machineRepository.findByIdAndOwnerId(id, ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("Machine not found: " + id));
    }

    public MachineResponse toResponse(Machine m) {
        return MachineResponse.builder()
                .id(m.getId())
                .name(m.getName())
                .host(m.getHost())
                .port(m.getPort())
                .sshUser(m.getSshUser())
                .status(m.getStatus().name())
                .tunnelType(m.getTunnelType() != null ? m.getTunnelType() : TunnelType.DIRECT)
                .proxyCommand(m.getProxyCommand())
                .lastSeen(m.getLastSeen())
                .createdAt(m.getCreatedAt())
                .ownerId(m.getOwner().getId())
                .build();
    }
}
