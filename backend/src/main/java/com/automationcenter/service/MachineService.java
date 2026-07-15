package com.automationcenter.service;

import com.automationcenter.dto.machine.MachineRequest;
import com.automationcenter.dto.machine.MachineResponse;
import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.Machine;
import com.automationcenter.entity.MachineMetric;
import com.automationcenter.entity.MachineStatus;
import com.automationcenter.entity.TunnelType;
import com.automationcenter.entity.User;
import com.automationcenter.exception.ResourceNotFoundException;
import com.automationcenter.repository.MachineMetricRepository;
import com.automationcenter.repository.MachineRepository;
import com.automationcenter.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
@Slf4j
public class MachineService {

    private final MachineRepository machineRepository;
    private final UserRepository userRepository;
    private final SshService sshService;
    private final MachineMetricRepository machineMetricRepository;

    @Value("${ssh.ping-timeout-seconds:10}")
    private long pingTimeoutSeconds;

    /** Keep roughly the last ~3 hours of samples per machine at the 60s ping interval. */
    private static final int METRIC_RETENTION_COUNT = 200;

    /**
     * Single portable shell round-trip: OS-detects Linux vs macOS for memory (no `free`
     * on macOS), uses 1-min load average instead of instantaneous %CPU (available on
     * both without parsing locale-dependent `top` output), and `df -m /` for disk
     * (works the same on both platforms).
     */
    private static final String TELEMETRY_SCRIPT =
            "OS=$(uname -s); "
            + "if [ \"$OS\" = Darwin ]; then "
            + "LOAD=$(sysctl -n vm.loadavg | awk '{print $2}'); "
            + "MEMTOTAL=$(($(sysctl -n hw.memsize)/1024/1024)); "
            + "PAGESFREE=$(vm_stat | awk '/Pages free/{gsub(/\\./,\"\",$3);print $3}'); "
            + "MEMFREE=$((PAGESFREE*4096/1024/1024)); MEMUSED=$((MEMTOTAL-MEMFREE)); "
            + "else "
            + "LOAD=$(awk '{print $1}' /proc/loadavg); "
            + "MEMUSED=$(free -m | awk '/Mem:/{print $3}'); MEMTOTAL=$(free -m | awk '/Mem:/{print $2}'); "
            + "fi; "
            + "DISKUSED=$(df -m / | awk 'NR==2{print $3}'); DISKTOTAL=$(df -m / | awk 'NR==2{print $2}'); "
            + "echo LOAD=$LOAD MEM_USED=$MEMUSED MEM_TOTAL=$MEMTOTAL DISK_USED=$DISKUSED DISK_TOTAL=$DISKTOTAL";

    private static final Pattern TELEMETRY_PATTERN = Pattern.compile(
            "LOAD=([\\d.]+) MEM_USED=(\\d+) MEM_TOTAL=(\\d+) DISK_USED=(\\d+) DISK_TOTAL=(\\d+)");

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
        SshCommandResponse response = sshService.execute(machine, "echo ok", pingTimeoutSeconds);
        boolean online = response.getExitCode() == 0 && response.getStdout().contains("ok");
        machine.setStatus(online ? MachineStatus.ONLINE : MachineStatus.ERROR);
        if (online) {
            machine.setLastSeen(LocalDateTime.now());
            sampleTelemetry(machine);
        }
        machineRepository.save(machine);
        return online;
    }

    private void sampleTelemetry(Machine machine) {
        try {
            SshCommandResponse result = sshService.execute(machine, TELEMETRY_SCRIPT, pingTimeoutSeconds);
            if (result.getExitCode() != 0) return;
            Matcher m = TELEMETRY_PATTERN.matcher(result.getStdout());
            if (!m.find()) return;

            machineMetricRepository.save(MachineMetric.builder()
                    .machineId(machine.getId())
                    .cpuLoad(Double.parseDouble(m.group(1)))
                    .memUsedMb(Integer.parseInt(m.group(2)))
                    .memTotalMb(Integer.parseInt(m.group(3)))
                    .diskUsedMb(Integer.parseInt(m.group(4)))
                    .diskTotalMb(Integer.parseInt(m.group(5)))
                    .build());

            enforceMetricRetention(machine.getId());
        } catch (Exception e) {
            log.debug("Telemetry sampling failed for machine {}: {}", machine.getId(), e.getMessage());
        }
    }

    private void enforceMetricRetention(Long machineId) {
        long count = machineMetricRepository.countByMachineId(machineId);
        if (count <= METRIC_RETENTION_COUNT) return;
        List<Long> oldestIds = machineMetricRepository.findByMachineIdOrderByTimestampAsc(machineId).stream()
                .limit(count - METRIC_RETENTION_COUNT)
                .map(MachineMetric::getId)
                .toList();
        machineMetricRepository.deleteAllById(oldestIds);
    }

    public List<MachineMetric> getMetrics(Long machineId, Long ownerId) {
        findByIdAndOwner(machineId, ownerId); // ownership check
        return machineMetricRepository.findTop50ByMachineIdOrderByTimestampDesc(machineId);
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
