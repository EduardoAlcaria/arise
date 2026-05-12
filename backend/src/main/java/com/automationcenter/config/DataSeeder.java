package com.automationcenter.config;

import com.automationcenter.entity.*;
import com.automationcenter.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

@Component
@RequiredArgsConstructor
@Slf4j
public class DataSeeder implements CommandLineRunner {

    private final UserRepository userRepository;
    private final MachineRepository machineRepository;
    private final DeploymentRepository deploymentRepository;
    private final AwsAccountRepository awsAccountRepository;
    private final PasswordEncoder passwordEncoder;

    static final String DEMO_EMAIL = "demo@automationhub.dev";
    static final String DEMO_PROFILE = "demo-profile";

    @Override
    public void run(String... args) {
        if (userRepository.existsByEmail(DEMO_EMAIL)) {
            log.info("Demo seed already present — skipping.");
            return;
        }
        log.info("Seeding demo data…");

        User demo = userRepository.save(User.builder()
                .email(DEMO_EMAIL)
                .password(passwordEncoder.encode("Demo1234!"))
                .name("Demo User")
                .role(Role.USER)
                .build());

        // ── Machines ──────────────────────────────────────────────────────────

        Machine macPro = machineRepository.save(Machine.builder()
                .name("Mac Pro (demo)")
                .host("demo-mac.internal")
                .port(22)
                .sshUser("admin")
                .privateKey(PLACEHOLDER_KEY)
                .tunnelType(TunnelType.DIRECT)
                .status(MachineStatus.ONLINE)
                .lastSeen(LocalDateTime.now().minusMinutes(4))
                .owner(demo)
                .build());

        Machine linuxBox = machineRepository.save(Machine.builder()
                .name("Ubuntu Server (demo)")
                .host("demo-ubuntu.internal")
                .port(22)
                .sshUser("ubuntu")
                .privateKey(PLACEHOLDER_KEY)
                .tunnelType(TunnelType.DIRECT)
                .status(MachineStatus.OFFLINE)
                .lastSeen(LocalDateTime.now().minusHours(3))
                .owner(demo)
                .build());

        // ── Deployments ───────────────────────────────────────────────────────

        deploymentRepository.save(Deployment.builder()
                .name("react-dashboard")
                .type(DeploymentType.REPOSITORY)
                .status(DeploymentStatus.SUCCESS)
                .repositoryUrl("https://github.com/demo/react-dashboard.git")
                .branch("main")
                .detectedStack("Node.js")
                .resolvedCommitSha("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")
                .tunnelName("demo-react-tunnel")
                .tunnelHostname("dashboard.demo.alcaria.dev")
                .tunnelAppPort(3000)
                .machine(macPro)
                .owner(demo)
                .startedAt(LocalDateTime.now().minusDays(3))
                .finishedAt(LocalDateTime.now().minusDays(3).plusMinutes(3))
                .logs("""
                        [INFO] Cloning repository…
                        [INFO] Checked out commit a1b2c3d
                        [INFO] Detected stack: Node.js (package.json found)
                        [INFO] Running: npm install
                        [INFO] Running: npm run build
                        [INFO] Build output: dist/
                        [INFO] Starting: npm run preview -- --port 3000
                        [INFO] ✓ Deployment successful. Tunnel: https://dashboard.demo.alcaria.dev
                        """)
                .build());

        deploymentRepository.save(Deployment.builder()
                .name("express-api")
                .type(DeploymentType.REPOSITORY)
                .status(DeploymentStatus.SUCCESS)
                .repositoryUrl("https://github.com/demo/express-api.git")
                .branch("main")
                .detectedStack("Node.js")
                .resolvedCommitSha("b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3")
                .tunnelName("demo-api-tunnel")
                .tunnelHostname("api.demo.alcaria.dev")
                .tunnelAppPort(8080)
                .machine(macPro)
                .owner(demo)
                .startedAt(LocalDateTime.now().minusDays(1))
                .finishedAt(LocalDateTime.now().minusDays(1).plusMinutes(2))
                .logs("""
                        [INFO] Cloning repository…
                        [INFO] Detected stack: Node.js
                        [INFO] Running: npm install
                        [INFO] Starting: node server.js
                        [INFO] ✓ Deployment successful. Tunnel: https://api.demo.alcaria.dev
                        """)
                .build());

        deploymentRepository.save(Deployment.builder()
                .name("python-etl")
                .type(DeploymentType.REPOSITORY)
                .status(DeploymentStatus.FAILED)
                .repositoryUrl("https://github.com/demo/python-etl.git")
                .branch("feature/new-pipeline")
                .detectedStack("Python")
                .machine(linuxBox)
                .owner(demo)
                .startedAt(LocalDateTime.now().minusHours(5))
                .finishedAt(LocalDateTime.now().minusHours(5).plusMinutes(1))
                .logs("""
                        [INFO] Cloning repository…
                        [INFO] Detected stack: Python
                        [INFO] Running: pip install -r requirements.txt
                        [ERROR] Port 5000 already in use — cannot start server.
                        [ERROR] ✗ Deployment failed.
                        """)
                .build());

        deploymentRepository.save(Deployment.builder()
                .name("next-blog")
                .type(DeploymentType.REPOSITORY)
                .status(DeploymentStatus.BUILDING)
                .repositoryUrl("https://github.com/demo/next-blog.git")
                .branch("main")
                .detectedStack("Node.js")
                .machine(macPro)
                .owner(demo)
                .startedAt(LocalDateTime.now().minusMinutes(2))
                .logs("""
                        [INFO] Cloning repository…
                        [INFO] Detected stack: Node.js (Next.js)
                        [INFO] Running: npm install
                        """)
                .build());

        // ── SixEyes demo deployments ──────────────────────────────────────────

        deploymentRepository.save(Deployment.builder()
                .name("sixeyes (full stack)")
                .type(DeploymentType.REPOSITORY)
                .status(DeploymentStatus.SUCCESS)
                .repositoryUrl("https://github.com/EduardoAlcaria/sixeyes")
                .branch("demonstration")
                .detectedStack("compose")
                .resolvedCommitSha("fdb8b225e1a3c4d9b12e8a77f6301c4d9e2b1a3f")
                .tunnelName("demo-sixeyes-tunnel")
                .tunnelHostname("sixeyes.demo.alcaria.dev")
                .tunnelAppPort(4000)
                .machine(macPro)
                .owner(demo)
                .startedAt(LocalDateTime.now().minusDays(2))
                .finishedAt(LocalDateTime.now().minusDays(2).plusMinutes(5))
                .logs("""
                        [INFO] Cloning repository…
                        [INFO] Checked out commit fdb8b22
                        [INFO] Target OS: Darwin
                        [INFO] Detected stack: compose (docker-compose.yml found)
                        [INFO] Running build: docker compose up --build -d
                        [INFO] Building sixeyes-python…
                        [INFO] Building sixeyes-java…
                        [INFO] Building sixeyes-frontend…
                        [INFO] Starting sixeyes-db, sixeyes-ngrok-db, sixeyes-python, sixeyes-java, sixeyes-frontend
                        [INFO] Creating Cloudflare tunnel: demo-sixeyes-tunnel
                        [INFO] Tunnel active: https://sixeyes.demo.alcaria.dev
                        [INFO] ✓ Deployment successful.
                        """)
                .build());

        deploymentRepository.save(Deployment.builder()
                .name("sixeyes-api + sixeyes-dashboard")
                .type(DeploymentType.APPLICATION)
                .status(DeploymentStatus.SUCCESS)
                .applicationServices("""
                        [{"name":"sixeyes-api","repoUrl":"https://github.com/EduardoAlcaria/sixeyes","branch":"demonstration"},\
                        {"name":"sixeyes-dashboard","repoUrl":"https://github.com/EduardoAlcaria/sixeyes","branch":"demonstration"}]""")
                .applicationConfigs("""
                        [{"path":"docker-compose.yml","content":"# generated"}]""")
                .tunnelName("demo-sixeyes-app-tunnel")
                .tunnelHostname("sixeyes-app.demo.alcaria.dev")
                .tunnelAppPort(4000)
                .machine(macPro)
                .owner(demo)
                .startedAt(LocalDateTime.now().minusDays(1))
                .finishedAt(LocalDateTime.now().minusDays(1).plusMinutes(7))
                .logs("""
                        [INFO] Starting application deployment: sixeyes-api + sixeyes-dashboard
                        [INFO] Cloning service sixeyes-api (branch: demonstration)…
                        [INFO] Cloning service sixeyes-dashboard (branch: demonstration)…
                        [INFO] Writing config: docker-compose.yml
                        [INFO] Running docker compose up --build -d
                        [INFO] All services started successfully
                        [INFO] Creating Cloudflare tunnel: demo-sixeyes-app-tunnel
                        [INFO] Tunnel active: https://sixeyes-app.demo.alcaria.dev
                        [INFO] ✓ Application deployed successfully.
                        """)
                .build());

        // ── AWS account ───────────────────────────────────────────────────────

        awsAccountRepository.save(AwsAccount.builder()
                .name("Demo AWS (us-east-1)")
                .profileName(DEMO_PROFILE)
                .defaultRegion("us-east-1")
                .owner(demo)
                .build());

        log.info("Demo seed complete. Login: {} / Demo1234!", DEMO_EMAIL);
    }

    // Placeholder key — never used for real SSH, just satisfies NOT NULL constraint
    private static final String PLACEHOLDER_KEY = """
            -----BEGIN RSA PRIVATE KEY-----
            DEMO_PLACEHOLDER_NOT_A_REAL_KEY_DO_NOT_USE
            -----END RSA PRIVATE KEY-----
            """;
}
