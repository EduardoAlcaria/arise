package com.automationcenter.service;

import com.automationcenter.config.RabbitMQConfig;
import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.*;
import com.automationcenter.repository.DeploymentRepository;
import com.automationcenter.repository.MachineRepository;
import com.automationcenter.repository.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Covers the SSH-driven deployment pipeline in {@link DeploymentService#executeAsync}
 * with {@link SshService} mocked at the seam — no real network/SSH involved.
 */
@ExtendWith(MockitoExtension.class)
class DeploymentServiceTest {

    @Mock private DeploymentRepository deploymentRepository;
    @Mock private UserRepository userRepository;
    @Mock private MachineService machineService;
    @Mock private MachineRepository machineRepository;
    @Mock private SshService sshService;
    @Mock private LogService logService;
    @Mock private RabbitTemplate rabbitTemplate;
    @Mock private CloudflareService cloudflareService;
    @Mock private LogBroadcaster logBroadcaster;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private DeploymentService service;
    private Machine machine;
    private Deployment deployment;

    private static final Long DEPLOYMENT_ID = 100L;
    private static final Long MACHINE_ID = 5L;
    private static final Long OWNER_ID = 1L;

    @BeforeEach
    void setUp() {
        service = new DeploymentService(deploymentRepository, userRepository, machineService,
                machineRepository, sshService, logService, rabbitTemplate, objectMapper,
                cloudflareService, logBroadcaster);
        // Real 60s/3s polling would make the health-gate test take a full minute; shrink it.
        ReflectionTestUtils.setField(service, "healthCheckTimeoutMs", 200L);
        ReflectionTestUtils.setField(service, "healthCheckIntervalMs", 40L);

        machine = Machine.builder().id(MACHINE_ID).name("prod-1").host("h").port(22)
                .sshUser("root").privateKey("key").tunnelType(TunnelType.DIRECT).build();
        User owner = User.builder().id(OWNER_ID).email("o@example.com").name("Owner").role(Role.USER).build();
        deployment = Deployment.builder().id(DEPLOYMENT_ID).name("widgets").type(DeploymentType.REPOSITORY)
                .repositoryUrl("https://github.com/acme/widgets.git").branch("main")
                .machine(machine).owner(owner).status(DeploymentStatus.PENDING).build();

        lenient().when(deploymentRepository.findById(DEPLOYMENT_ID)).thenReturn(Optional.of(deployment));
        lenient().when(deploymentRepository.save(any(Deployment.class))).thenAnswer(inv -> inv.getArgument(0));
        lenient().when(machineRepository.findById(MACHINE_ID)).thenReturn(Optional.of(machine));
        lenient().when(userRepository.findById(OWNER_ID)).thenReturn(Optional.of(owner));
        lenient().when(deploymentRepository
                        .findTopByRepositoryUrlAndMachine_IdAndTypeAndStatusAndIdNotOrderByCreatedAtDesc(
                                any(), any(), any(), any(), any()))
                .thenReturn(Optional.empty());

        SshCommandResponse ok = new SshCommandResponse("ok", "", 0);
        lenient().when(sshService.execute(any(Machine.class), anyString())).thenReturn(ok);
        lenient().when(sshService.execute(any(Machine.class), anyString(), anyLong())).thenReturn(ok);
        lenient().when(sshService.execute(any(Machine.class), anyString(), anyLong(), any())).thenReturn(ok);
        lenient().when(sshService.longTimeoutSeconds()).thenReturn(1800L);

        // .arise.yml absent
        lenient().when(sshService.execute(any(Machine.class), argThat(cmd -> cmd != null && cmd.contains(".arise.yml"))))
                .thenReturn(new SshCommandResponse("", "", 0));
        // stack detection: repo has a docker-compose.yml
        lenient().when(sshService.execute(any(Machine.class), argThat(cmd -> cmd != null && cmd.startsWith("ls "))))
                .thenReturn(new SshCommandResponse("docker-compose.yml", "", 0));
    }

    private void stubComposeHealth(String json) {
        lenient().when(sshService.execute(any(Machine.class), argThat(cmd -> cmd != null && cmd.contains("--format json"))))
                .thenReturn(new SshCommandResponse(json, "", 0));
    }

    @Test
    void executeAsyncHappyPathReachesSuccess() {
        stubComposeHealth("[{\"Service\":\"web\",\"State\":\"running\"}]");

        service.executeAsync(DEPLOYMENT_ID);

        assertThat(deployment.getStatus()).isEqualTo(DeploymentStatus.SUCCESS);
        assertThat(deployment.getDetectedStack()).isEqualTo("compose");
        verify(logBroadcaster).complete(DEPLOYMENT_ID);
        verify(rabbitTemplate).convertAndSend(RabbitMQConfig.DEPLOYMENT_EXCHANGE,
                RabbitMQConfig.DEPLOYMENT_ROUTING_KEY, "DEPLOYMENT_SUCCESS:" + DEPLOYMENT_ID);
    }

    @Test
    void executeAsyncMarksFailedWhenHealthGateNeverPasses() {
        stubComposeHealth("[{\"Service\":\"web\",\"State\":\"exited\",\"ExitCode\":1}]");

        service.executeAsync(DEPLOYMENT_ID);

        assertThat(deployment.getStatus()).isEqualTo(DeploymentStatus.FAILED);
        verify(rabbitTemplate).convertAndSend(RabbitMQConfig.DEPLOYMENT_EXCHANGE,
                RabbitMQConfig.DEPLOYMENT_ROUTING_KEY, "DEPLOYMENT_FAILED:" + DEPLOYMENT_ID);
    }

    @Test
    void executeAsyncStaysSuccessWhenTunnelFails() {
        deployment.setTunnelName("my-tunnel");
        deployment.setTunnelHostname("my-tunnel.example.com");
        deployment.setTunnelAppPort(8080);
        stubComposeHealth("[{\"Service\":\"web\",\"State\":\"running\"}]");
        when(cloudflareService.createTunnel(eq(OWNER_ID), any())).thenThrow(new RuntimeException("cloudflare down"));

        service.executeAsync(DEPLOYMENT_ID);

        assertThat(deployment.getStatus()).isEqualTo(DeploymentStatus.SUCCESS);
        verify(cloudflareService, never()).deleteTunnel(anyLong(), anyString());
    }
}
