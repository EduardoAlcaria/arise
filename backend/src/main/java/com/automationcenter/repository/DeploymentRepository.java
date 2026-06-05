package com.automationcenter.repository;

import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.DeploymentStatus;
import com.automationcenter.entity.DeploymentType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface DeploymentRepository extends JpaRepository<Deployment, Long> {
    Page<Deployment> findByOwnerId(Long ownerId, Pageable pageable);
    List<Deployment> findByOwnerId(Long ownerId);
    Optional<Deployment> findByIdAndOwnerId(Long id, Long ownerId);

    Optional<Deployment> findTopByRepositoryUrlAndMachine_IdAndTypeAndStatusAndIdNotOrderByCreatedAtDesc(
            String repositoryUrl, Long machineId, DeploymentType type, DeploymentStatus status, Long excludeId);

    Optional<Deployment> findTopByMachine_IdAndTypeAndStatusAndIdNotOrderByCreatedAtDesc(
            Long machineId, DeploymentType type, DeploymentStatus status, Long excludeId);

    List<Deployment> findByStatusIn(Collection<DeploymentStatus> statuses);

    /**
     * Backfill the optimistic-lock version on rows created before {@code @Version} existed
     * (ddl-auto adds the column as NULL). A bulk update bypasses the version check; without
     * this, merging such a detached entity throws "uninitialized version value 'null'".
     * Returns the number of rows fixed.
     */
    @Modifying
    @Transactional
    @Query("update Deployment d set d.lockVersion = 0 where d.lockVersion is null")
    int initializeNullLockVersions();
}
