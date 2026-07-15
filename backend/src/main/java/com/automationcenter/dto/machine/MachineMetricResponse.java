package com.automationcenter.dto.machine;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@AllArgsConstructor
public class MachineMetricResponse {
    private Double cpuLoad;
    private Integer memUsedMb;
    private Integer memTotalMb;
    private Integer diskUsedMb;
    private Integer diskTotalMb;
    private LocalDateTime timestamp;
}
