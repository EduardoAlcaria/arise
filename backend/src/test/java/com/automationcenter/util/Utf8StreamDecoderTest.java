package com.automationcenter.util;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;

class Utf8StreamDecoderTest {

    @Test
    void decodesPlainAsciiInOneChunk() {
        Utf8StreamDecoder d = new Utf8StreamDecoder();
        byte[] b = "hello world".getBytes(StandardCharsets.UTF_8);
        assertEquals("hello world", d.decode(b, b.length) + d.finish());
    }

    @Test
    void reassemblesMultibyteCharSplitAcrossChunks() {
        // "é" is 0xC3 0xA9 in UTF-8 — split it across two decode() calls.
        Utf8StreamDecoder d = new Utf8StreamDecoder();
        byte[] full = "café".getBytes(StandardCharsets.UTF_8); // c a f 0xC3 0xA9
        int splitAt = full.length - 1; // cut between the two bytes of 'é'

        byte[] part1 = new byte[splitAt];
        System.arraycopy(full, 0, part1, 0, splitAt);
        byte[] part2 = new byte[full.length - splitAt];
        System.arraycopy(full, splitAt, part2, 0, full.length - splitAt);

        StringBuilder sb = new StringBuilder();
        sb.append(d.decode(part1, part1.length)); // "caf" — the lone 0xC3 is held back
        sb.append(d.decode(part2, part2.length)); // completes "é"
        sb.append(d.finish());

        assertEquals("café", sb.toString());
    }

    @Test
    void handlesEmojiSplitMidSequence() {
        // 😀 is 4 bytes (F0 9F 98 80). Feed one byte at a time.
        Utf8StreamDecoder d = new Utf8StreamDecoder();
        byte[] emoji = "😀".getBytes(StandardCharsets.UTF_8);
        StringBuilder sb = new StringBuilder();
        for (byte value : emoji) {
            sb.append(d.decode(new byte[]{value}, 1));
        }
        sb.append(d.finish());
        assertEquals("😀", sb.toString());
    }

    @Test
    void noCorruptionWhenChunkBoundaryFallsOnCharBoundary() {
        Utf8StreamDecoder d = new Utf8StreamDecoder();
        byte[] a = "café ".getBytes(StandardCharsets.UTF_8);
        byte[] b = "señor".getBytes(StandardCharsets.UTF_8);
        assertEquals("café señor", d.decode(a, a.length) + d.decode(b, b.length) + d.finish());
    }

    @Test
    void finishOnEmptyStreamReturnsEmpty() {
        Utf8StreamDecoder d = new Utf8StreamDecoder();
        assertEquals("", d.finish());
    }

    @Test
    void respectsLenArgumentIgnoringTrailingBufferGarbage() {
        Utf8StreamDecoder d = new Utf8StreamDecoder();
        byte[] buf = new byte[16];
        byte[] payload = "hi".getBytes(StandardCharsets.UTF_8);
        System.arraycopy(payload, 0, buf, 0, payload.length);
        // buf has trailing zero bytes; only the first 2 must be decoded
        assertEquals("hi", d.decode(buf, payload.length) + d.finish());
    }
}
