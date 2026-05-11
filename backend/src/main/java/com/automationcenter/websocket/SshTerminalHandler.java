package com.automationcenter.websocket;

import com.automationcenter.entity.Machine;
import com.automationcenter.entity.User;
import com.automationcenter.repository.UserRepository;
import com.automationcenter.security.JwtService;
import com.automationcenter.service.MachineService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.automationcenter.service.SshService;
import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.Session;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
@RequiredArgsConstructor
@Slf4j
public class SshTerminalHandler extends AbstractWebSocketHandler {

    private final MachineService machineService;
    private final SshService sshService;
    private final JwtService jwtService;
    private final UserDetailsService userDetailsService;
    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;

    private static final Map<String, TerminalSession> SESSIONS = new ConcurrentHashMap<>();

    private record TerminalSession(Session jschSession, ChannelShell channel, OutputStream stdin) {}

    @Override
    public void afterConnectionEstablished(WebSocketSession ws) throws Exception {
        String query = ws.getUri() != null ? ws.getUri().getQuery() : null;
        String path  = ws.getUri() != null ? ws.getUri().getPath()  : "";
        String token = extractParam(query, "token");

        // Extract machineId from path tail
        String[] segments = path.split("/");
        long machineId;
        try {
            machineId = Long.parseLong(segments[segments.length - 1]);
        } catch (NumberFormatException e) {
            ws.close(CloseStatus.BAD_DATA);
            return;
        }

        // Validate JWT
        String email;
        try {
            email = jwtService.extractUsername(token);
            UserDetails ud = userDetailsService.loadUserByUsername(email);
            if (!jwtService.isTokenValid(token, ud)) {
                ws.close(new CloseStatus(4001, "Unauthorized"));
                return;
            }
        } catch (Exception e) {
            ws.close(new CloseStatus(4001, "Unauthorized"));
            return;
        }

        User user = userRepository.findByEmail(email).orElse(null);
        if (user == null) {
            ws.close(new CloseStatus(4001, "User not found"));
            return;
        }

        Machine machine;
        try {
            machine = machineService.findByIdAndOwner(machineId, user.getId());
        } catch (Exception e) {
            if (ws.isOpen()) {
                ws.sendMessage(new TextMessage("\r\n[31mMachine not found[0m\r\n"));
                ws.close();
            }
            return;
        }

        try {
            Session jschSession = sshService.openSession(machine);
            jschSession.connect(15_000);

            ChannelShell channel = (ChannelShell) jschSession.openChannel("shell");
            channel.setPtyType("xterm-256color");
            channel.setPtySize(220, 50, 1760, 800);

            PipedOutputStream stdinSink   = new PipedOutputStream();
            PipedInputStream  stdinSource = new PipedInputStream(stdinSink, 65536);
            channel.setInputStream(stdinSource);

            InputStream stdout = channel.getInputStream();
            channel.connect();

            SESSIONS.put(ws.getId(), new TerminalSession(jschSession, channel, stdinSink));

            // Forward SSH stdout → WebSocket
            Thread reader = new Thread(() -> {
                byte[] buf = new byte[4096];
                try {
                    int n;
                    while (!channel.isClosed() && (n = stdout.read(buf)) != -1) {
                        if (ws.isOpen()) {
                            synchronized (ws) {
                                ws.sendMessage(new BinaryMessage(buf, 0, n, true));
                            }
                        }
                    }
                } catch (IOException ignored) {
                } finally {
                    try { ws.close(); } catch (IOException ignored) {}
                }
            }, "ssh-out-" + ws.getId());
            reader.setDaemon(true);
            reader.start();

        } catch (Exception e) {
            log.warn("SSH connect failed for machine {}: {}", machineId, e.getMessage());
            if (ws.isOpen()) {
                ws.sendMessage(new TextMessage("\r\n[31mSSH error: " + e.getMessage() + "[0m\r\n"));
                ws.close();
            }
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession ws, TextMessage message) throws IOException {
        TerminalSession ts = SESSIONS.get(ws.getId());
        if (ts == null) return;

        String payload = message.getPayload();
        if (payload.startsWith("{")) {
            try {
                JsonNode node = objectMapper.readTree(payload);
                if ("resize".equals(node.path("type").asText())) {
                    int cols = node.path("cols").asInt(80);
                    int rows = node.path("rows").asInt(24);
                    ts.channel().setPtySize(cols, rows, cols * 8, rows * 16);
                    return;
                }
            } catch (Exception ignored) {}
        }

        ts.stdin().write(payload.getBytes(StandardCharsets.UTF_8));
        ts.stdin().flush();
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession ws, BinaryMessage message) throws IOException {
        TerminalSession ts = SESSIONS.get(ws.getId());
        if (ts == null) return;
        byte[] arr   = message.getPayload().array();
        int    limit = message.getPayload().limit();
        ts.stdin().write(arr, 0, limit);
        ts.stdin().flush();
    }

    @Override
    public void afterConnectionClosed(WebSocketSession ws, CloseStatus status) {
        TerminalSession ts = SESSIONS.remove(ws.getId());
        if (ts != null) {
            try { ts.stdin().close(); } catch (IOException ignored) {}
            ts.channel().disconnect();
            ts.jschSession().disconnect();
        }
    }

    private static String extractParam(String query, String name) {
        if (query == null) return null;
        for (String kv : query.split("&")) {
            int eq = kv.indexOf('=');
            if (eq > 0 && kv.substring(0, eq).equals(name)) return kv.substring(eq + 1);
        }
        return null;
    }
}
