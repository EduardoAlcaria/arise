package com.automationcenter.repository;

import com.automationcenter.entity.Machine;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface MachineRepository extends JpaRepository<Machine, Long> {
    List<Machine> findByOwnerId(Long ownerId);
    Optional<Machine> findByIdAndOwnerId(Long id, Long ownerId);
}
