# Base Reliability Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three core base functions (application/repo deployment, local runner setup, Cloudflare tunnels) stop hanging, stop reporting false success, and survive a server restart.

**Architecture:** Fix the shared SSH layer once (command timeout + live line streaming), then layer truthful status on each pillar (deploy health gate, runner online-check, tunnel failure warning + orphan cleanup), then add startup orphan reconciliation and runner-tracker eviction. Pure logic is extracted into small testable units (`LineBuffer`, `ComposePsParser`); SSH/Docker-bound wiring is verified by compiling and by a real deploy on the Mac Mini.

**Tech Stack:** Spring Boot 3.3.5 / Java 21, JSch SSH, RabbitMQ, JPA/Hibernate, Jackson, JUnit 5 + Mockito. No local Maven — tests run in a throwaway Docker container.

**Test command (run any test class):**
```
docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn test -Dtest=<ClassName>
```
**Compile-only check (for SSH/Docker wiring tasks that have no unit test):**
```
docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn -q compile
```

**Commit discipline:** One production file (plus its test) = one commit = one push, per established workflow. Do NOT add Co-Authored-By or any Claude attribution.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `backend/.../util/LineBuffer.java` | create | Accumulate streamed chunks, emit complete lines |
| `backend/.../util/LineBufferTest.java` | create | Unit test for LineBuffer |
| `backend/.../service/ComposePsParser.java` | create | Parse `docker compose ps --format json`, flag unhealthy |
| `backend/.../service/ComposePsParserTest.java` | create | Unit test for parser |
| `backend/src/main/resources/application.yml` | modify | SSH command timeout properties |
| `backend/.../service/SshService.java` | modify | Timeout + streaming execute overloads |
| `backend/.../service/DeploymentService.java` | modify | Stream heavy steps; health gate; tunnel warning + cleanup |
| `backend/.../repository/DeploymentRepository.java` | modify | `findByStatusIn` |
| `backend/.../listener/DeploymentReconciler.java` | create | Fail orphaned in-flight deploys on startup |
| `backend/.../listener/DeploymentReconcilerTest.java` | create | Unit test for reconciler |
| `backend/.../AutomationCenterApplication.java` | modify | `@EnableScheduling` |
| `backend/.../service/RunnerSetupTracker.java` | modify | Timestamp + eviction of stale sessions |
| `backend/.../service/RunnerSetupTrackerTest.java` | create | Unit test for eviction |
| `backend/.../service/CicdService.java` | modify | Runner online-check; stream install output |

Package root: `backend/src/main/java/com/automationcenter`. Test root: `backend/src/test/java/com/automationcenter`.

---

## Task 1: LineBuffer utility

**Files:**
- Create: `backend/src/main/java/com/automationcenter/util/LineBuffer.java`
- Test: `backend/src/test/java/com/automationcenter/util/LineBufferTest.java`

- [ ] **Step 1: Write the failing test**

```java
package com.automationcenter.util;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class LineBufferTest {

    @Test
    void emitsCompleteLinesOnly() {
        List<String> lines = new ArrayList<>();
        LineBuffer buf = new LineBuffer(lines::add);

        buf.append("hello\nwor");
        assertEquals(List.of("hello"), lines);

        buf.append("ld\n");
        assertEquals(List.of("hello", "world"), lines);
    }

    @Test
    void stripsCarriageReturn() {
        List<String> lines = new ArrayList<>();
        LineBuffer buf = new LineBuffer(lines::add);
        buf.append("a\r\nb\r\n");
        assertEquals(List.of("a", "b"), lines);
    }

    @Test
    void flushEmitsTrailingPartial() {
        List<String> lines = new ArrayList<>();
        LineBuffer buf = new LineBuffer(lines::add);
        buf.append("no newline here");
        assertEquals(List.of(), lines);
        buf.flush();
        assertEquals(List.of("no newline here"), lines);
    }

    @Test
    void flushOnEmptyEmitsNothing() {
        List<String> lines = new ArrayList<>();
        LineBuffer buf = new LineBuffer(lines::add);
        buf.append("x\n");
        buf.flush();
        assertEquals(List.of("x"), lines);
    }

    @Test
    void handlesMultipleLinesInOneChunk() {
        List<String> lines = new ArrayList<>();
        LineBuffer buf = new LineBuffer(lines::add);
        buf.append("one\ntwo\nthree\n");
        assertEquals(List.of("one", "two", "three"), lines);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn test -Dtest=LineBufferTest`
Expected: FAIL — compilation error, `LineBuffer` does not exist.

- [ ] **Step 3: Write minimal implementation**

```java
package com.automationcenter.util;

import java.util.function.Consumer;

/**
 * Accumulates streamed text chunks and emits complete lines (split on '\n')
 * to a consumer. Trailing '\r' is stripped so Windows/CRLF output is clean.
 * Call {@link #flush()} once at end-of-stream to emit any trailing partial line.
 */
public class LineBuffer {

    private final StringBuilder pending = new StringBuilder();
    private final Consumer<String> onLine;

    public LineBuffer(Consumer<String> onLine) {
        this.onLine = onLine;
    }

    public void append(String chunk) {
        if (chunk == null || chunk.isEmpty()) return;
        pending.append(chunk);
        int idx;
        while ((idx = pending.indexOf("\n")) >= 0) {
            emit(pending.substring(0, idx));
            pending.delete(0, idx + 1);
        }
    }

    public void flush() {
        if (pending.length() > 0) {
            emit(pending.toString());
            pending.setLength(0);
        }
    }

    private void emit(String line) {
        if (line.endsWith("\r")) line = line.substring(0, line.length() - 1);
        onLine.accept(line);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn test -Dtest=LineBufferTest`
Expected: PASS — `Tests run: 5, Failures: 0, Errors: 0`.

- [ ] **Step 5: Commit + push**

```bash
git add backend/src/main/java/com/automationcenter/util/LineBuffer.java backend/src/test/java/com/automationcenter/util/LineBufferTest.java
git commit -m "feat(ssh): add LineBuffer for streaming command output"
git push
```

---

## Task 2: ComposePsParser

**Files:**
- Create: `backend/src/main/java/com/automationcenter/service/ComposePsParser.java`
- Test: `backend/src/test/java/com/automationcenter/service/ComposePsParserTest.java`

**Background:** `docker compose ps --format json` prints either one JSON object per line (Compose v2.x) or a single JSON array. Each object has `Service` and `State` fields (`running`, `exited`, `restarting`, `created`, ...). The parser is conservative: if output is blank or unparseable it returns an empty list, so the caller cannot produce a false failure — it only fails a deploy when it positively detects a non-running service.

- [ ] **Step 1: Write the failing test**

```java
package com.automationcenter.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ComposePsParserTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void parsesLineDelimitedJson() {
        String out = """
                {"Service":"web","State":"running"}
                {"Service":"db","State":"exited"}
                """;
        var states = ComposePsParser.parse(out, mapper);
        assertEquals(2, states.size());
        assertEquals("web", states.get(0).service());
        assertEquals("running", states.get(0).state());
    }

    @Test
    void parsesJsonArray() {
        String out = "[{\"Service\":\"web\",\"State\":\"running\"},{\"Service\":\"db\",\"State\":\"running\"}]";
        var states = ComposePsParser.parse(out, mapper);
        assertEquals(2, states.size());
    }

    @Test
    void unhealthyFlagsNonRunning() {
        String out = """
                {"Service":"web","State":"running"}
                {"Service":"db","State":"restarting"}
                {"Service":"cache","State":"exited"}
                """;
        var bad = ComposePsParser.unhealthy(ComposePsParser.parse(out, mapper));
        assertEquals(2, bad.size());
        assertTrue(bad.stream().anyMatch(s -> s.service().equals("db")));
        assertTrue(bad.stream().anyMatch(s -> s.service().equals("cache")));
    }

    @Test
    void allRunningHasNoUnhealthy() {
        String out = """
                {"Service":"web","State":"running"}
                {"Service":"db","State":"running"}
                """;
        assertTrue(ComposePsParser.unhealthy(ComposePsParser.parse(out, mapper)).isEmpty());
    }

    @Test
    void blankOutputParsesEmpty() {
        assertTrue(ComposePsParser.parse("", mapper).isEmpty());
        assertTrue(ComposePsParser.parse("   \n ", mapper).isEmpty());
    }

    @Test
    void unparseableOutputParsesEmpty() {
        // human-readable table output, not JSON -> empty, so caller can't false-fail
        String out = "NAME    IMAGE    STATUS\nweb     nginx    Up 2 minutes";
        assertTrue(ComposePsParser.parse(out, mapper).isEmpty());
    }

    @Test
    void fallsBackToNameWhenServiceMissing() {
        String out = "{\"Name\":\"proj-web-1\",\"State\":\"exited\"}";
        var states = ComposePsParser.parse(out, mapper);
        assertEquals(1, states.size());
        assertEquals("proj-web-1", states.get(0).service());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn test -Dtest=ComposePsParserTest`
Expected: FAIL — compilation error, `ComposePsParser` does not exist.

- [ ] **Step 3: Write minimal implementation**

```java
package com.automationcenter.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;

/**
 * Parses `docker compose ps --format json` output and identifies services that
 * are not in a running state. Conservative: blank/unparseable input yields an
 * empty list, so callers never produce a false failure from a missing parse.
 */
public final class ComposePsParser {

    private ComposePsParser() {}

    public record ServiceState(String service, String state) {}

    public static List<ServiceState> parse(String output, ObjectMapper mapper) {
        List<ServiceState> result = new ArrayList<>();
        if (output == null || output.isBlank()) return result;
        String trimmed = output.trim();
        try {
            if (trimmed.startsWith("[")) {
                for (JsonNode node : mapper.readTree(trimmed)) {
                    result.add(toState(node));
                }
            } else {
                for (String line : trimmed.split("\\R")) {
                    if (line.isBlank()) continue;
                    String t = line.trim();
                    if (!t.startsWith("{")) continue; // skip non-JSON lines
                    result.add(toState(mapper.readTree(t)));
                }
            }
        } catch (Exception e) {
            return new ArrayList<>(); // unparseable -> empty
        }
        return result;
    }

    public static List<ServiceState> unhealthy(List<ServiceState> states) {
        return states.stream()
                .filter(s -> !"running".equalsIgnoreCase(s.state()))
                .toList();
    }

    private static ServiceState toState(JsonNode node) {
        String svc = node.hasNonNull("Service") ? node.get("Service").asText()
                : node.hasNonNull("Name") ? node.get("Name").asText()
                : "unknown";
        String state = node.hasNonNull("State") ? node.get("State").asText() : "unknown";
        return new ServiceState(svc, state);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn test -Dtest=ComposePsParserTest`
Expected: PASS — `Tests run: 7, Failures: 0, Errors: 0`.

- [ ] **Step 5: Commit + push**

```bash
git add backend/src/main/java/com/automationcenter/service/ComposePsParser.java backend/src/test/java/com/automationcenter/service/ComposePsParserTest.java
git commit -m "feat(deploy): add ComposePsParser for container health gate"
git push
```

---

## Task 3: SSH timeout properties in application.yml

**Files:**
- Modify: `backend/src/main/resources/application.yml`

- [ ] **Step 1: Read the file**

Read `backend/src/main/resources/application.yml` to find a sensible insertion point (top-level, e.g. near other custom keys like `encryption:`).

- [ ] **Step 2: Add the properties**

Add this top-level block (sibling of `spring:`, `encryption:`, etc.). Keep existing content intact.

```yaml
ssh:
  command-timeout-seconds: ${SSH_COMMAND_TIMEOUT_SECONDS:120}
  long-command-timeout-seconds: ${SSH_LONG_COMMAND_TIMEOUT_SECONDS:1800}
```

- [ ] **Step 3: Verify boot config parses (compile)**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn -q compile`
Expected: BUILD SUCCESS (YAML is not compiled, but this confirms nothing else broke). The values are consumed in Task 4.

- [ ] **Step 4: Commit + push**

```bash
git add backend/src/main/resources/application.yml
git commit -m "feat(ssh): add command timeout config properties"
git push
```

---

## Task 4: SshService timeout + streaming overloads

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/SshService.java`

**Design:** Keep the existing `execute(machine, cmd)` signature so the ~dozen quick callers are untouched (it now delegates with the default timeout). Add a bounded overload and a bounded+streaming overload. The core read loop reads stdout and stderr with a deadline, feeds stdout lines through a `LineBuffer` to the optional `onLine` consumer, and always accumulates full text for the returned `SshCommandResponse`. On deadline breach it disconnects the channel and returns exit `-1` with a timeout message.

- [ ] **Step 1: Read the file**

Read `backend/src/main/java/com/automationcenter/service/SshService.java` (already in context; re-read if stale). The method to replace is `execute(Machine, String)` at lines ~140-177.

- [ ] **Step 2: Add imports and timeout fields**

Add imports near the top (after existing imports):

```java
import com.automationcenter.util.LineBuffer;
import org.springframework.beans.factory.annotation.Value;
import java.io.InputStream;
import java.util.function.Consumer;
```

Change the class to inject the timeout values. Replace the existing constructor block:

```java
    private static final int CONNECT_TIMEOUT_MS = 30_000;

    private final SshHostKeyStore hostKeyStore;

    public SshService(SshHostKeyStore hostKeyStore) {
        this.hostKeyStore = hostKeyStore;
    }
```

with:

```java
    private static final int CONNECT_TIMEOUT_MS = 30_000;

    private final SshHostKeyStore hostKeyStore;

    @Value("${ssh.command-timeout-seconds:120}")
    private long defaultTimeoutSeconds;

    @Value("${ssh.long-command-timeout-seconds:1800}")
    private long longTimeoutSeconds;

    public SshService(SshHostKeyStore hostKeyStore) {
        this.hostKeyStore = hostKeyStore;
    }

    /** Long timeout for heavy operations (clone, compose build, runner install). */
    public long longTimeoutSeconds() {
        return longTimeoutSeconds;
    }
```

- [ ] **Step 3: Replace the `execute` method with overloads + a streaming core**

Replace the entire existing `execute(Machine machine, String command)` method (lines ~139-177) with:

```java
    /** Execute a command with the default timeout, no streaming. */
    public SshCommandResponse execute(Machine machine, String command) {
        return execute(machine, command, defaultTimeoutSeconds, null);
    }

    /** Execute a command with an explicit timeout, no streaming. */
    public SshCommandResponse execute(Machine machine, String command, long timeoutSeconds) {
        return execute(machine, command, timeoutSeconds, null);
    }

    /**
     * Execute a command with a timeout and optional live line streaming.
     * stdout lines are delivered to {@code onLine} as they arrive; the full
     * stdout/stderr text is still accumulated for the returned response so
     * exit-code and string checks keep working. On timeout the channel is
     * disconnected and exit code -1 is returned with a timeout message.
     */
    public SshCommandResponse execute(Machine machine, String command, long timeoutSeconds, Consumer<String> onLine) {
        Session session = null;
        try {
            session = openSession(machine);
            session.connect(CONNECT_TIMEOUT_MS);

            ChannelExec channel = (ChannelExec) session.openChannel("exec");
            // ChannelExec skips shell profile — prepend Homebrew + common paths so macOS tools are found
            String fullCommand = "export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH; " + command;
            channel.setCommand(fullCommand);

            InputStream stdoutStream = channel.getInputStream();
            InputStream stderrStream = channel.getExtInputStream();
            channel.connect();

            StringBuilder stdout = new StringBuilder();
            StringBuilder stderr = new StringBuilder();
            LineBuffer lineBuffer = onLine != null ? new LineBuffer(onLine) : null;

            byte[] buf = new byte[8192];
            long deadline = System.currentTimeMillis() + timeoutSeconds * 1000L;
            boolean timedOut = false;

            while (true) {
                while (stdoutStream.available() > 0) {
                    int n = stdoutStream.read(buf, 0, buf.length);
                    if (n < 0) break;
                    String chunk = new String(buf, 0, n, StandardCharsets.UTF_8);
                    stdout.append(chunk);
                    if (lineBuffer != null) lineBuffer.append(chunk);
                }
                while (stderrStream.available() > 0) {
                    int n = stderrStream.read(buf, 0, buf.length);
                    if (n < 0) break;
                    stderr.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                }
                if (channel.isClosed()) {
                    // drain any final bytes
                    while (stdoutStream.available() > 0) {
                        int n = stdoutStream.read(buf, 0, buf.length);
                        if (n < 0) break;
                        String chunk = new String(buf, 0, n, StandardCharsets.UTF_8);
                        stdout.append(chunk);
                        if (lineBuffer != null) lineBuffer.append(chunk);
                    }
                    while (stderrStream.available() > 0) {
                        int n = stderrStream.read(buf, 0, buf.length);
                        if (n < 0) break;
                        stderr.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                    }
                    break;
                }
                if (System.currentTimeMillis() > deadline) {
                    timedOut = true;
                    break;
                }
                Thread.sleep(100);
            }

            if (lineBuffer != null) lineBuffer.flush();

            if (timedOut) {
                channel.disconnect();
                return new SshCommandResponse(
                        stdout.toString(),
                        "Command timed out after " + timeoutSeconds + "s",
                        -1);
            }

            int exitCode = channel.getExitStatus();
            channel.disconnect();
            return new SshCommandResponse(stdout.toString(), stderr.toString(), exitCode);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new SshCommandResponse("", "Interrupted: " + e.getMessage(), -1);
        } catch (Exception e) {
            return new SshCommandResponse("", e.getMessage(), -1);
        } finally {
            if (session != null) session.disconnect();
        }
    }
```

Note: `writeFileViaShell` already calls `execute(machine, cmd)` — unchanged, it now uses the default timeout.

- [ ] **Step 4: Verify it compiles**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn -q compile`
Expected: BUILD SUCCESS.

- [ ] **Step 5: Verify existing tests still pass**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn test -Dtest=GitHubServiceAriseConfigTest,LineBufferTest,ComposePsParserTest`
Expected: all PASS.

- [ ] **Step 6: Commit + push**

```bash
git add backend/src/main/java/com/automationcenter/service/SshService.java
git commit -m "feat(ssh): add command timeout and live output streaming"
git push
```

---

## Task 5: Stream heavy deploy steps

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/DeploymentService.java`

**Goal:** Route the long-running shell steps through the streaming overload so logs appear live and a hang is bounded by the long timeout. Apply to: clone, build/`compose up`, application-flow `compose up`, and teardown. Use `sshService.longTimeoutSeconds()` and a `line -> appendLog(deployment, line, INFO)` consumer.

- [ ] **Step 1: Read the file**

Read `backend/src/main/java/com/automationcenter/service/DeploymentService.java`.

- [ ] **Step 2: Stream the repo-flow clone**

Find (lines ~155-156):

```java
            var cloneResult = sshService.execute(machine, cloneCmd);
            appendLog(deployment, sanitizeGitOutput(cloneResult.getStdout()), LogLevel.INFO);
```

Replace with:

```java
            var cloneResult = sshService.execute(machine, cloneCmd, sshService.longTimeoutSeconds(),
                    line -> appendLog(deployment, sanitizeGitOutput(line), LogLevel.INFO));
```

(The streamed lines are now logged live; the post-call `appendLog` of full stdout is removed to avoid duplication. The error branch below that checks `cloneResult.getExitCode()` is unchanged.)

- [ ] **Step 3: Stream the repo-flow build**

Find (lines ~236-239):

```java
                appendLog(deployment, "Running build: " + buildCmd, LogLevel.INFO);
                var buildResult = sshService.execute(machine, buildCmd);
                appendLog(deployment, buildResult.getStdout(), LogLevel.INFO);
```

Replace with:

```java
                appendLog(deployment, "Running build: " + buildCmd, LogLevel.INFO);
                var buildResult = sshService.execute(machine, buildCmd, sshService.longTimeoutSeconds(),
                        line -> appendLog(deployment, line, LogLevel.INFO));
```

- [ ] **Step 4: Stream the application-flow compose up**

Find (lines ~362-364):

```java
            appendLog(deployment, "Running docker compose up --build -d", LogLevel.INFO);
            var composeResult = sshService.execute(machine, composeCmd);
            appendLog(deployment, composeResult.getStdout(), LogLevel.INFO);
```

Replace with:

```java
            appendLog(deployment, "Running docker compose up --build -d", LogLevel.INFO);
            var composeResult = sshService.execute(machine, composeCmd, sshService.longTimeoutSeconds(),
                    line -> appendLog(deployment, line, LogLevel.INFO));
```

- [ ] **Step 5: Give teardown a bounded timeout**

In `teardownPreviousDeployment`, find (lines ~824-825):

```java
            var result = sshService.execute(machine,
                    "cd " + sq(prevDir) + " && docker compose down --remove-orphans 2>&1");
```

Replace with:

```java
            var result = sshService.execute(machine,
                    "cd " + sq(prevDir) + " && docker compose down --remove-orphans 2>&1",
                    sshService.longTimeoutSeconds());
```

- [ ] **Step 6: Verify it compiles**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn -q compile`
Expected: BUILD SUCCESS.

- [ ] **Step 7: Commit + push**

```bash
git add backend/src/main/java/com/automationcenter/service/DeploymentService.java
git commit -m "feat(deploy): stream clone/build/teardown output with long timeout"
git push
```

---

## Task 6: Deploy health gate

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/DeploymentService.java`

**Goal:** After the compose-based deploy steps, parse container state with `ComposePsParser`. If any service is not running, append its recent logs and mark the deployment FAILED instead of SUCCESS. Applies to both the repo flow (when `stack == "compose"`) and the application flow.

- [ ] **Step 1: Add a private health-gate helper**

Add this method to `DeploymentService` (e.g. just below `teardownPreviousDeployment`):

```java
    /**
     * Inspect running containers via `docker compose ps --format json`.
     * Returns true if all services are running (or state can't be determined —
     * conservative, never a false failure). Returns false and logs the offending
     * services + their recent logs if any service is exited/restarting.
     */
    private boolean composeHealthy(Deployment deployment, Machine machine, String repoDir, String composeFileFlag) {
        var ps = sshService.execute(machine,
                "cd " + sq(repoDir) + " && docker compose" + composeFileFlag + " ps --format json 2>/dev/null");
        var states = ComposePsParser.parse(ps.getStdout(), objectMapper);
        var bad = ComposePsParser.unhealthy(states);
        if (bad.isEmpty()) return true;

        for (var svc : bad) {
            appendLog(deployment, "Service '" + svc.service() + "' is " + svc.state()
                    + " — fetching recent logs:", LogLevel.ERROR);
            var logs = sshService.execute(machine,
                    "cd " + sq(repoDir) + " && docker compose" + composeFileFlag
                            + " logs --tail=50 " + sq(svc.service()) + " 2>&1",
                    sshService.longTimeoutSeconds());
            appendLog(deployment, logs.getStdout(), LogLevel.ERROR);
        }
        appendLog(deployment, "Health check failed: "
                + bad.stream().map(ComposePsParser.ServiceState::service).toList()
                + " not running.", LogLevel.ERROR);
        return false;
    }
```

- [ ] **Step 2: Gate the repo flow**

In `executeAsync`, find the block (lines ~247-251):

```java
            if ("compose".equals(stack) && !isWindows) {
                String composeFileFlag = ariseComposeFile != null ? " -f " + sq(ariseComposeFile) : "";
                var psResult = sshService.execute(machine, "cd " + repoDir + " && docker compose" + composeFileFlag + " ps 2>&1");
                appendLog(deployment, "--- Container status ---\n" + psResult.getStdout(), LogLevel.INFO);
            }
```

Replace with:

```java
            if ("compose".equals(stack) && !isWindows) {
                String composeFileFlag = ariseComposeFile != null ? " -f " + sq(ariseComposeFile) : "";
                var psResult = sshService.execute(machine, "cd " + repoDir + " && docker compose" + composeFileFlag + " ps 2>&1");
                appendLog(deployment, "--- Container status ---\n" + psResult.getStdout(), LogLevel.INFO);
                if (!composeHealthy(deployment, machine, repoDir, composeFileFlag)) {
                    fail(deployment);
                    return;
                }
            }
```

- [ ] **Step 3: Gate the application flow**

In `executeApplicationDeploy`, find (lines ~371-372):

```java
            var psResult = sshService.execute(machine, "cd " + baseDir + " && docker compose ps 2>&1");
            appendLog(deployment, "--- Container status ---\n" + psResult.getStdout(), LogLevel.INFO);
```

Replace with:

```java
            var psResult = sshService.execute(machine, "cd " + baseDir + " && docker compose ps 2>&1");
            appendLog(deployment, "--- Container status ---\n" + psResult.getStdout(), LogLevel.INFO);
            if (!composeHealthy(deployment, machine, baseDir, "")) {
                fail(deployment);
                return;
            }
```

- [ ] **Step 4: Verify it compiles**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn -q compile`
Expected: BUILD SUCCESS.

- [ ] **Step 5: Commit + push**

```bash
git add backend/src/main/java/com/automationcenter/service/DeploymentService.java
git commit -m "feat(deploy): fail deployment when a container is not running"
git push
```

---

## Task 7: Tunnel failure warning + orphan cleanup

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/DeploymentService.java`

**Goal (per product decision):** A failed Cloudflare tunnel does NOT fail the deploy (containers are running). Instead, surface a loud ERROR-level warning and best-effort delete the orphan tunnel if it was created before the failure. Apply to both tunnel blocks (repo flow and application flow).

- [ ] **Step 1: Update the repo-flow tunnel block**

In `executeAsync`, find (lines ~254-272):

```java
            // Optional Cloudflare tunnel for repo deployments
            if (deployment.getTunnelName() != null && !deployment.getTunnelName().isBlank()) {
                try {
                    appendLog(deployment, "Creating Cloudflare tunnel: " + deployment.getTunnelName(), LogLevel.INFO);
                    String secret = java.util.UUID.randomUUID().toString().replace("-", "");
                    var tunnel = cloudflareService.createTunnel(deployment.getOwner().getId(),
                            new CloudflareTunnelRequest(deployment.getTunnelName(), secret));
                    String serviceUrl = "http://localhost:" + deployment.getTunnelAppPort();
                    cloudflareService.configureTunnelIngress(deployment.getOwner().getId(), tunnel.getId(),
                            deployment.getTunnelHostname(), serviceUrl);
                    cloudflareService.createDnsCname(deployment.getOwner().getId(), deployment.getTunnelHostname(), tunnel.getId());
                    String tunnelToken = cloudflareService.getTunnelToken(deployment.getOwner().getId(), tunnel.getId());
                    sshService.execute(machine, cloudflaredDockerCmd("cloudflared_" + deploymentId, tunnelToken));
                    deployment.setCloudfareTunnelId(tunnel.getId());
                    deployment.setCloudfareTunnelUrl("https://" + deployment.getTunnelHostname());
                    appendLog(deployment, "Tunnel active: https://" + deployment.getTunnelHostname(), LogLevel.INFO);
                } catch (Exception e) {
                    appendLog(deployment, "Cloudflare tunnel setup failed: " + e.getMessage(), LogLevel.WARN);
                }
            }
```

Replace with:

```java
            // Optional Cloudflare tunnel for repo deployments
            if (deployment.getTunnelName() != null && !deployment.getTunnelName().isBlank()) {
                String createdTunnelId = null;
                try {
                    appendLog(deployment, "Creating Cloudflare tunnel: " + deployment.getTunnelName(), LogLevel.INFO);
                    String secret = java.util.UUID.randomUUID().toString().replace("-", "");
                    var tunnel = cloudflareService.createTunnel(deployment.getOwner().getId(),
                            new CloudflareTunnelRequest(deployment.getTunnelName(), secret));
                    createdTunnelId = tunnel.getId();
                    String serviceUrl = "http://localhost:" + deployment.getTunnelAppPort();
                    cloudflareService.configureTunnelIngress(deployment.getOwner().getId(), tunnel.getId(),
                            deployment.getTunnelHostname(), serviceUrl);
                    cloudflareService.createDnsCname(deployment.getOwner().getId(), deployment.getTunnelHostname(), tunnel.getId());
                    String tunnelToken = cloudflareService.getTunnelToken(deployment.getOwner().getId(), tunnel.getId());
                    sshService.execute(machine, cloudflaredDockerCmd("cloudflared_" + deploymentId, tunnelToken),
                            sshService.longTimeoutSeconds());
                    deployment.setCloudfareTunnelId(tunnel.getId());
                    deployment.setCloudfareTunnelUrl("https://" + deployment.getTunnelHostname());
                    appendLog(deployment, "Tunnel active: https://" + deployment.getTunnelHostname(), LogLevel.INFO);
                } catch (Exception e) {
                    appendLog(deployment, "⚠ App is running locally but the Cloudflare tunnel FAILED — "
                            + "not exposed: " + e.getMessage(), LogLevel.ERROR);
                    if (createdTunnelId != null) {
                        appendLog(deployment, "Cleaning up orphaned tunnel " + createdTunnelId, LogLevel.INFO);
                        cloudflareService.deleteTunnel(deployment.getOwner().getId(), createdTunnelId);
                    }
                }
            }
```

- [ ] **Step 2: Update the application-flow tunnel block**

In `executeApplicationDeploy`, find (lines ~374-400):

```java
            if (deployment.getTunnelName() != null && !deployment.getTunnelName().isBlank()) {
                try {
                    appendLog(deployment, "Creating Cloudflare tunnel: " + deployment.getTunnelName(), LogLevel.INFO);
                    String secret = java.util.UUID.randomUUID().toString().replace("-", "");
                    CloudflareTunnelResponse tunnel = cloudflareService.createTunnel(
                            deployment.getOwner().getId(),
                            new CloudflareTunnelRequest(deployment.getTunnelName(), secret)
                    );
                    String serviceUrl = "http://localhost:" + deployment.getTunnelAppPort();
                    cloudflareService.configureTunnelIngress(
                            deployment.getOwner().getId(), tunnel.getId(),
                            deployment.getTunnelHostname(), serviceUrl
                    );
                    cloudflareService.createDnsCname(
                            deployment.getOwner().getId(), deployment.getTunnelHostname(), tunnel.getId()
                    );
                    String tunnelToken = cloudflareService.getTunnelToken(
                            deployment.getOwner().getId(), tunnel.getId()
                    );
                    sshService.execute(machine, cloudflaredDockerCmd("cloudflared_" + deployment.getId(), tunnelToken));
                    deployment.setCloudfareTunnelId(tunnel.getId());
                    deployment.setCloudfareTunnelUrl("https://" + deployment.getTunnelHostname());
                    appendLog(deployment, "Tunnel active: https://" + deployment.getTunnelHostname(), LogLevel.INFO);
                } catch (Exception e) {
                    appendLog(deployment, "Cloudflare tunnel setup failed: " + e.getMessage(), LogLevel.WARN);
                }
            }
```

Replace with:

```java
            if (deployment.getTunnelName() != null && !deployment.getTunnelName().isBlank()) {
                String createdTunnelId = null;
                try {
                    appendLog(deployment, "Creating Cloudflare tunnel: " + deployment.getTunnelName(), LogLevel.INFO);
                    String secret = java.util.UUID.randomUUID().toString().replace("-", "");
                    CloudflareTunnelResponse tunnel = cloudflareService.createTunnel(
                            deployment.getOwner().getId(),
                            new CloudflareTunnelRequest(deployment.getTunnelName(), secret)
                    );
                    createdTunnelId = tunnel.getId();
                    String serviceUrl = "http://localhost:" + deployment.getTunnelAppPort();
                    cloudflareService.configureTunnelIngress(
                            deployment.getOwner().getId(), tunnel.getId(),
                            deployment.getTunnelHostname(), serviceUrl
                    );
                    cloudflareService.createDnsCname(
                            deployment.getOwner().getId(), deployment.getTunnelHostname(), tunnel.getId()
                    );
                    String tunnelToken = cloudflareService.getTunnelToken(
                            deployment.getOwner().getId(), tunnel.getId()
                    );
                    sshService.execute(machine, cloudflaredDockerCmd("cloudflared_" + deployment.getId(), tunnelToken),
                            sshService.longTimeoutSeconds());
                    deployment.setCloudfareTunnelId(tunnel.getId());
                    deployment.setCloudfareTunnelUrl("https://" + deployment.getTunnelHostname());
                    appendLog(deployment, "Tunnel active: https://" + deployment.getTunnelHostname(), LogLevel.INFO);
                } catch (Exception e) {
                    appendLog(deployment, "⚠ App is running locally but the Cloudflare tunnel FAILED — "
                            + "not exposed: " + e.getMessage(), LogLevel.ERROR);
                    if (createdTunnelId != null) {
                        appendLog(deployment, "Cleaning up orphaned tunnel " + createdTunnelId, LogLevel.INFO);
                        cloudflareService.deleteTunnel(deployment.getOwner().getId(), createdTunnelId);
                    }
                }
            }
```

- [ ] **Step 3: Verify it compiles**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn -q compile`
Expected: BUILD SUCCESS.

- [ ] **Step 4: Commit + push**

```bash
git add backend/src/main/java/com/automationcenter/service/DeploymentService.java
git commit -m "feat(tunnel): loud warning + orphan cleanup on tunnel failure"
git push
```

---

## Task 8: DeploymentRepository.findByStatusIn

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/repository/DeploymentRepository.java`

- [ ] **Step 1: Read the file**

Read `backend/src/main/java/com/automationcenter/repository/DeploymentRepository.java` to see existing imports and method style.

- [ ] **Step 2: Add the query method**

Add this method to the interface (and ensure imports for `java.util.Collection`, `java.util.List`, and `com.automationcenter.entity.DeploymentStatus` exist):

```java
    List<Deployment> findByStatusIn(Collection<DeploymentStatus> statuses);
```

- [ ] **Step 3: Verify it compiles**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn -q compile`
Expected: BUILD SUCCESS.

- [ ] **Step 4: Commit + push**

```bash
git add backend/src/main/java/com/automationcenter/repository/DeploymentRepository.java
git commit -m "feat(deploy): add findByStatusIn for orphan reconciliation"
git push
```

---

## Task 9: DeploymentReconciler (startup orphan sweep)

**Files:**
- Create: `backend/src/main/java/com/automationcenter/listener/DeploymentReconciler.java`
- Test: `backend/src/test/java/com/automationcenter/listener/DeploymentReconcilerTest.java`

- [ ] **Step 1: Write the failing test**

```java
package com.automationcenter.listener;

import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.DeploymentStatus;
import com.automationcenter.repository.DeploymentRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class DeploymentReconcilerTest {

    @Mock DeploymentRepository deploymentRepository;
    @InjectMocks DeploymentReconciler reconciler;

    @Test
    void marksOrphanedDeploymentsFailed() {
        Deployment d1 = Deployment.builder().status(DeploymentStatus.BUILDING).build();
        Deployment d2 = Deployment.builder().status(DeploymentStatus.PENDING).build();
        when(deploymentRepository.findByStatusIn(anyCollection())).thenReturn(List.of(d1, d2));

        reconciler.reconcileOrphans();

        assertEquals(DeploymentStatus.FAILED, d1.getStatus());
        assertEquals(DeploymentStatus.FAILED, d2.getStatus());
        assertNotNull(d1.getFinishedAt());
        ArgumentCaptor<Deployment> captor = ArgumentCaptor.forClass(Deployment.class);
        verify(deploymentRepository, times(2)).save(captor.capture());
        assertTrue(captor.getAllValues().get(0).getLogs().contains("interrupted by server restart"));
    }

    @Test
    void noOrphansNoSaves() {
        when(deploymentRepository.findByStatusIn(anyCollection())).thenReturn(List.of());
        reconciler.reconcileOrphans();
        verify(deploymentRepository, never()).save(any());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn test -Dtest=DeploymentReconcilerTest`
Expected: FAIL — `DeploymentReconciler` does not exist.

- [ ] **Step 3: Write the implementation**

```java
package com.automationcenter.listener;

import com.automationcenter.entity.Deployment;
import com.automationcenter.entity.DeploymentStatus;
import com.automationcenter.repository.DeploymentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

/**
 * On startup, any deployment left in a non-terminal state (the server died or
 * restarted mid-deploy) is marked FAILED so it does not appear stuck forever.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DeploymentReconciler {

    private final DeploymentRepository deploymentRepository;

    @EventListener(ApplicationReadyEvent.class)
    public void reconcileOrphans() {
        List<Deployment> stuck = deploymentRepository.findByStatusIn(List.of(
                DeploymentStatus.PENDING, DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING));
        for (Deployment d : stuck) {
            d.setStatus(DeploymentStatus.FAILED);
            d.setFinishedAt(LocalDateTime.now());
            String existing = d.getLogs() == null ? "" : d.getLogs();
            d.setLogs(existing + "\nDeployment interrupted by server restart");
            deploymentRepository.save(d);
            log.warn("Reconciled orphaned deployment {} -> FAILED", d.getId());
        }
        if (!stuck.isEmpty()) {
            log.info("Reconciled {} orphaned deployment(s) on startup", stuck.size());
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn test -Dtest=DeploymentReconcilerTest`
Expected: PASS — `Tests run: 2, Failures: 0, Errors: 0`.

- [ ] **Step 5: Commit + push**

```bash
git add backend/src/main/java/com/automationcenter/listener/DeploymentReconciler.java backend/src/test/java/com/automationcenter/listener/DeploymentReconcilerTest.java
git commit -m "feat(deploy): reconcile orphaned in-flight deployments on startup"
git push
```

---

## Task 10: Enable scheduling

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/AutomationCenterApplication.java`

**Goal:** Enable Spring's `@Scheduled` support (needed by Task 11's eviction sweep). Skip this task only if `@EnableScheduling` is already present somewhere — grep first.

- [ ] **Step 1: Check whether scheduling is already enabled**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 sh -c "grep -rl EnableScheduling src/main/java || true"`
If a file is found, scheduling is already on — skip to Task 11. Otherwise continue.

- [ ] **Step 2: Read the file and add the annotation**

Read `backend/src/main/java/com/automationcenter/AutomationCenterApplication.java`. Add the import and annotation:

```java
import org.springframework.scheduling.annotation.EnableScheduling;
```

Add `@EnableScheduling` directly above (or below) the existing `@SpringBootApplication` on the class declaration.

- [ ] **Step 3: Verify it compiles**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn -q compile`
Expected: BUILD SUCCESS.

- [ ] **Step 4: Commit + push**

```bash
git add backend/src/main/java/com/automationcenter/AutomationCenterApplication.java
git commit -m "chore: enable Spring scheduling"
git push
```

---

## Task 11: RunnerSetupTracker eviction

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/RunnerSetupTracker.java`
- Test: `backend/src/test/java/com/automationcenter/service/RunnerSetupTrackerTest.java`

**Goal:** Stop the in-memory session map from leaking. Add a creation timestamp to each session and a scheduled sweep that removes terminal (DONE/FAILED) sessions older than one hour. The eviction logic takes an explicit cutoff so it is unit-testable.

- [ ] **Step 1: Write the failing test**

```java
package com.automationcenter.service;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import static org.junit.jupiter.api.Assertions.*;

class RunnerSetupTrackerTest {

    @Test
    void evictsTerminalSessionsBeforeCutoff() {
        RunnerSetupTracker tracker = new RunnerSetupTracker();
        String id = tracker.create(1L);
        tracker.fail(id, "boom");

        // cutoff in the future -> session is "older than cutoff" -> evicted
        tracker.evictStale(Instant.now().plus(1, ChronoUnit.HOURS));

        assertNull(tracker.get(id, 1L));
    }

    @Test
    void keepsRunningSessionsEvenWhenOld() {
        RunnerSetupTracker tracker = new RunnerSetupTracker();
        String id = tracker.create(1L); // status RUNNING

        tracker.evictStale(Instant.now().plus(1, ChronoUnit.HOURS));

        assertNotNull(tracker.get(id, 1L));
    }

    @Test
    void keepsRecentTerminalSessions() {
        RunnerSetupTracker tracker = new RunnerSetupTracker();
        String id = tracker.create(1L);
        tracker.complete(id, "done");

        // cutoff in the past -> nothing is older than it -> kept
        tracker.evictStale(Instant.now().minus(1, ChronoUnit.HOURS));

        assertNotNull(tracker.get(id, 1L));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn test -Dtest=RunnerSetupTrackerTest`
Expected: FAIL — `evictStale` does not exist.

- [ ] **Step 3: Rewrite RunnerSetupTracker**

Replace the entire file contents with:

```java
package com.automationcenter.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RunnerSetupTracker {

    public record Session(String status, String output, Long ownerId, Instant createdAt) {}

    private final ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

    public String create(Long ownerId) {
        String id = UUID.randomUUID().toString();
        sessions.put(id, new Session("RUNNING", "Starting runner setup…\n", ownerId, Instant.now()));
        return id;
    }

    public void complete(String sessionId, String output) {
        Session s = sessions.get(sessionId);
        if (s != null) sessions.put(sessionId, new Session("DONE", output, s.ownerId(), s.createdAt()));
    }

    public void fail(String sessionId, String output) {
        Session s = sessions.get(sessionId);
        if (s != null) sessions.put(sessionId, new Session("FAILED", output, s.ownerId(), s.createdAt()));
    }

    public Session get(String sessionId, Long requestingUserId) {
        Session s = sessions.get(sessionId);
        if (s == null || !s.ownerId().equals(requestingUserId)) return null;
        return s;
    }

    /** Remove terminal (non-RUNNING) sessions created before the cutoff. */
    public void evictStale(Instant cutoff) {
        sessions.entrySet().removeIf(e ->
                !"RUNNING".equals(e.getValue().status()) && e.getValue().createdAt().isBefore(cutoff));
    }

    @Scheduled(fixedRate = 600_000) // every 10 minutes
    public void evictStaleScheduled() {
        evictStale(Instant.now().minus(Duration.ofHours(1)));
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn test -Dtest=RunnerSetupTrackerTest`
Expected: PASS — `Tests run: 3, Failures: 0, Errors: 0`.

- [ ] **Step 5: Commit + push**

```bash
git add backend/src/main/java/com/automationcenter/service/RunnerSetupTracker.java backend/src/test/java/com/automationcenter/service/RunnerSetupTrackerTest.java
git commit -m "feat(runner): evict stale setup-tracker sessions"
git push
```

---

## Task 12: Runner online-check + streamed install

**Files:**
- Modify: `backend/src/main/java/com/automationcenter/service/CicdService.java`

**Goal:** After `svc start` returns exit 0, confirm the runner actually registered and is online on GitHub before reporting DONE. Also stream the install output with the long timeout so a stalled download/`sudo` prompt is bounded instead of hanging forever.

- [ ] **Step 1: Read the file**

Read `backend/src/main/java/com/automationcenter/service/CicdService.java`. Target: `setupRunner` (lines ~85-157).

- [ ] **Step 2: Stream the install command with a long timeout**

In `setupRunner`, find (line ~140):

```java
            var result = sshService.execute(machine, command);
```

Replace with:

```java
            StringBuilder live = output; // stream install lines into the same buffer
            var result = sshService.execute(machine, command, sshService.longTimeoutSeconds(),
                    line -> live.append(line).append("\n"));
```

- [ ] **Step 3: Add the online-check before reporting DONE**

In `setupRunner`, find (lines ~147-151):

```java
            if (result.getExitCode() == 0) {
                runnerSetupTracker.complete(sessionId, output.toString());
            } else {
                runnerSetupTracker.fail(sessionId, output.toString());
            }
```

Replace with:

```java
            if (result.getExitCode() != 0) {
                runnerSetupTracker.fail(sessionId, output.toString());
                return;
            }
            output.append("\nVerifying runner came online on GitHub...");
            if (waitForRunnerOnline(userId, owner, repo, machineName, 30)) {
                output.append("\nRunner is online.");
                runnerSetupTracker.complete(sessionId, output.toString());
            } else {
                output.append("\nERROR: runner installed but did not come online within 30s. "
                        + "Check the machine's network and that the service started.");
                runnerSetupTracker.fail(sessionId, output.toString());
            }
```

- [ ] **Step 4: Add the helper method**

Add this private method to `CicdService` (e.g. just below `setupRunner`):

```java
    private boolean waitForRunnerOnline(Long userId, String owner, String repo, String name, int timeoutSec) {
        long deadline = System.currentTimeMillis() + timeoutSec * 1000L;
        while (System.currentTimeMillis() < deadline) {
            try {
                List<Map<String, Object>> runners = listRunners(userId, owner, repo);
                boolean online = runners.stream().anyMatch(r ->
                        name.equalsIgnoreCase(String.valueOf(r.get("name")))
                                && "online".equalsIgnoreCase(String.valueOf(r.get("status"))));
                if (online) return true;
            } catch (Exception e) {
                log.debug("Runner online-check poll failed: {}", e.getMessage());
            }
            try {
                Thread.sleep(3000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }
```

- [ ] **Step 5: Verify it compiles**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn -q compile`
Expected: BUILD SUCCESS.

- [ ] **Step 6: Run the full backend test suite (regression)**

Run: `docker run --rm -v "D:\programming_WINDOWS_ONLY\projects\AutomationHub\backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn test`
Expected: BUILD SUCCESS, all tests pass (LineBuffer, ComposePsParser, DeploymentReconciler, RunnerSetupTracker, GitHubServiceAriseConfig).

- [ ] **Step 7: Commit + push**

```bash
git add backend/src/main/java/com/automationcenter/service/CicdService.java
git commit -m "feat(runner): verify runner online + stream install with timeout"
git push
```

---

## Final verification (after all tasks)

1. **Build the backend image and restart** so the changes go live:
   ```
   docker-compose build backend
   docker rm -f automationhub-backend-1
   docker-compose up -d backend
   ```
2. **Boot log** should show "Reconciled N orphaned deployment(s)" only if any were stuck (0 is fine — no line).
3. **Real deploy smoke test** on the Mac Mini (a small compose repo):
   - Logs stream live during clone + `compose up` (not one dump at the end).
   - A repo whose container exits immediately is marked **FAILED** with that service's logs (not green).
   - A healthy deploy is **SUCCESS**.
4. **Tunnel smoke test:** a deploy with a tunnel whose hostname is in a zone you control goes SUCCESS with a working URL; one with a bad zone goes **SUCCESS** but logs the loud `⚠ ... tunnel FAILED` line and leaves no orphan tunnel on Cloudflare.
5. **Runner smoke test:** setting up a runner reports DONE only after it shows online in the GitHub repo's runners list.

---

## Self-review notes

- **Spec coverage:** Theme 1 (timeout+stream) = Tasks 3,4,5 + util Task 1. Theme 2 (truthful status) = health gate Tasks 2,6; tunnel warning Task 7; runner online-check Task 12. Theme 3 (restart resilience) = reconciler Tasks 8,9; tracker eviction Tasks 10,11. All spec sections mapped.
- **Type consistency:** `execute(machine, cmd, timeoutSec, onLine)` signature used identically across Tasks 4/5/7/12. `ComposePsParser.parse/unhealthy/ServiceState` consistent across Tasks 2/6. `sshService.longTimeoutSeconds()` defined in Task 4, used in 5/7/12. `findByStatusIn` defined Task 8, used Task 9.
- **No placeholders:** every code step has full code.
