package com.automationcenter.service;

import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.Machine;
import com.automationcenter.entity.MachineMetric;
import com.automationcenter.entity.TunnelType;
import com.automationcenter.repository.MachineMetricRepository;
import com.automationcenter.repository.MachineRepository;
import com.automationcenter.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MachineServiceTest {

    @Mock private MachineRepository machineRepository;
    @Mock private UserRepository userRepository;
    @Mock private SshService sshService;
    @Mock private MachineMetricRepository machineMetricRepository;

    private MachineService service;
    private Machine machine;

    @BeforeEach
    void setUp() {
        service = new MachineService(machineRepository, userRepository, sshService, machineMetricRepository);
        machine = Machine.builder().id(9L).name("box").host("h").port(22)
                .sshUser("root").privateKey("key").tunnelType(TunnelType.DIRECT).build();
        when(machineRepository.findAll()).thenReturn(List.of(machine));
    }

    @Test
    void onlinePingSamplesAndStoresTelemetry() {
        when(sshService.execute(eq(machine), eq("echo ok"), anyLong()))
                .thenReturn(new SshCommandResponse("ok", "", 0));
        when(sshService.execute(eq(machine), contains("LOAD="), anyLong()))
                .thenReturn(new SshCommandResponse(
                        "LOAD=0.42 MEM_USED=2048 MEM_TOTAL=8192 DISK_USED=51200 DISK_TOTAL=102400", "", 0));
        when(machineMetricRepository.countByMachineId(9L)).thenReturn(1L);

        service.pingAll();

        ArgumentCaptor<MachineMetric> captor = ArgumentCaptor.forClass(MachineMetric.class);
        verify(machineMetricRepository).save(captor.capture());
        MachineMetric saved = captor.getValue();
        assertThat(saved.getMachineId()).isEqualTo(9L);
        assertThat(saved.getCpuLoad()).isEqualTo(0.42);
        assertThat(saved.getMemUsedMb()).isEqualTo(2048);
        assertThat(saved.getMemTotalMb()).isEqualTo(8192);
        assertThat(saved.getDiskUsedMb()).isEqualTo(51200);
        assertThat(saved.getDiskTotalMb()).isEqualTo(102400);
    }

    @Test
    void offlinePingSkipsTelemetrySampling() {
        when(sshService.execute(eq(machine), eq("echo ok"), anyLong()))
                .thenReturn(new SshCommandResponse("", "connection refused", -1));

        service.pingAll();

        verify(sshService, never()).execute(eq(machine), contains("LOAD="), anyLong());
        verify(machineMetricRepository, never()).save(any());
    }

    @Test
    void malformedTelemetryOutputIsSkippedWithoutThrowing() {
        when(sshService.execute(eq(machine), eq("echo ok"), anyLong()))
                .thenReturn(new SshCommandResponse("ok", "", 0));
        when(sshService.execute(eq(machine), contains("LOAD="), anyLong()))
                .thenReturn(new SshCommandResponse("garbage output", "", 0));

        service.pingAll();

        verify(machineMetricRepository, never()).save(any());
    }

    @Test
    void retentionPrunesOldestSamplesBeyondLimit() {
        when(sshService.execute(eq(machine), eq("echo ok"), anyLong()))
                .thenReturn(new SshCommandResponse("ok", "", 0));
        when(sshService.execute(eq(machine), contains("LOAD="), anyLong()))
                .thenReturn(new SshCommandResponse(
                        "LOAD=0.1 MEM_USED=100 MEM_TOTAL=200 DISK_USED=300 DISK_TOTAL=400", "", 0));
        when(machineMetricRepository.countByMachineId(9L)).thenReturn(202L);
        MachineMetric oldest = MachineMetric.builder().id(1L).machineId(9L).build();
        MachineMetric secondOldest = MachineMetric.builder().id(2L).machineId(9L).build();
        when(machineMetricRepository.findByMachineIdOrderByTimestampAsc(9L))
                .thenReturn(List.of(oldest, secondOldest));

        service.pingAll();

        verify(machineMetricRepository).deleteAllById(List.of(1L, 2L));
    }
}
