package com.automationcenter.repository;

import com.automationcenter.entity.Deployment;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface DeploymentRepository extends JpaRepository<Deployment, Long> {
    Page<Deployment> findByOwnerId(Long ownerId, Pageable pageable);
    Optional<Deployment> findByIdAndOwnerId(Long id, Long ownerId);
}
