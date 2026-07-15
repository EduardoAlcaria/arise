package com.automationcenter.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "machine_metrics")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class MachineMetric {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long machineId;

    /** 1-minute load average (not a normalized %CPU — portable across Linux/macOS). */
    private Double cpuLoad;

    private Integer memUsedMb;
    private Integer memTotalMb;
    private Integer diskUsedMb;
    private Integer diskTotalMb;

    @CreationTimestamp
    private LocalDateTime timestamp;
}
