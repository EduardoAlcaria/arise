package com.automationcenter.service;

import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.Machine;
import com.automationcenter.repository.DeploymentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Backs up a deployment's working directory on the target machine via restic before a
 * redeploy or rollback overwrites it — so a bad deploy doesn't destroy the only copy of
 * whatever state lives there (uploaded files, sqlite/db-file-on-disk, etc). Supports both
 * Unix (Linux/macOS) and Windows targets, matching {@link DeploymentService}'s own
 * OS-branching for the rest of the deploy pipeline.
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

    /** Same package-manager priority order as DeploymentService.detectPackageManager, so the
     *  two auto-install paths in this codebase behave consistently on the same target. */
    private static final String[] PACKAGE_MANAGER_ORDER = {"apt-get", "dnf", "yum", "apk", "brew", "pacman", "zypper"};

    /** package manager -> curl install command. Only used as a last resort when neither
     *  curl nor wget is already present. */
    private static final Map<String, String> CURL_INSTALL_MAP = Map.of(
            "apt-get", "DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y curl",
            "yum",     "yum install -y curl",
            "dnf",     "dnf install -y curl",
            "apk",     "apk add --no-cache curl",
            "brew",    "brew install curl",
            "pacman",  "pacman -Sy --noconfirm curl",
            "zypper",  "zypper install -y curl"
    );

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
            boolean isWindows = detectWindows(machine);
            String resticExe = ensureResticInstalled(machine, isWindows);
            if (resticExe == null) {
                log.warn("Skipping volume backup for deployment {} ({}): restic unavailable and could not be installed",
                        deployment.getId(), reason);
                return;
            }

            String password = ensureRepoPassword(deployment);
            String repoDir = backupRepoDir(machine, deployment, isWindows);
            Map<String, String> env = new LinkedHashMap<>();
            env.put("RESTIC_PASSWORD", password);
            env.put("RESTIC_REPOSITORY", repoDir);

            var initResult = run(machine, isWindows, env,
                    resticCmd(resticExe, isWindows, "snapshots -q")
                            + (isWindows ? " *>$null; if ($LASTEXITCODE -ne 0) { " + resticCmd(resticExe, isWindows, "init -q") + " }"
                                         : " > /dev/null 2>&1 || " + resticCmd(resticExe, isWindows, "init -q")));
            if (initResult.getExitCode() != 0) {
                log.warn("Volume backup for deployment {} ({}): restic init failed: {}",
                        deployment.getId(), reason, initResult.getStderr());
                return;
            }

            var backupResult = run(machine, isWindows, env,
                    resticCmd(resticExe, isWindows, "backup -q " + quote(deployDir, isWindows)));
            if (backupResult.getExitCode() != 0) {
                log.warn("Volume backup for deployment {} ({}) failed: {}",
                        deployment.getId(), reason, backupResult.getStderr());
                return;
            }

            run(machine, isWindows, env, resticCmd(resticExe, isWindows, "forget -q --keep-last 5 --prune"));
            log.info("Volume backup complete for deployment {} ({}): {}", deployment.getId(), reason, deployDir);
        } catch (Exception e) {
            log.warn("Volume backup for deployment {} ({}) failed: {}", deployment.getId(), reason, e.getMessage());
        }
    }

    private boolean detectWindows(Machine machine) {
        var osCheck = sshService.execute(machine, "uname -s 2>/dev/null || echo Windows");
        return osCheck.getStdout().trim().equalsIgnoreCase("windows") || osCheck.getExitCode() != 0;
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
     * Resolves the remote home/app-data dir via SSH rather than embedding a literal
     * "$HOME"/"%LOCALAPPDATA%" in a value that later gets quoted for export — quoting
     * suppresses shell expansion, so restic would silently create the repo under a
     * directory literally named that instead of the real resolved path.
     */
    private String backupRepoDir(Machine machine, Deployment deployment, boolean isWindows) {
        String base = isWindows ? windowsAppDataDir(machine) : unixHomeDir(machine);
        String sep = isWindows ? "\\" : "/";
        return base + sep + ".arise-backups" + sep + deployment.getId();
    }

    private String unixHomeDir(Machine machine) {
        var home = sshService.execute(machine, "echo $HOME");
        return home.getExitCode() == 0 && !home.getStdout().isBlank() ? home.getStdout().strip() : "/tmp";
    }

    /** %LOCALAPPDATA% expands fine unquoted in cmd.exe (unlike POSIX single-quote suppression). */
    private String windowsAppDataDir(Machine machine) {
        var appData = sshService.execute(machine, "echo %LOCALAPPDATA%");
        String dir = appData.getExitCode() == 0 && !appData.getStdout().isBlank() ? appData.getStdout().strip() : null;
        return (dir == null || dir.equals("%LOCALAPPDATA%")) ? "%TEMP%" : dir;
    }

    /** Returns the resolved restic executable path/name, or null if unavailable and install failed. */
    private String ensureResticInstalled(Machine machine, boolean isWindows) {
        return isWindows ? ensureResticInstalledWindows(machine) : ensureResticInstalledUnix(machine);
    }

    private String ensureResticInstalledUnix(Machine machine) {
        var check = sshService.execute(machine,
                "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH command -v restic 2>/dev/null");
        if (check.getExitCode() == 0 && !check.getStdout().isBlank()) return "restic";

        if (!ensureDownloaderAvailable(machine)) return null;

        String downloadUrl = "https://github.com/restic/restic/releases/download/v"
                + RESTIC_VERSION + "/restic_" + RESTIC_VERSION + "_${os}_${a}.bz2";
        String installCmd =
                "arch=$(uname -m); case \"$arch\" in x86_64) a=amd64;; aarch64|arm64) a=arm64;; *) exit 1;; esac; "
                        + "os=$(uname -s | tr 'A-Z' 'a-z'); "
                        + "(command -v curl >/dev/null && curl -fsSL -o /tmp/restic.bz2 " + downloadUrl + ") "
                        + "|| wget -qO /tmp/restic.bz2 " + downloadUrl + " && "
                        + "bunzip2 -f /tmp/restic.bz2 && chmod +x /tmp/restic && "
                        + "(sudo mv /tmp/restic /usr/local/bin/restic 2>/dev/null || mv /tmp/restic /usr/local/bin/restic)";
        var install = sshService.execute(machine, installCmd, RESTIC_TIMEOUT_SECONDS);
        if (install.getExitCode() != 0) {
            log.warn("restic install failed: {}", install.getStderr());
            return null;
        }
        return "restic";
    }

    /** If neither curl nor wget is present, install curl via whatever package manager is
     *  available — mirrors DeploymentService's auto-install-missing-deps pattern. */
    private boolean ensureDownloaderAvailable(Machine machine) {
        var check = sshService.execute(machine, "command -v curl >/dev/null || command -v wget >/dev/null");
        if (check.getExitCode() == 0) return true;

        for (String pm : PACKAGE_MANAGER_ORDER) {
            var hasPm = sshService.execute(machine, "command -v " + pm + " 2>/dev/null");
            if (hasPm.getExitCode() != 0 || hasPm.getStdout().isBlank()) continue;
            log.info("Neither curl nor wget found; installing curl via {}", pm);
            var install = sshService.execute(machine, CURL_INSTALL_MAP.get(pm), RESTIC_TIMEOUT_SECONDS);
            if (install.getExitCode() == 0) return true;
            log.warn("curl install via {} failed: {}", pm, install.getStderr());
        }
        log.warn("No downloader (curl/wget) available and no supported package manager found to install one");
        return false;
    }

    private String ensureResticInstalledWindows(Machine machine) {
        String dir = windowsAppDataDir(machine) + "\\Arise";
        String exe = dir + "\\restic.exe";

        var check = sshService.execute(machine, "if exist \"" + exe + "\" (exit 0) else (exit 1)");
        if (check.getExitCode() == 0) return exe;

        String psInstall =
                "$dir = " + psq(dir) + "; New-Item -ItemType Directory -Force -Path $dir | Out-Null; "
                        + "$arch = if ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { '386' }; "
                        + "$url = \"https://github.com/restic/restic/releases/download/v" + RESTIC_VERSION
                        + "/restic_" + RESTIC_VERSION + "_windows_$arch.zip\"; "
                        + "Invoke-WebRequest -Uri $url -OutFile \"$dir\\restic.zip\" -UseBasicParsing; "
                        + "Expand-Archive -Path \"$dir\\restic.zip\" -DestinationPath $dir -Force; "
                        + "Get-ChildItem \"$dir\\restic_*.exe\" | Select-Object -First 1 | "
                        + "ForEach-Object { Move-Item $_.FullName \"$dir\\restic.exe\" -Force }; "
                        + "Remove-Item \"$dir\\restic.zip\" -Force";
        var install = sshService.execute(machine,
                "powershell -NoProfile -NonInteractive -Command \"" + psInstall.replace("\"", "\\\"") + "\"",
                RESTIC_TIMEOUT_SECONDS);
        if (install.getExitCode() != 0) {
            log.warn("restic install failed: {}", install.getStderr());
            return null;
        }
        return exe;
    }

    private static String resticCmd(String resticExe, boolean isWindows, String args) {
        return isWindows ? "& " + psq(resticExe) + " " + args : resticExe + " " + args;
    }

    /**
     * An inline {@code VAR=val cmd1 || cmd2} prefix only scopes to {@code cmd1} in POSIX
     * shell — {@code cmd2} after the {@code ||}/{@code &&} runs without it — so Unix exports
     * instead of prefixing. Windows sets them as PowerShell session variables the same way.
     */
    private SshCommandResponse run(Machine machine, boolean isWindows, Map<String, String> env, String command) {
        if (isWindows) {
            String assigns = env.entrySet().stream()
                    .map(e -> "$env:" + e.getKey() + "=" + psq(e.getValue()) + "; ")
                    .reduce("", String::concat);
            String script = assigns + command;
            return sshService.execute(machine,
                    "powershell -NoProfile -NonInteractive -Command \"" + script.replace("\"", "\\\"") + "\"",
                    RESTIC_TIMEOUT_SECONDS);
        }
        String exports = env.entrySet().stream()
                .map(e -> "export " + e.getKey() + "=" + sq(e.getValue()) + "; ")
                .reduce("", String::concat);
        return sshService.execute(machine, exports + command, RESTIC_TIMEOUT_SECONDS);
    }

    private static String quote(String s, boolean isWindows) {
        return isWindows ? "\\\"" + s.replace("\"", "`\"") + "\\\"" : sq(s);
    }

    private static String sq(String s) {
        return "'" + (s == null ? "" : s).replace("'", "'\\''") + "'";
    }

    /** PowerShell single-quoted literal — '' escapes an embedded quote. */
    private static String psq(String s) {
        return "'" + (s == null ? "" : s).replace("'", "''") + "'";
    }
}
