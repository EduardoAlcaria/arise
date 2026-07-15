package com.automationcenter.repository;

import com.automationcenter.entity.MachineMetric;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MachineMetricRepository extends JpaRepository<MachineMetric, Long> {
    List<MachineMetric> findTop50ByMachineIdOrderByTimestampDesc(Long machineId);
    List<MachineMetric> findByMachineIdOrderByTimestampAsc(Long machineId);
    long countByMachineId(Long machineId);
}
