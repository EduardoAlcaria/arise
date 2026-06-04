package com.automationcenter.service;

import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.Machine;
import com.automationcenter.entity.TunnelType;
import com.automationcenter.util.LineBuffer;
import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.function.Consumer;

@Service
@Slf4j
public class SshService {

    private static final int CONNECT_TIMEOUT_MS = 30_000;

    private final SshHostKeyStore hostKeyStore;

    @Value("${ssh.command-timeout-seconds:120}")
    private long defaultTimeoutSeconds;

    @Value("${ssh.long-command-timeout-seconds:1800}")
    private long longTimeoutSeconds;

    public SshService(SshHostKeyStore hostKeyStore) {
        this.hostKeyStore = hostKeyStore;
    }

    /** Long timeout for heavy operations (clone, compose build, runner install). */
    public long longTimeoutSeconds() {
        return longTimeoutSeconds;
    }

    /**
     * Build a configured, ready-to-connect JSch Session for the given machine.
     * Handles DIRECT, CLOUDFLARE_TCP, and PROXY_COMMAND tunnel modes.
     * Caller must call session.connect(timeout) and session.disconnect().
     */
    public Session openSession(Machine machine) throws Exception {
        JSch jsch = new JSch();
        jsch.addIdentity("key", machine.getPrivateKey().getBytes(StandardCharsets.UTF_8), null, null);
        jsch.setHostKeyRepository(hostKeyStore.repositoryFor(machine.getId()));

        TunnelType tunnelType = machine.getTunnelType() != null ? machine.getTunnelType() : TunnelType.DIRECT;

        return switch (tunnelType) {
            case CLOUDFLARE_TCP -> openCloudflaredTcpSession(jsch, machine);
            case PROXY_COMMAND -> {
                Session session = jsch.getSession(machine.getSshUser(), machine.getHost(), machine.getPort());
                session.setConfig("StrictHostKeyChecking", "yes");
                if (machine.getProxyCommand() != null && !machine.getProxyCommand().isBlank()) {
                    session.setProxy(new ProcessProxy(machine.getProxyCommand()));
                }
                yield session;
            }
            default -> {
                Session session = jsch.getSession(machine.getSshUser(), machine.getHost(), machine.getPort());
                session.setConfig("StrictHostKeyChecking", "yes");
                yield session;
            }
        };
    }

    private Session openCloudflaredTcpSession(JSch jsch, Machine machine) throws Exception {
        int localPort = findFreePort();
        log.debug("Starting cloudflared access tcp for {} on localhost:{}", machine.getHost(), localPort);

        Process proc = new ProcessBuilder(
                "cloudflared", "access", "tcp",
                "--hostname", machine.getHost(),
                "--url", "localhost:" + localPort)
                .redirectErrorStream(false)
                .start();

        try {
            waitForLocalPort(localPort, 10_000, proc);
            // cloudflared binds the port before the outbound QUIC tunnel is ready.
            // A short pause lets the edge connection establish before JSch hits it.
            Thread.sleep(1_500);
        } catch (IOException e) {
            proc.destroyForcibly();
            throw e;
        } catch (InterruptedException e) {
            proc.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted while waiting for cloudflared tunnel");
        }

        Session session = jsch.getSession(machine.getSshUser(), "127.0.0.1", localPort);
        session.setConfig("StrictHostKeyChecking", "yes");

        // Kill cloudflared when the JSch session closes.
        // Must wait for connect() to be called first — isConnected() is false until then.
        Thread cleanup = new Thread(() -> {
            // Phase 1: wait for session to become connected (connect() called by caller)
            long deadline = System.currentTimeMillis() + 35_000;
            while (!session.isConnected() && System.currentTimeMillis() < deadline) {
                if (!proc.isAlive()) return; // cloudflared died on its own
                try { Thread.sleep(100); } catch (InterruptedException e) { Thread.currentThread().interrupt(); proc.destroyForcibly(); return; }
            }
            if (!session.isConnected()) {
                proc.destroyForcibly(); // connect() timed out or failed
                return;
            }
            // Phase 2: watch for disconnect
            while (session.isConnected()) {
                try { Thread.sleep(500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            }
            proc.destroyForcibly();
            log.debug("cloudflared tcp proxy terminated for machine {}", machine.getId());
        }, "cf-cleanup-" + machine.getId());
        cleanup.setDaemon(true);
        cleanup.start();

        return session;
    }

    private int findFreePort() throws IOException {
        try (ServerSocket s = new ServerSocket(0)) {
            return s.getLocalPort();
        }
    }

    private void waitForLocalPort(int port, int timeoutMs, Process proc) throws IOException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (!proc.isAlive()) {
                throw new IOException("cloudflared exited immediately (exit code " + proc.exitValue() + ")");
            }
            try (Socket s = new Socket("127.0.0.1", port)) {
                return;
            } catch (IOException ignored) {
                try { Thread.sleep(100); } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Interrupted while waiting for cloudflared");
                }
            }
        }
        throw new IOException("cloudflared did not bind on localhost:" + port + " within " + timeoutMs + "ms");
    }

    /** Execute a command with the default timeout, no streaming. */
    public SshCommandResponse execute(Machine machine, String command) {
        return execute(machine, command, defaultTimeoutSeconds, null);
    }

    /** Execute a command with an explicit timeout, no streaming. */
    public SshCommandResponse execute(Machine machine, String command, long timeoutSeconds) {
        return execute(machine, command, timeoutSeconds, null);
    }

    /**
     * Execute a command with a timeout and optional live line streaming.
     * stdout lines are delivered to {@code onLine} as they arrive; the full
     * stdout/stderr text is still accumulated for the returned response so
     * exit-code and string checks keep working. On timeout the channel is
     * disconnected and exit code -1 is returned with a timeout message.
     */
    public SshCommandResponse execute(Machine machine, String command, long timeoutSeconds, Consumer<String> onLine) {
        Session session = null;
        try {
            session = openSession(machine);
            session.connect(CONNECT_TIMEOUT_MS);

            ChannelExec channel = (ChannelExec) session.openChannel("exec");
            // ChannelExec skips shell profile — prepend Homebrew + common paths so macOS tools are found
            String fullCommand = "export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH; " + command;
            channel.setCommand(fullCommand);

            InputStream stdoutStream = channel.getInputStream();
            InputStream stderrStream = channel.getExtInputStream();
            channel.connect();

            StringBuilder stdout = new StringBuilder();
            StringBuilder stderr = new StringBuilder();
            LineBuffer lineBuffer = onLine != null ? new LineBuffer(onLine) : null;

            byte[] buf = new byte[8192];
            long deadline = System.currentTimeMillis() + timeoutSeconds * 1000L;
            boolean timedOut = false;

            while (true) {
                while (stdoutStream.available() > 0) {
                    int n = stdoutStream.read(buf, 0, buf.length);
                    if (n < 0) break;
                    String chunk = new String(buf, 0, n, StandardCharsets.UTF_8);
                    stdout.append(chunk);
                    if (lineBuffer != null) lineBuffer.append(chunk);
                }
                while (stderrStream.available() > 0) {
                    int n = stderrStream.read(buf, 0, buf.length);
                    if (n < 0) break;
                    stderr.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                }
                if (channel.isClosed()) {
                    // drain any final bytes
                    while (stdoutStream.available() > 0) {
                        int n = stdoutStream.read(buf, 0, buf.length);
                        if (n < 0) break;
                        String chunk = new String(buf, 0, n, StandardCharsets.UTF_8);
                        stdout.append(chunk);
                        if (lineBuffer != null) lineBuffer.append(chunk);
                    }
                    while (stderrStream.available() > 0) {
                        int n = stderrStream.read(buf, 0, buf.length);
                        if (n < 0) break;
                        stderr.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                    }
                    break;
                }
                if (System.currentTimeMillis() > deadline) {
                    timedOut = true;
                    break;
                }
                Thread.sleep(100);
            }

            if (lineBuffer != null) lineBuffer.flush();

            if (timedOut) {
                channel.disconnect();
                return new SshCommandResponse(
                        stdout.toString(),
                        "Command timed out after " + timeoutSeconds + "s",
                        -1);
            }

            int exitCode = channel.getExitStatus();
            channel.disconnect();
            return new SshCommandResponse(stdout.toString(), stderr.toString(), exitCode);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new SshCommandResponse("", "Interrupted: " + e.getMessage(), -1);
        } catch (Exception e) {
            return new SshCommandResponse("", e.getMessage(), -1);
        } finally {
            if (session != null) session.disconnect();
        }
    }

    /** Write a file to the remote machine by base64-encoding content through a shell command. */
    public SshCommandResponse writeFileViaShell(Machine machine, String remotePath, String content) {
        String b64 = Base64.getEncoder().encodeToString(content.getBytes(StandardCharsets.UTF_8));
        String safePath = remotePath.replace("'", "'\\''");
        // b64 is [A-Za-z0-9+/=] only — printf is used instead of echo to avoid flag interpretation
        String cmd = "mkdir -p \"$(dirname '" + safePath + "')\" && printf '%s' '" + b64 + "' | base64 -d > '" + safePath + "'";
        return execute(machine, cmd);
    }
}
