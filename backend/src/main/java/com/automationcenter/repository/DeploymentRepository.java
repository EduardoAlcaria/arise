package com.automationcenter.repository;

import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.DeploymentStatus;
import com.automationcenter.entity.DeploymentType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

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
}
