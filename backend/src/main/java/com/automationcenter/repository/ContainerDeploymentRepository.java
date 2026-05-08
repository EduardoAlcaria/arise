package com.automationcenter.repository;

import com.automationcenter.entity.ContainerDeployment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ContainerDeploymentRepository extends JpaRepository<ContainerDeployment, Long> {
    List<ContainerDeployment> findByOwnerId(Long ownerId);
    Optional<ContainerDeployment> findByIdAndOwnerId(Long id, Long ownerId);
}
