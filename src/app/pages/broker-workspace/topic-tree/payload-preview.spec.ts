import { describe, expect, it } from "vitest";

import { formatPayloadPreview } from "./payload-preview";

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
