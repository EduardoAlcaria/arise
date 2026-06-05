package com.automationcenter.listener;

import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.DeploymentStatus;
import com.automationcenter.repository.DeploymentRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class DeploymentReconcilerTest {

    @Mock DeploymentRepository deploymentRepository;
    @InjectMocks DeploymentReconciler reconciler;

    @Test
    void marksOrphanedDeploymentsFailed() {
        Deployment d1 = Deployment.builder().status(DeploymentStatus.BUILDING).build();
        Deployment d2 = Deployment.builder().status(DeploymentStatus.PENDING).build();
        when(deploymentRepository.findByStatusIn(anyCollection())).thenReturn(List.of(d1, d2));

        reconciler.reconcileOrphans();

        assertEquals(DeploymentStatus.FAILED, d1.getStatus());
        assertEquals(DeploymentStatus.FAILED, d2.getStatus());
        assertNotNull(d1.getFinishedAt());
        ArgumentCaptor<Deployment> captor = ArgumentCaptor.forClass(Deployment.class);
        verify(deploymentRepository, times(2)).save(captor.capture());
        assertTrue(captor.getAllValues().get(0).getLogs().contains("interrupted by server restart"));
    }

    @Test
    void noOrphansNoSaves() {
        when(deploymentRepository.findByStatusIn(anyCollection())).thenReturn(List.of());
        reconciler.reconcileOrphans();
        verify(deploymentRepository, never()).save(any());
    }

    @Test
    void skipsDeploymentStartedAfterBoot() {
        // A redelivered job started by THIS process (startedAt in the future relative to the
        // reconciler's boot time) is actively running and must NOT be reconciled/clobbered.
        Deployment live = Deployment.builder()
                .status(DeploymentStatus.BUILDING)
                .startedAt(LocalDateTime.now().plusMinutes(5))
                .build();
        Deployment orphan = Deployment.builder()
                .status(DeploymentStatus.DEPLOYING)
                .startedAt(LocalDateTime.now().minusMinutes(5))
                .build();
        when(deploymentRepository.findByStatusIn(anyCollection())).thenReturn(List.of(live, orphan));

        reconciler.reconcileOrphans();

        assertEquals(DeploymentStatus.BUILDING, live.getStatus(), "live redelivered deploy must be untouched");
        assertEquals(DeploymentStatus.FAILED, orphan.getStatus(), "pre-boot orphan must be failed");
        verify(deploymentRepository, times(1)).save(orphan);
        verify(deploymentRepository, never()).save(live);
    }
}
