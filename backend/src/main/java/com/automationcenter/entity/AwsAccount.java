package com.automationcenter.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "aws_accounts")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AwsAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String profileName;

    @Column(nullable = false, length = 50)
    private String defaultRegion;

    @Column(columnDefinition = "TEXT")
    private String terraformRepoUrl;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    private User owner;

    @CreationTimestamp
    private LocalDateTime createdAt;
}
