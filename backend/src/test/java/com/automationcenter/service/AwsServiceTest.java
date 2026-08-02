package com.automationcenter.service;

import com.automationcenter.config.DataSeeder;
import com.automationcenter.config.MockAwsData;
import com.automationcenter.entity.AwsAccount;
import com.automationcenter.repository.AwsAccountRepository;
import com.automationcenter.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.cache.CacheManager;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Covers the demo-profile EC2 mock path: start/stop/terminate must mutate
 * {@link MockAwsData}'s in-memory state instead of calling real AWS, so the demo
 * account (no AWS credentials) still gets working EC2 actions.
 */
@ExtendWith(MockitoExtension.class)
class AwsServiceTest {

    @Mock private AwsAccountRepository accountRepository;
    @Mock private UserRepository userRepository;
    @Mock private CacheManager cacheManager;

    private AwsService newService() {
        return new AwsService(accountRepository, userRepository, cacheManager);
    }

    private static final Long USER_ID = 1L;
    private static final Long ACCOUNT_ID = 1L;
    private static final String INSTANCE_ID = "i-0a1b2c3d4e5f00003";

    @Test
    void startInstanceOnDemoProfileMocksStateInsteadsOfCallingRealAws() {
        AwsAccount account = AwsAccount.builder().id(ACCOUNT_ID)
                .profileName(DataSeeder.getDemoProfile()).defaultRegion("us-east-1").build();
        when(accountRepository.findByIdAndOwnerId(ACCOUNT_ID, USER_ID)).thenReturn(Optional.of(account));
        lenient().when(cacheManager.getCache(org.mockito.ArgumentMatchers.anyString())).thenReturn(null);

        newService().startInstance(USER_ID, ACCOUNT_ID, INSTANCE_ID, null);

        assertThat(MockAwsData.ec2Instances("us-east-1"))
                .filteredOn(m -> INSTANCE_ID.equals(m.get("instanceId")))
                .extracting(m -> m.get("state"))
                .containsExactly("running");
    }

    @Test
    void stopInstanceOnDemoProfileMocksState() {
        AwsAccount account = AwsAccount.builder().id(ACCOUNT_ID)
                .profileName(DataSeeder.getDemoProfile()).defaultRegion("us-east-1").build();
        when(accountRepository.findByIdAndOwnerId(ACCOUNT_ID, USER_ID)).thenReturn(Optional.of(account));
        lenient().when(cacheManager.getCache(org.mockito.ArgumentMatchers.anyString())).thenReturn(null);

        newService().stopInstance(USER_ID, ACCOUNT_ID, INSTANCE_ID, null);

        assertThat(MockAwsData.ec2Instances("us-east-1"))
                .filteredOn(m -> INSTANCE_ID.equals(m.get("instanceId")))
                .extracting(m -> m.get("state"))
                .containsExactly("stopped");
    }
}
