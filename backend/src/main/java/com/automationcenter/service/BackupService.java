package com.automationcenter.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Scheduled logical backup of the Arise Postgres database via {@code pg_dump}.
 * Restore: {@code pg_restore -h <host> -U <user> -d automation_db --clean --if-exists <file>}.
 */
@Service
@Slf4j
public class BackupService {

    @Value("${spring.datasource.url}")
    private String datasourceUrl;

    @Value("${spring.datasource.username}")
    private String dbUser;

    @Value("${spring.datasource.password}")
    private String dbPassword;

    @Value("${backup.directory}")
    private String backupDirectory;

    @Value("${backup.retention-count}")
    private int retentionCount;

    private static final DateTimeFormatter TIMESTAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
    private static final String FILE_PREFIX = "automation_db-";
    private static final String FILE_SUFFIX = ".dump";
    private static final long DUMP_TIMEOUT_MINUTES = 15;

    @Scheduled(cron = "${backup.cron}")
    public void scheduledBackup() {
        try {
            runBackup();
        } catch (Exception e) {
            log.error("Scheduled database backup failed: {}", e.getMessage(), e);
        }
    }

    /** Runs pg_dump and enforces retention. Returns the path of the created dump file. */
    public Path runBackup() throws IOException, InterruptedException {
        DbTarget target = parseJdbcUrl(datasourceUrl);
        Path dir = Path.of(backupDirectory);
        Files.createDirectories(dir);

        String filename = FILE_PREFIX + LocalDateTime.now().format(TIMESTAMP) + FILE_SUFFIX;
        Path outFile = dir.resolve(filename);

        ProcessBuilder pb = new ProcessBuilder(
                "pg_dump", "-h", target.host(), "-p", String.valueOf(target.port()),
                "-U", dbUser, "-F", "c", "-f", outFile.toString(), target.database());
        pb.environment().put("PGPASSWORD", dbPassword);
        pb.redirectErrorStream(true);

        log.info("Starting database backup to {}", outFile);
        Process process = pb.start();
        String output = new String(process.getInputStream().readAllBytes());
        boolean finished = process.waitFor(DUMP_TIMEOUT_MINUTES, TimeUnit.MINUTES);
        if (!finished) {
            process.destroyForcibly();
            throw new IOException("pg_dump timed out after " + DUMP_TIMEOUT_MINUTES + " minutes");
        }
        if (process.exitValue() != 0) {
            Files.deleteIfExists(outFile);
            throw new IOException("pg_dump exited with code " + process.exitValue() + ": " + output);
        }

        log.info("Database backup complete: {} ({} bytes)", outFile, Files.size(outFile));
        enforceRetention(dir);
        return outFile;
    }

    void enforceRetention(Path dir) throws IOException {
        try (var files = Files.list(dir)) {
            List<Path> dumps = files
                    .filter(p -> p.getFileName().toString().startsWith(FILE_PREFIX)
                            && p.getFileName().toString().endsWith(FILE_SUFFIX))
                    .sorted(Comparator.comparing(p -> p.getFileName().toString()))
                    .toList();
            int toDelete = dumps.size() - retentionCount;
            for (int i = 0; i < toDelete; i++) {
                Files.deleteIfExists(dumps.get(i));
                log.info("Deleted old backup: {}", dumps.get(i));
            }
        }
    }

    record DbTarget(String host, int port, String database) {}

    DbTarget parseJdbcUrl(String jdbcUrl) {
        URI uri = URI.create(jdbcUrl.substring("jdbc:".length()));
        int port = uri.getPort() != -1 ? uri.getPort() : 5432;
        String database = uri.getPath().startsWith("/") ? uri.getPath().substring(1) : uri.getPath();
        return new DbTarget(uri.getHost(), port, database);
    }
}
