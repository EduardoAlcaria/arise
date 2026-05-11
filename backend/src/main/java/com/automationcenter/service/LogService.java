package com.automationcenter.service;

import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.LogEntry;
import com.automationcenter.entity.LogLevel;
import com.automationcenter.repository.DeploymentRepository;
import com.automationcenter.repository.LogEntryRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class LogService {

    private final LogEntryRepository logEntryRepository;
    private final DeploymentRepository deploymentRepository;

    public LogEntry save(Long deploymentId, String message, LogLevel level) {
        Deployment deployment = deploymentRepository.findById(deploymentId)
                .orElseThrow(() -> new RuntimeException("Deployment not found: " + deploymentId));
        LogEntry entry = LogEntry.builder()
                .deployment(deployment)
                .message(message)
                .level(level)
                .build();
        return logEntryRepository.save(entry);
    }

    public List<LogEntry> findByDeploymentId(Long deploymentId) {
        return logEntryRepository.findByDeploymentIdOrderByCreatedAtAsc(deploymentId);
    }

}
