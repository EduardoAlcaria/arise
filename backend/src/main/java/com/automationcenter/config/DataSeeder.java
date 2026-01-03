package com.automationcenter.config;

import com.automationcenter.entity.*;
import com.automationcenter.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.Map;

@Component
@RequiredArgsConstructor
@Slf4j
public class DataSeeder implements CommandLineRunner {

    private final UserRepository userRepository;
    private final MachineRepository machineRepository;
    private final DeploymentRepository deploymentRepository;
    private final AwsAccountRepository awsAccountRepository;
    private final LogEntryRepository logEntryRepository;
    private final ContainerDeploymentRepository containerDeploymentRepository;
    private final PasswordEncoder passwordEncoder;

    static final String DEMO_EMAIL = "demo@automationhub.dev";
    static final String DEMO_PROFILE = "demo-profile";


    public static String getDemoProfile() {
        return DEMO_PROFILE;
    }

    public static String getDemoEmail() {
        return DEMO_EMAIL;
    }

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

        Machine edgeNode = machineRepository.save(Machine.builder()
                .name("Edge Node (demo)")
                .host("demo-edge.alcaria.dev")
                .port(22)
                .sshUser("edge")
                .privateKey(PLACEHOLDER_KEY)
                .tunnelType(TunnelType.PROXY_COMMAND)
                .proxyCommand("cloudflared access ssh --hostname %h")
                .status(MachineStatus.ONLINE)
                .lastSeen(LocalDateTime.now().minusMinutes(1))
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
                .cloudfareTunnelId("aaa00001-demo-0000-0000-react-000000000001")
                .cloudfareTunnelUrl("https://aaa00001-demo-0000-0000-react-000000000001.cfargotunnel.com")
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
                .cloudfareTunnelId("bbb00002-demo-0000-0000-api-0000000000002")
                .cloudfareTunnelUrl("https://bbb00002-demo-0000-0000-api-0000000000002.cfargotunnel.com")
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
                // intentionally no tunnel — tests "failed deploy, no tunnel" path
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

        deploymentRepository.save(Deployment.builder()
                .name("spring-worker")
                .type(DeploymentType.REPOSITORY)
                .status(DeploymentStatus.SUCCESS)
                .repositoryUrl("https://github.com/demo/spring-worker.git")
                .branch("main")
                .detectedStack("Java / Maven")
                .resolvedCommitSha("c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4")
                .tunnelName("demo-worker-tunnel")
                .tunnelHostname("worker.demo.alcaria.dev")
                .tunnelAppPort(8081)
                .cloudfareTunnelId("ccc00003-demo-0000-0000-worker-000000003")
                .cloudfareTunnelUrl("https://ccc00003-demo-0000-0000-worker-000000003.cfargotunnel.com")
                .machine(edgeNode)
                .owner(demo)
                .startedAt(LocalDateTime.now().minusDays(2))
                .finishedAt(LocalDateTime.now().minusDays(2).plusMinutes(6))
                .logs("""
                        [INFO] Cloning repository…
                        [INFO] Detected stack: Java / Maven (pom.xml found)
                        [INFO] Running: mvn package -DskipTests
                        [INFO] BUILD SUCCESS
                        [INFO] Starting service on port 8081
                        [INFO] Creating Cloudflare tunnel: demo-worker-tunnel
                        [INFO] ✓ Deployment successful. Tunnel: https://worker.demo.alcaria.dev
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
                .cloudfareTunnelId("ddd00004-demo-0000-0000-sixeyes-000004")
                .cloudfareTunnelUrl("https://ddd00004-demo-0000-0000-sixeyes-000004.cfargotunnel.com")
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

        // ── Log entries (for react-dashboard — tests historic log viewer) ─────

        Deployment reactDep = deploymentRepository.findAll().stream()
                .filter(d -> "react-dashboard".equals(d.getName()) && d.getOwner().getId().equals(demo.getId()))
                .findFirst().orElse(null);
        if (reactDep != null) {
            String[] lines = {
                "Cloning repository…",
                "Checked out commit a1b2c3d",
                "Detected stack: Node.js (package.json found)",
                "Running: npm install",
                "added 1423 packages in 18s",
                "Running: npm run build",
                "> react-dashboard@1.0.0 build",
                "> vite build",
                "vite v5.2.0 building for production…",
                "dist/index.html  0.46 kB",
                "dist/assets/index-BgXt2V.js  312.40 kB",
                "✓ built in 4.12s",
                "Starting: npm run preview -- --port 3000",
                "Creating Cloudflare tunnel: demo-react-tunnel",
                "✓ Deployment successful. Tunnel: https://dashboard.demo.alcaria.dev"
            };
            LogLevel[] levels = {LogLevel.INFO,LogLevel.INFO,LogLevel.INFO,LogLevel.INFO,LogLevel.INFO,
                LogLevel.INFO,LogLevel.INFO,LogLevel.INFO,LogLevel.INFO,LogLevel.INFO,
                LogLevel.INFO,LogLevel.INFO,LogLevel.INFO,LogLevel.INFO,LogLevel.INFO};
            for (int i = 0; i < lines.length; i++) {
                logEntryRepository.save(LogEntry.builder()
                        .deployment(reactDep)
                        .message(lines[i])
                        .level(levels[i])
                        .build());
            }
        }

        // Log entries for python-etl (FAILED) — tests error log display
        Deployment etlDep = deploymentRepository.findAll().stream()
                .filter(d -> "python-etl".equals(d.getName()) && d.getOwner().getId().equals(demo.getId()))
                .findFirst().orElse(null);
        if (etlDep != null) {
            String[][] etlLines = {
                {"Cloning repository…", "INFO"},
                {"Detected stack: Python", "INFO"},
                {"Running: pip install -r requirements.txt", "INFO"},
                {"Port 5000 already in use — cannot start server.", "ERROR"},
                {"✗ Deployment failed.", "ERROR"}
            };
            for (String[] entry : etlLines) {
                logEntryRepository.save(LogEntry.builder()
                        .deployment(etlDep)
                        .message(entry[0])
                        .level(LogLevel.valueOf(entry[1]))
                        .build());
            }
        }

        // ── Container deployment (tests Containers page) ──────────────────────

        containerDeploymentRepository.save(ContainerDeployment.builder()
                .name("nginx-demo")
                .image("nginx:latest")
                .hostPort(8090)
                .containerPort(80)
                .containerId("demo-container-nginx-abc123")
                .status(ContainerStatus.RUNNING)
                .envVars(Map.of("NGINX_HOST", "demo.local", "NGINX_PORT", "80"))
                .machine(macPro)
                .owner(demo)
                .build());

        containerDeploymentRepository.save(ContainerDeployment.builder()
                .name("redis-demo")
                .image("redis:7-alpine")
                .hostPort(6380)
                .containerPort(6379)
                .containerId("demo-container-redis-def456")
                .status(ContainerStatus.STOPPED)
                .machine(linuxBox)
                .owner(demo)
                .build());

        // ── AWS accounts (2 regions — tests multi-region explorer) ────────────

        awsAccountRepository.save(AwsAccount.builder()
                .name("Demo AWS (us-east-1)")
                .profileName(DEMO_PROFILE)
                .defaultRegion("us-east-1")
                .owner(demo)
                .build());

        awsAccountRepository.save(AwsAccount.builder()
                .name("Demo AWS (us-west-2)")
                .profileName(DEMO_PROFILE)
                .defaultRegion("us-west-2")
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
