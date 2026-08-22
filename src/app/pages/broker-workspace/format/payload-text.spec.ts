import { describe, expect, it } from "vitest";

import {
  formatMessageBody,
  formatPayloadPreview,
  formatTruncationNote,
} from "./payload-text";

function encode(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

describe("formatPayloadPreview", () => {
  it("returns a placeholder for an empty payload", () => {
    expect(formatPayloadPreview([])).toBe("(empty)");
  });

  it("passes short text through unchanged", () => {
    expect(formatPayloadPreview(encode('{"ok":true}'))).toBe('{"ok":true}');
  });

  it("truncates long text with an ellipsis", () => {
    const longText = "x".repeat(150);

    expect(formatPayloadPreview(encode(longText))).toBe(
      "x".repeat(100) + "…",
    );
  });

  it("collapses whitespace and newlines into single spaces", () => {
    const payload = encode("line one\n  line two\t\tline three");

    expect(formatPayloadPreview(payload)).toBe("line one line two line three");
  });

  it("shows a binary placeholder when the payload doesn't decode as text", () => {
    const payload = [0xff, 0xfe, 0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd];

    expect(formatPayloadPreview(payload)).toBe(
      `<binary, ${payload.length} bytes>`,
    );
  });

  it("uses singular 'byte' for a one-byte binary payload", () => {
    expect(formatPayloadPreview([0xff])).toBe("<binary, 1 byte>");
  });

  it("only inspects the first ~200 bytes, ignoring what comes after for binary detection", () => {
    const validPrefix = Array.from({ length: 200 }, () =>
      "a".charCodeAt(0),
    );
    const invalidTail = Array.from({ length: 1000 }, () => 0xff);
    const payload = [...validPrefix, ...invalidTail];

    const result = formatPayloadPreview(payload);

    expect(result).not.toContain("binary");
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("formatMessageBody", () => {
  it("returns a placeholder for an empty payload", () => {
    expect(formatMessageBody([])).toBe("(empty)");
  });

  it("passes short non-JSON text through unchanged", () => {
    expect(formatMessageBody(encode("plain text message"))).toBe(
      "plain text message",
    );
  });

  it("preserves whitespace and newlines in non-JSON text, unlike the one-line preview", () => {
    const payload = encode("line one\n  line two\nline three");

    expect(formatMessageBody(payload)).toBe("line one\n  line two\nline three");
  });

  it("shows a binary placeholder when the payload doesn't decode as text", () => {
    const payload = [0xff, 0xfe, 0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd];

    expect(formatMessageBody(payload)).toBe(
      `<binary, ${payload.length} bytes>`,
    );
  });

  it("uses singular 'byte' for a one-byte binary payload", () => {
    expect(formatMessageBody([0xff])).toBe("<binary, 1 byte>");
  });

  it("truncates very large payloads with an ellipsis", () => {
    const longText = "x".repeat(20_500);

    const result = formatMessageBody(encode(longText));

    expect(result).toBe("x".repeat(20_000) + "…");
  });

  it("passes JSON text through undecorated - pretty-printing is app-formatted-payload's job", () => {
    const payload = encode('{"data1":"data","data2":"data"}');

    expect(formatMessageBody(payload)).toBe('{"data1":"data","data2":"data"}');
  });
});

describe("truncated payloads", () => {
  it("reports the wire size in the binary label, not the size of what arrived", () => {
    const binary = [0xff, 0xfe, 0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd];

    expect(formatMessageBody(binary, 4_000_000)).toBe(
      "<binary, 4000000 bytes>",
    );
    expect(formatPayloadPreview(binary, 4_000_000)).toBe(
      "<binary, 4000000 bytes>",
    );
  });

  it("marks a truncated body with an ellipsis even when what arrived is short", () => {
    expect(formatMessageBody(encode("abc"), 4_000_000)).toBe("abc…");
  });

  it("reads a cleared retained topic off the wire length", () => {
    expect(formatMessageBody([], 0)).toBe("(empty)");
  });

  it("has no note for a message that arrived whole", () => {
    expect(formatTruncationNote(3, 3)).toBeNull();
    expect(formatTruncationNote(0, 0)).toBeNull();
  });

  it("names both sizes when part of the message was left behind", () => {
    expect(formatTruncationNote(4_000_000, 262_144)).toBe(
      "Truncated - showing the first 256.0 KB of 3.8 MB",
    );
  });
});
