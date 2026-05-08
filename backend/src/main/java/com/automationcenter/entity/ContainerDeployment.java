package com.automationcenter.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@Entity
@Table(name = "container_deployments")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ContainerDeployment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String image;

    private Integer hostPort;

    private Integer containerPort;

    @ElementCollection
    @CollectionTable(name = "container_env_vars",
            joinColumns = @JoinColumn(name = "container_deployment_id"))
    @MapKeyColumn(name = "env_key")
    @Column(name = "env_value")
    @Builder.Default
    private Map<String, String> envVars = new HashMap<>();

    private String containerId;

    @Enumerated(EnumType.STRING)
    @Builder.Default
    private ContainerStatus status = ContainerStatus.PENDING;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "machine_id", nullable = false)
    private Machine machine;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    private User owner;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
