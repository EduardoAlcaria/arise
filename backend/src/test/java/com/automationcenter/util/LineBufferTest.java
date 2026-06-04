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
