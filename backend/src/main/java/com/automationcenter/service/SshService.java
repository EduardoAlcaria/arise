package com.automationcenter.service;

import com.automationcenter.dto.machine.SshCommandResponse;
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

    public SshCommandResponse execute(String host, int port, String username, String privateKey, String command) {
        JSch jsch = new JSch();
        Session session = null;
        try {
            jsch.addIdentity("key", privateKey.getBytes(StandardCharsets.UTF_8), null, null);

            session = jsch.getSession(username, host, port);
            session.setConfig("StrictHostKeyChecking", "no");
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

    public SshCommandResponse writeFileViaShell(String host, int port, String username, String privateKey,
                                                 String remotePath, String content) {
        String b64 = Base64.getEncoder().encodeToString(content.getBytes(StandardCharsets.UTF_8));
        String cmd = "mkdir -p \"$(dirname '" + remotePath + "')\" && echo '" + b64 + "' | base64 -d > '" + remotePath + "'";
        return execute(host, port, username, privateKey, cmd);
    }
}
