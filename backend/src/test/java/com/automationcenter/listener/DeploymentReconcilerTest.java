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
}
