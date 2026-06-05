package com.automationcenter.util;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/**
 * Streaming UTF-8 decoder for byte chunks that may split a multibyte character
 * across reads. {@link #decode(byte[], int)} returns the text that can be fully
 * decoded from the supplied bytes plus any bytes carried over from a previous
 * call, holding back an incomplete trailing multibyte sequence until the rest of
 * its bytes arrive. {@link #finish()} flushes the remainder at end-of-stream.
 *
 * <p>Decoding each raw read chunk independently with {@code new String(bytes, UTF_8)}
 * corrupts any character whose bytes straddle a chunk boundary (the half-character
 * becomes U+FFFD); this class avoids that. Malformed input is replaced rather than
 * throwing. Not thread-safe — use one instance per stream.
 */
public final class Utf8StreamDecoder {

    private final CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPLACE)
            .onUnmappableCharacter(CodingErrorAction.REPLACE);

    private ByteBuffer pending = ByteBuffer.allocate(0);

    /** Decode the first {@code len} bytes of {@code data}, carrying any incomplete tail. */
    public String decode(byte[] data, int len) {
        return run(data, len, false);
    }

    /** Flush any carried-over trailing bytes at end-of-stream. */
    public String finish() {
        return run(new byte[0], 0, true);
    }

    private String run(byte[] data, int len, boolean endOfInput) {
        ByteBuffer in = ByteBuffer.allocate(pending.remaining() + len);
        in.put(pending);
        in.put(data, 0, len);
        in.flip();
        CharBuffer out = CharBuffer.allocate(in.remaining() + 1);
        decoder.decode(in, out, endOfInput);
        if (endOfInput) decoder.flush(out);
        out.flip();
        ByteBuffer rest = ByteBuffer.allocate(in.remaining());
        rest.put(in);
        rest.flip();
        pending = rest;
        return out.toString();
    }
}
