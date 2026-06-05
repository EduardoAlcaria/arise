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
