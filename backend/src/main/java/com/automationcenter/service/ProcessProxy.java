package com.automationcenter.service;

import com.jcraft.jsch.Proxy;
import com.jcraft.jsch.SocketFactory;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;

public class ProcessProxy implements Proxy {

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
        // Use sh -c so the command string is parsed by the shell (handles flags correctly)
        process = new ProcessBuilder("sh", "-c", cmd)
                .redirectErrorStream(false)  // keep stderr separate — merging would corrupt the SSH binary stream
                .start();
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
        return null; // not a socket-based proxy
    }

    @Override
    public void close() {
        if (process != null) {
            process.destroy();
        }
    }
}
