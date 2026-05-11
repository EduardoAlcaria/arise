package com.automationcenter.service;

import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.Machine;
import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

@Service
public class SshService {

    private static final int CONNECT_TIMEOUT_MS = 30_000;

    /**
     * Build a configured, ready-to-connect JSch Session for the given machine.
     * Wires in ProcessProxy when machine.proxyCommand is set.
     * Caller is responsible for calling session.connect(timeout) and session.disconnect().
     */
    public Session openSession(Machine machine) throws Exception {
        JSch jsch = new JSch();
        jsch.addIdentity("key", machine.getPrivateKey().getBytes(StandardCharsets.UTF_8), null, null);
        Session session = jsch.getSession(machine.getSshUser(), machine.getHost(), machine.getPort());
        session.setConfig("StrictHostKeyChecking", "no");
        if (machine.getProxyCommand() != null && !machine.getProxyCommand().isBlank()) {
            session.setProxy(new ProcessProxy(machine.getProxyCommand()));
        }
        return session;
    }

    /** Execute a single command on the machine, return stdout/stderr/exitCode. */
    public SshCommandResponse execute(Machine machine, String command) {
        Session session = null;
        try {
            session = openSession(machine);
            session.connect(CONNECT_TIMEOUT_MS);

            ChannelExec channel = (ChannelExec) session.openChannel("exec");
            channel.setCommand(command);

            ByteArrayOutputStream stdout = new ByteArrayOutputStream();
            ByteArrayOutputStream stderr = new ByteArrayOutputStream();
            channel.setOutputStream(stdout);
            channel.setErrStream(stderr);
            channel.connect();

            while (!channel.isClosed()) {
                Thread.sleep(100);
            }

            int exitCode = channel.getExitStatus();
            channel.disconnect();

            return new SshCommandResponse(
                    stdout.toString(StandardCharsets.UTF_8),
                    stderr.toString(StandardCharsets.UTF_8),
                    exitCode
            );
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
        String cmd = "mkdir -p \"$(dirname '" + remotePath + "')\" && echo '" + b64 + "' | base64 -d > '" + remotePath + "'";
        return execute(machine, cmd);
    }
}
