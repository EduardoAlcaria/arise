package com.automationcenter.repository;

import com.automationcenter.entity.LogEntry;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface LogEntryRepository extends JpaRepository<LogEntry, Long> {
    List<LogEntry> findByDeploymentIdOrderByCreatedAtAsc(Long deploymentId);
    List<LogEntry> findByDeploymentIdAndIdGreaterThanOrderByCreatedAtAsc(Long deploymentId, Long afterId);
}
