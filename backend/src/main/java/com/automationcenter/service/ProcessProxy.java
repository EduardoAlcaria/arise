package com.automationcenter.service;

import com.jcraft.jsch.Proxy;
import com.jcraft.jsch.SocketFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;

public class ProcessProxy implements Proxy {

    private static final Logger log = LoggerFactory.getLogger(ProcessProxy.class);

    private final String commandTemplate;
    private Process process;

    public ProcessProxy(String commandTemplate) {
        this.commandTemplate = commandTemplate;
    }

    @Override
    public void connect(SocketFactory socketFactory, String host, int port, int timeout) throws Exception {
        String cmd = commandTemplate
                .replace("%h", host)
                .replace("%p", String.valueOf(port));
        log.debug("ProcessProxy spawning: {}", cmd);
        process = new ProcessBuilder("sh", "-c", cmd)
                .redirectErrorStream(false)
                .start();
        // Brief pause to catch immediate failures (e.g. cloudflared not found or auth error)
        try {
            Thread.sleep(150);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        if (!process.isAlive()) {
            throw new IOException("Proxy subprocess exited immediately (exit code " + process.exitValue() + "). Command: " + cmd);
        }
        log.debug("ProcessProxy subprocess alive, handing off to JSch");
    }

    @Override
    public InputStream getInputStream() {
        return process.getInputStream();
    }

    @Override
    public OutputStream getOutputStream() {
        return process.getOutputStream();
    }

    @Override
    public Socket getSocket() {
        return null;
    }

    @Override
    public void close() {
        if (process != null) {
            process.destroy();
        }
    }
}
