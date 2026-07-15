package com.automationcenter.service;

import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.DeploymentType;
import com.automationcenter.entity.Machine;
import com.automationcenter.entity.TunnelType;
import com.automationcenter.repository.DeploymentRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class VolumeBackupServiceTest {

    @Mock private SshService sshService;
    @Mock private DeploymentRepository deploymentRepository;

    private VolumeBackupService service;
    private Machine machine;
    private Deployment deployment;

    @BeforeEach
    void setUp() {
        service = new VolumeBackupService(sshService, deploymentRepository);
        machine = Machine.builder().id(5L).name("prod-1").host("h").port(22)
                .sshUser("root").privateKey("key").tunnelType(TunnelType.DIRECT).build();
        deployment = Deployment.builder().id(100L).name("widgets").type(DeploymentType.REPOSITORY)
                .deployDir("/tmp/deploy_100").machine(machine).build();
    }

    @Test
    void doesNothingWhenDeployDirMissing() {
        deployment.setDeployDir(null);

        service.backupBeforeRedeploy(deployment, machine);

        verifyNoInteractions(sshService);
        verifyNoInteractions(deploymentRepository);
    }

    @Test
    void runsResticBackupAndForgetWhenResticAlreadyInstalled() {
        SshCommandResponse ok = new SshCommandResponse("ok", "", 0);
        when(sshService.execute(eq(machine), contains("command -v restic"))).thenReturn(ok);
        when(sshService.execute(eq(machine), anyString(), anyLong())).thenReturn(ok);

        service.backupBeforeRedeploy(deployment, machine);

        assertThat(deployment.getResticRepoPassword()).isNotBlank();
        verify(deploymentRepository).save(deployment);

        ArgumentCaptor<String> commands = ArgumentCaptor.forClass(String.class);
        verify(sshService, times(3)).execute(eq(machine), commands.capture(), eq(900L));
        assertThat(commands.getAllValues()).anySatisfy(cmd -> assertThat(cmd).contains("restic init"));
        assertThat(commands.getAllValues()).anySatisfy(cmd -> assertThat(cmd).contains("restic backup -q '/tmp/deploy_100'"));
        assertThat(commands.getAllValues()).anySatisfy(cmd -> assertThat(cmd).contains("restic forget -q --keep-last 5 --prune"));
    }

    @Test
    void reusesExistingPasswordOnSubsequentBackup() {
        deployment.setResticRepoPassword("already-set-password");
        SshCommandResponse ok = new SshCommandResponse("ok", "", 0);
        when(sshService.execute(eq(machine), contains("command -v restic"))).thenReturn(ok);
        when(sshService.execute(eq(machine), anyString(), anyLong())).thenReturn(ok);

        service.backupBeforeRollback(deployment, machine);

        assertThat(deployment.getResticRepoPassword()).isEqualTo("already-set-password");
        verify(deploymentRepository, never()).save(any());
    }

    @Test
    void backupFailureIsSwallowedNotThrown() {
        when(sshService.execute(eq(machine), contains("command -v restic")))
                .thenThrow(new RuntimeException("ssh unreachable"));

        service.backupBeforeRedeploy(deployment, machine);

        verify(deploymentRepository, never()).save(any());
    }

    @Test
    void installsResticWhenNotAlreadyPresent() {
        SshCommandResponse missing = new SshCommandResponse("", "", 1);
        SshCommandResponse ok = new SshCommandResponse("ok", "", 0);
        when(sshService.execute(eq(machine), contains("command -v restic"))).thenReturn(missing);
        when(sshService.execute(eq(machine), anyString(), anyLong())).thenReturn(ok);

        service.backupBeforeRedeploy(deployment, machine);

        verify(sshService).execute(eq(machine), contains("restic_"), eq(900L));
    }
}
