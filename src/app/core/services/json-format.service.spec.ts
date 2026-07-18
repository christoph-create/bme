import { describe, expect, it } from "vitest";

import { JsonFormatService } from "./json-format.service";

describe("JsonFormatService", () => {
  const service = new JsonFormatService();

  describe("format", () => {
    it("pretty-prints valid JSON with 2-space indentation", () => {
      const result = service.format('{"a":1,"b":[1,2]}');

      expect(result).toEqual({
        ok: true,
        value: JSON.stringify({ a: 1, b: [1, 2] }, null, 2),
      });
    });

    it("reports failure for invalid JSON", () => {
      const result = service.format("not json");

      expect(result).toEqual({ ok: false, error: "Payload isn't valid JSON" });
    });
  });

  describe("tryFormat", () => {
    it("pretty-prints valid JSON", () => {
      expect(service.tryFormat('{"a":1,"b":[1,2]}')).toBe(
        JSON.stringify({ a: 1, b: [1, 2] }, null, 2),
      );
    });

    it("falls back to the raw text when it doesn't parse", () => {
      expect(service.tryFormat("not json")).toBe("not json");
    });

    it("returns an empty string unchanged", () => {
      expect(service.tryFormat("")).toBe("");
    });
  });

  describe("compact", () => {
    it("minifies valid JSON", () => {
      expect(service.compact('{\n  "a": 1\n}')).toBe('{"a":1}');
    });

    it("falls back to the raw text when it doesn't parse", () => {
      expect(service.compact("not json")).toBe("not json");
    });
  });

  describe("tokenize", () => {
    it("reconstructs the original text exactly by concatenating tokens", () => {
      const inputs = [
        '{"a": 1, "b": [true, false, null], "c": "hi \\"there\\""}',
        "not valid json at all",
        '{"unterminated": true',
        "",
        "  42  ",
      ];
      for (const input of inputs) {
        const tokens = service.tokenize(input);
        expect(tokens.map((t) => t.text).join("")).toBe(input);
      }
    });

    it("classifies object keys separately from string values", () => {
      const tokens = service.tokenize('{"key": "value"}');

      expect(tokens.map((t) => t.kind)).toEqual([
        "punctuation",
        "key",
        "punctuation",
        "whitespace",
        "string",
        "punctuation",
      ]);
    });

    it("classifies numbers, booleans, and null", () => {
      const tokens = service.tokenize("[1, -2.5, 1e3, true, false, null]");
      const kinds = tokens
        .filter((t) => t.kind !== "punctuation" && t.kind !== "whitespace")
        .map((t) => t.kind);

      expect(kinds).toEqual([
        "number",
        "number",
        "number",
        "boolean",
        "boolean",
        "null",
      ]);
    });

    it("falls back to plain tokens for text that isn't JSON", () => {
      const tokens = service.tokenize("notjson");

      expect(tokens).toEqual([{ kind: "plain", text: "notjson" }]);
    });

    it("keeps highlighting the valid parts around an unterminated string", () => {
      const tokens = service.tokenize('{"a": "unterminated');

      expect(tokens.map((t) => t.kind)).toEqual([
        "punctuation",
        "key",
        "punctuation",
        "whitespace",
        "plain",
      ]);
    });
  });
});
