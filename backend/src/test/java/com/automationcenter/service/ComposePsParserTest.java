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

    @Test
    void exitedZeroIsHealthy() {
        // run-once container (migration/seed/init) that finished successfully
        String out = """
                {"Service":"web","State":"running","ExitCode":0}
                {"Service":"migrate","State":"exited","ExitCode":0}
                """;
        var bad = ComposePsParser.unhealthy(ComposePsParser.parse(out, mapper));
        assertTrue(bad.isEmpty(), "exited-0 run-once container must not be flagged");
    }

    @Test
    void exitedNonZeroIsUnhealthy() {
        String out = """
                {"Service":"web","State":"running","ExitCode":0}
                {"Service":"job","State":"exited","ExitCode":1}
                """;
        var bad = ComposePsParser.unhealthy(ComposePsParser.parse(out, mapper));
        assertEquals(1, bad.size());
        assertEquals("job", bad.get(0).service());
    }

    @Test
    void exitedWithoutExitCodeIsUnhealthy() {
        // no ExitCode field -> cannot confirm clean exit -> treat as unhealthy
        String out = "{\"Service\":\"job\",\"State\":\"exited\"}";
        var bad = ComposePsParser.unhealthy(ComposePsParser.parse(out, mapper));
        assertEquals(1, bad.size());
    }

    @Test
    void parsesExitCodeField() {
        String out = "{\"Service\":\"job\",\"State\":\"exited\",\"ExitCode\":137}";
        var states = ComposePsParser.parse(out, mapper);
        assertEquals(137, states.get(0).exitCode());
    }
}
