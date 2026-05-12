package com.automationcenter.repository;

import com.automationcenter.entity.AwsAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AwsAccountRepository extends JpaRepository<AwsAccount, Long> {
    List<AwsAccount> findByOwnerId(Long ownerId);
    Optional<AwsAccount> findByIdAndOwnerId(Long id, Long ownerId);
}
