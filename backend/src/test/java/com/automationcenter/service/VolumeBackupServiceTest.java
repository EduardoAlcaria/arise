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
        lenient().when(sshService.execute(eq(machine), eq("echo $HOME")))
                .thenReturn(new SshCommandResponse("/root", "", 0));
        lenient().when(sshService.execute(eq(machine), eq("uname -s 2>/dev/null || echo Windows")))
                .thenReturn(new SshCommandResponse("Linux", "", 0));
        lenient().when(sshService.execute(eq(machine), eq("command -v curl >/dev/null || command -v wget >/dev/null")))
                .thenReturn(new SshCommandResponse("", "", 0));
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

    @Test
    void installsCurlViaPackageManagerWhenNeitherCurlNorWgetPresent() {
        SshCommandResponse resticMissing = new SshCommandResponse("", "", 1);
        SshCommandResponse fail = new SshCommandResponse("", "", 1);
        SshCommandResponse ok = new SshCommandResponse("ok", "", 0);
        // apt-get is first in PACKAGE_MANAGER_ORDER and succeeds, so the loop never probes
        // the rest — no need to stub dnf/yum/apk/etc for this scenario.
        when(sshService.execute(eq(machine), contains("command -v restic"))).thenReturn(resticMissing);
        when(sshService.execute(eq(machine), eq("command -v curl >/dev/null || command -v wget >/dev/null")))
                .thenReturn(fail);
        when(sshService.execute(eq(machine), eq("command -v apt-get 2>/dev/null"))).thenReturn(ok);
        when(sshService.execute(eq(machine), anyString(), anyLong())).thenReturn(ok);

        service.backupBeforeRedeploy(deployment, machine);

        verify(sshService).execute(eq(machine),
                eq("DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y curl"),
                eq(900L));
        verify(sshService).execute(eq(machine), contains("restic_"), eq(900L));
        assertThat(deployment.getResticRepoPassword()).isNotBlank();
    }

    @Test
    void skipsBackupWhenNoDownloaderAndNoPackageManagerAvailable() {
        SshCommandResponse resticMissing = new SshCommandResponse("", "", 1);
        SshCommandResponse fail = new SshCommandResponse("", "", 1);
        when(sshService.execute(eq(machine), startsWith("command -v "))).thenReturn(fail);
        when(sshService.execute(eq(machine), contains("command -v restic"))).thenReturn(resticMissing);
        when(sshService.execute(eq(machine), eq("command -v curl >/dev/null || command -v wget >/dev/null")))
                .thenReturn(fail);

        service.backupBeforeRedeploy(deployment, machine);

        verify(sshService, never()).execute(eq(machine), contains("restic_"), anyLong());
        verify(deploymentRepository, never()).save(any());
    }

    @Test
    void runsResticBackupOnWindowsTargetViaPowerShell() {
        SshCommandResponse windowsOs = new SshCommandResponse("Windows", "", 0);
        SshCommandResponse resticPresent = new SshCommandResponse("", "", 0);
        SshCommandResponse ok = new SshCommandResponse("ok", "", 0);
        when(sshService.execute(eq(machine), eq("uname -s 2>/dev/null || echo Windows"))).thenReturn(windowsOs);
        when(sshService.execute(eq(machine), eq("echo %LOCALAPPDATA%")))
                .thenReturn(new SshCommandResponse("C:\\Users\\svc\\AppData\\Local", "", 0));
        when(sshService.execute(eq(machine), contains("if exist"))).thenReturn(resticPresent);
        when(sshService.execute(eq(machine), anyString(), anyLong())).thenReturn(ok);

        service.backupBeforeRedeploy(deployment, machine);

        ArgumentCaptor<String> commands = ArgumentCaptor.forClass(String.class);
        verify(sshService, times(3)).execute(eq(machine), commands.capture(), eq(900L));
        assertThat(commands.getAllValues()).allSatisfy(cmd -> assertThat(cmd).startsWith("powershell -NoProfile"));
        assertThat(commands.getAllValues()).anySatisfy(cmd -> assertThat(cmd).contains("restic.exe' init -q"));
        assertThat(commands.getAllValues()).anySatisfy(cmd -> assertThat(cmd).contains("backup -q").contains("/tmp/deploy_100"));
        assertThat(commands.getAllValues()).anySatisfy(cmd -> assertThat(cmd).contains("forget -q --keep-last 5 --prune"));
        assertThat(deployment.getResticRepoPassword()).isNotBlank();
    }
}
