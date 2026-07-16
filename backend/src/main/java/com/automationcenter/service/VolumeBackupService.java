package com.automationcenter.service;

import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.Machine;
import com.automationcenter.repository.DeploymentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

/**
 * Backs up a deployment's working directory on the target machine via restic before a
 * redeploy or rollback overwrites it — so a bad deploy doesn't destroy the only copy of
 * whatever state lives there (uploaded files, sqlite/db-file-on-disk, etc).
 *
 * <p>Scope: backs up {@code deployDir} as seen on the remote filesystem (bind-mount-style
 * data). It does not enumerate and back up separately-named Docker volumes under
 * {@code /var/lib/docker/volumes} — that needs a {@code docker volume inspect} pass per
 * service, a reasonable next step if bind mounts turn out not to cover most deployments.
 * The repository lives on the same disk as the data (protects against a bad deploy, not a
 * disk failure) — restic's own remote backends (S3, SFTP, ...) are a config change away if
 * off-machine retention is needed later.
 *
 * <p>Non-fatal by design: a backup failure is logged and the redeploy/rollback proceeds
 * anyway, matching how tunnel and Infisical failures are handled elsewhere in this service —
 * losing exposure/env vars, or here a stale backup, shouldn't block an otherwise-working
 * deploy pipeline.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class VolumeBackupService {

    private final SshService sshService;
    private final DeploymentRepository deploymentRepository;

    private static final String RESTIC_VERSION = "0.17.3";
    private static final long RESTIC_TIMEOUT_SECONDS = 900;

    public void backupBeforeRedeploy(Deployment deployment, Machine machine) {
        backup(deployment, machine, "redeploy");
    }

    public void backupBeforeRollback(Deployment deployment, Machine machine) {
        backup(deployment, machine, "rollback");
    }

    private void backup(Deployment deployment, Machine machine, String reason) {
        String deployDir = deployment.getDeployDir();
        if (deployDir == null || deployDir.isBlank() || machine == null) return;

        try {
            if (!ensureResticInstalled(machine)) {
                log.warn("Skipping volume backup for deployment {} ({}): restic unavailable and could not be installed",
                        deployment.getId(), reason);
                return;
            }

            String password = ensureRepoPassword(deployment);
            String repoDir = backupRepoDir(machine, deployment);
            Map<String, String> env = Map.of("RESTIC_PASSWORD", password, "RESTIC_REPOSITORY", repoDir);

            var initResult = run(machine, env, "restic snapshots -q > /dev/null 2>&1 || restic init -q");
            if (initResult.getExitCode() != 0) {
                log.warn("Volume backup for deployment {} ({}): restic init failed: {}",
                        deployment.getId(), reason, initResult.getStderr());
                return;
            }

            var backupResult = run(machine, env, "restic backup -q " + sq(deployDir));
            if (backupResult.getExitCode() != 0) {
                log.warn("Volume backup for deployment {} ({}) failed: {}",
                        deployment.getId(), reason, backupResult.getStderr());
                return;
            }

            run(machine, env, "restic forget -q --keep-last 5 --prune");
            log.info("Volume backup complete for deployment {} ({}): {}", deployment.getId(), reason, deployDir);
        } catch (Exception e) {
            log.warn("Volume backup for deployment {} ({}) failed: {}", deployment.getId(), reason, e.getMessage());
        }
    }

    private String ensureRepoPassword(Deployment deployment) {
        if (deployment.getResticRepoPassword() != null && !deployment.getResticRepoPassword().isBlank()) {
            return deployment.getResticRepoPassword();
        }
        String password = UUID.randomUUID().toString();
        deployment.setResticRepoPassword(password);
        deploymentRepository.save(deployment);
        return password;
    }

    /**
     * Resolves the remote $HOME via SSH rather than embedding the literal string "$HOME"
     * in a value that later gets single-quoted for export — single quotes suppress shell
     * expansion, so restic would silently create the repo under a directory literally
     * named "$HOME" instead of the real home directory.
     */
    private String backupRepoDir(Machine machine, Deployment deployment) {
        var home = sshService.execute(machine, "echo $HOME");
        String remoteHome = home.getExitCode() == 0 && !home.getStdout().isBlank()
                ? home.getStdout().strip() : "/tmp";
        return remoteHome + "/.arise-backups/" + deployment.getId();
    }

    private boolean ensureResticInstalled(Machine machine) {
        var check = sshService.execute(machine,
                "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH command -v restic 2>/dev/null");
        if (check.getExitCode() == 0 && !check.getStdout().isBlank()) return true;

        String downloadUrl = "https://github.com/restic/restic/releases/download/v"
                + RESTIC_VERSION + "/restic_" + RESTIC_VERSION + "_${os}_${a}.bz2";
        String installCmd =
                "arch=$(uname -m); case \"$arch\" in x86_64) a=amd64;; aarch64|arm64) a=arm64;; *) exit 1;; esac; "
                        + "os=$(uname -s | tr 'A-Z' 'a-z'); "
                        // Minimal remote targets (Alpine, BusyBox) often ship wget but not curl.
                        + "(command -v curl >/dev/null && curl -fsSL -o /tmp/restic.bz2 " + downloadUrl + ") "
                        + "|| wget -qO /tmp/restic.bz2 " + downloadUrl + " && "
                        + "bunzip2 -f /tmp/restic.bz2 && chmod +x /tmp/restic && "
                        + "(sudo mv /tmp/restic /usr/local/bin/restic 2>/dev/null || mv /tmp/restic /usr/local/bin/restic)";
        var install = sshService.execute(machine, installCmd, RESTIC_TIMEOUT_SECONDS);
        if (install.getExitCode() != 0) {
            log.warn("restic install failed: {}", install.getStderr());
            return false;
        }
        return true;
    }

    /**
     * An inline {@code VAR=val cmd1 || cmd2} prefix only scopes to {@code cmd1} in POSIX
     * shell — {@code cmd2} after the {@code ||}/{@code &&} runs without it. `restic init`
     * (which only runs after `restic snapshots` fails) needs the repository/password env
     * too, so export instead of prefixing.
     */
    private com.automationcenter.dto.machine.SshCommandResponse run(Machine machine, Map<String, String> env, String command) {
        String exports = env.entrySet().stream()
                .map(e -> "export " + e.getKey() + "=" + sq(e.getValue()) + "; ")
                .reduce("", String::concat);
        return sshService.execute(machine, exports + command, RESTIC_TIMEOUT_SECONDS);
    }

    private static String sq(String s) {
        return "'" + (s == null ? "" : s).replace("'", "'\\''") + "'";
    }
}
