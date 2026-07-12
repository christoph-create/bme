import { describe, expect, it } from "vitest";

import { formatMessageBody, formatPayloadPreview } from "./payload-text";

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

  it("pretty-prints a compact JSON object by default", () => {
    const payload = encode('{"data1":"data","data2":"data"}');

    expect(formatMessageBody(payload)).toBe(
      '{\n  "data1": "data",\n  "data2": "data"\n}',
    );
  });

  it("pretty-prints a compact JSON array by default", () => {
    const payload = encode("[1,2,3]");

    expect(formatMessageBody(payload)).toBe("[\n  1,\n  2,\n  3\n]");
  });

  it("pretty-prints nested JSON", () => {
    const payload = encode('{"outer":{"inner":[1,2]}}');

    expect(formatMessageBody(payload)).toBe(
      '{\n  "outer": {\n    "inner": [\n      1,\n      2\n    ]\n  }\n}',
    );
  });

  it("leaves malformed JSON-looking text as raw text", () => {
    const payload = encode('{"unterminated": true');

    expect(formatMessageBody(payload)).toBe('{"unterminated": true');
  });

  it("does not reformat bare JSON scalars like a number or boolean", () => {
    expect(formatMessageBody(encode("42"))).toBe("42");
    expect(formatMessageBody(encode("true"))).toBe("true");
  });

  it("shows the raw compact JSON when prettyPrintJson is disabled", () => {
    const payload = encode('{"data1":"data","data2":"data"}');

    expect(formatMessageBody(payload, { prettyPrintJson: false })).toBe(
      '{"data1":"data","data2":"data"}',
    );
  });

  it("does not attempt to pretty-print JSON that got cut off by truncation", () => {
    const value = "x".repeat(20_000);
    const payload = encode(`{"data":"${value}"}`);

    const result = formatMessageBody(payload);

    expect(result.endsWith("…")).toBe(true);
    expect(result.startsWith('{"data":"')).toBe(true);
  });
});
