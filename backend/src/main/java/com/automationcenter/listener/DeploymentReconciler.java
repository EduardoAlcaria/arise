package com.automationcenter.listener;

import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.DeploymentStatus;
import com.automationcenter.repository.DeploymentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

/**
 * On startup, any deployment left in a non-terminal state (the server died or
 * restarted mid-deploy) is marked FAILED so it does not appear stuck forever.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DeploymentReconciler {

    private final DeploymentRepository deploymentRepository;

    @EventListener(ApplicationReadyEvent.class)
    public void reconcileOrphans() {
        List<Deployment> stuck = deploymentRepository.findByStatusIn(List.of(
                DeploymentStatus.PENDING, DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING));
        int reconciled = 0;
        for (Deployment d : stuck) {
            d.setStatus(DeploymentStatus.FAILED);
            d.setFinishedAt(LocalDateTime.now());
            String existing = d.getLogs() == null ? "" : d.getLogs();
            d.setLogs(existing + "\nDeployment interrupted by server restart");
            try {
                deploymentRepository.save(d);
                reconciled++;
                log.warn("Reconciled orphaned deployment {} -> FAILED", d.getId());
            } catch (OptimisticLockingFailureException e) {
                // A redelivered job is actively re-running this deployment — it owns the
                // row now. Yield so we don't clobber a live deploy.
                log.info("Deployment {} is being actively processed — skipping reconcile", d.getId());
            }
        }
        if (reconciled > 0) {
            log.info("Reconciled {} orphaned deployment(s) on startup", reconciled);
        }
    }
}
