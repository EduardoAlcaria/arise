package com.automationcenter.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "machines")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Machine {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String host;

    @Column(nullable = false)
    private Integer port;

    @Column(nullable = false)
    private String sshUser;

    @Column(columnDefinition = "TEXT", nullable = false)
    private String privateKey;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    @Builder.Default
    private TunnelType tunnelType = TunnelType.DIRECT;

    @Column(columnDefinition = "TEXT")
    private String proxyCommand;

    @Enumerated(EnumType.STRING)
    @Builder.Default
    private MachineStatus status = MachineStatus.UNKNOWN;

    private LocalDateTime lastSeen;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    private User owner;
}
