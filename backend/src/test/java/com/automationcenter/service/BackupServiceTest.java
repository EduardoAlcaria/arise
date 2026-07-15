package com.automationcenter.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class BackupServiceTest {

    private final BackupService service = new BackupService();

    @Test
    void parseJdbcUrlExtractsHostPortAndDatabase() {
        var target = service.parseJdbcUrl("jdbc:postgresql://postgres:5432/automation_db");
        assertThat(target.host()).isEqualTo("postgres");
        assertThat(target.port()).isEqualTo(5432);
        assertThat(target.database()).isEqualTo("automation_db");
    }

    @Test
    void parseJdbcUrlDefaultsPortWhenAbsent() {
        var target = service.parseJdbcUrl("jdbc:postgresql://dbhost/mydb");
        assertThat(target.port()).isEqualTo(5432);
    }

    @Test
    void enforceRetentionKeepsOnlyNewestFiles(@TempDir Path dir) throws IOException {
        ReflectionTestUtils.setField(service, "retentionCount", 2);
        Files.writeString(dir.resolve("automation_db-20260101-000000.dump"), "a");
        Files.writeString(dir.resolve("automation_db-20260102-000000.dump"), "b");
        Files.writeString(dir.resolve("automation_db-20260103-000000.dump"), "c");
        Files.writeString(dir.resolve("not-a-backup.txt"), "ignore me");

        service.enforceRetention(dir);

        try (var files = Files.list(dir)) {
            List<String> remaining = files.map(p -> p.getFileName().toString()).sorted().toList();
            assertThat(remaining).containsExactly(
                    "automation_db-20260102-000000.dump",
                    "automation_db-20260103-000000.dump",
                    "not-a-backup.txt");
        }
    }
}
