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
