package com.automationcenter.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "deployments")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Deployment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private DeploymentType type;

    @Enumerated(EnumType.STRING)
    @Builder.Default
    private DeploymentStatus status = DeploymentStatus.PENDING;

    private String repositoryUrl;

    private String branch;

    @Column(columnDefinition = "TEXT")
    private String logs;

    private String version;

    private String detectedStack;

    @Column(columnDefinition = "TEXT")
    private String applicationServices;

    @Column(columnDefinition = "TEXT")
    private String applicationConfigs;

    @Column(columnDefinition = "TEXT")
    private String repoConfigs;

    private String tunnelName;
    private String tunnelHostname;
    private Integer tunnelAppPort;
    private String cloudfareTunnelId;
    private String cloudfareTunnelUrl;

    @Column(columnDefinition = "TEXT")
    private String deployDir;

    private String resolvedCommitSha;

    @Column(columnDefinition = "TEXT")
    private String webhookUrl;

    /** When set, env vars are pulled live from Infisical at each deploy instead of stored config text. */
    private String infisicalEnvironment;
    private String infisicalSecretPath;

    /** Restic repository encryption password, generated on first volume backup for this deployment. */
    @Convert(converter = com.automationcenter.converter.AesGcmConverter.class)
    @Column(columnDefinition = "TEXT")
    private String resticRepoPassword;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "machine_id")
    private Machine machine;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    private User owner;

    private LocalDateTime startedAt;

    private LocalDateTime finishedAt;

    @CreationTimestamp
    private LocalDateTime createdAt;
}
