package com.automationcenter.listener;

import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.DeploymentStatus;
import com.automationcenter.repository.DeploymentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

/**
 * On startup, any deployment left in a non-terminal state because a previous
 * process died mid-deploy is marked FAILED so it does not appear stuck forever.
 *
 * <p>Guard against the durable-queue race: an interrupted deploy's RabbitMQ message
 * is redelivered on restart and re-runs {@code executeAsync}, which sets startedAt to
 * "now". Deployments started at/after this process booted are being actively processed
 * — they are skipped so the reconciler never clobbers a live deploy.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DeploymentReconciler {

    private final DeploymentRepository deploymentRepository;

    /** Captured at bean construction ≈ process boot; used to tell pre-crash deploys from freshly redelivered ones. */
    private final LocalDateTime bootTime = LocalDateTime.now();

    @EventListener(ApplicationReadyEvent.class)
    public void reconcileOrphans() {
        List<Deployment> stuck = deploymentRepository.findByStatusIn(List.of(
                DeploymentStatus.PENDING, DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING));
        int reconciled = 0;
        for (Deployment d : stuck) {
            if (d.getStartedAt() != null && !d.getStartedAt().isBefore(bootTime)) {
                // Started by THIS process (a redelivered job actively running) — leave it alone.
                log.info("Deployment {} started after boot — actively processing, skipping reconcile", d.getId());
                continue;
            }
            d.setStatus(DeploymentStatus.FAILED);
            d.setFinishedAt(LocalDateTime.now());
            String existing = d.getLogs() == null ? "" : d.getLogs();
            d.setLogs(existing + "\nDeployment interrupted by server restart");
            deploymentRepository.save(d);
            reconciled++;
            log.warn("Reconciled orphaned deployment {} -> FAILED", d.getId());
        }
        if (reconciled > 0) {
            log.info("Reconciled {} orphaned deployment(s) on startup", reconciled);
        }
    }
}
