package com.automationcenter.service;

import com.jcraft.jsch.HostKey;
import com.jcraft.jsch.HostKeyRepository;
import com.jcraft.jsch.UserInfo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.security.MessageDigest;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory Trust-On-First-Use (TOFU) SSH host key store.
 * First connection per machine: accepts and remembers the host key.
 * Subsequent connections: rejects if the key changed (MITM protection).
 * Keys are lost on restart — persistent storage is a future enhancement.
 */
@Component
@Slf4j
public class SshHostKeyStore {

    private final ConcurrentHashMap<Long, String> fingerprints = new ConcurrentHashMap<>();

    public HostKeyRepository repositoryFor(Long machineId) {
        return new HostKeyRepository() {
            @Override
            public int check(String host, byte[] key) {
                String fp = fingerprint(key);
                String stored = fingerprints.putIfAbsent(machineId, fp);
                if (stored == null) {
                    log.info("[SSH] Trusted new host key for machine {} ({}): {}", machineId, host, fp);
                    return OK;
                }
                if (stored.equals(fp)) return OK;
                log.error("[SSH] HOST KEY MISMATCH for machine {} ({}) — possible MITM! Stored: {} Received: {}",
                        machineId, host, stored, fp);
                return CHANGED;
            }

            @Override public void add(HostKey hostkey, UserInfo ui) {}
            @Override public void remove(String host, String type) {}
            @Override public void remove(String host, String type, byte[] key) {}
            @Override public String getKnownHostsRepositoryID() { return "tofu-" + machineId; }
            @Override public HostKey[] getHostKey() { return new HostKey[0]; }
            @Override public HostKey[] getHostKey(String host, String type) { return new HostKey[0]; }
        };
    }

    public void forget(Long machineId) {
        fingerprints.remove(machineId);
    }

    private static String fingerprint(byte[] key) {
        try {
            byte[] digest = MessageDigest.getInstance("MD5").digest(key);
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                if (!sb.isEmpty()) sb.append(':');
                sb.append(String.format("%02x", b & 0xff));
            }
            return sb.toString();
        } catch (Exception e) {
            return "unknown";
        }
    }
}
