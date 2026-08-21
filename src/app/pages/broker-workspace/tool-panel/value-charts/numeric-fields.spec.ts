import { describe, expect, it } from "vitest";

import {
  NumericField,
  findNumericFields,
  mergeNumericFields,
  parsePayload,
  readNumericAt,
} from "./numeric-fields";

function encode(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function fieldsIn(text: string, fallbackLabel = "value"): readonly NumericField[] {
  return findNumericFields(parsePayload(encode(text)), fallbackLabel);
}

describe("parsePayload", () => {
  it("returns undefined for an empty payload", () => {
    expect(parsePayload([])).toBeUndefined();
  });

  /** A cut-off payload can still parse as a plain number, which would plot a
   * real-looking point from a message we only have part of. */
  it("returns undefined for a payload that arrived truncated", () => {
    expect(parsePayload(encode("23.5"), 4_000_000)).toBeUndefined();
  });

  it("returns undefined for a whitespace-only payload rather than zero", () => {
    expect(parsePayload(encode("   "))).toBeUndefined();
  });

  it("returns undefined for bytes that aren't text", () => {
    expect(
      parsePayload([0xff, 0xfe, 0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]),
    ).toBeUndefined();
  });

  it("parses JSON objects", () => {
    expect(parsePayload(encode('{"a":1}'))).toEqual({ a: 1 });
  });

  it("parses a bare number", () => {
    expect(parsePayload(encode("23.5"))).toBe(23.5);
  });

  it("parses a number with a unit suffix", () => {
    expect(parsePayload(encode("23.5 °C"))).toBe(23.5);
  });

  it("keeps the whole value for notations JSON rejects but JS accepts", () => {
    expect(parsePayload(encode("0x10"))).toBe(16);
    expect(parsePayload(encode(".5"))).toBe(0.5);
  });

  it("returns undefined for text with no leading number", () => {
    expect(parsePayload(encode("ok"))).toBeUndefined();
  });
});

describe("findNumericFields", () => {
  it("labels a bare numeric payload with the fallback and an empty path", () => {
    expect(fieldsIn("23.5", "temperature")).toEqual([
      { path: [], label: "temperature", value: 23.5 } satisfies NumericField,
    ]);
  });

  it("finds nothing in a payload that isn't numeric", () => {
    expect(fieldsIn("ok")).toEqual([]);
    expect(fieldsIn("")).toEqual([]);
    expect(fieldsIn("null")).toEqual([]);
  });

  it("finds nothing in binary bytes", () => {
    expect(findNumericFields(parsePayload([0xff, 0xfe, 0xfd]), "value")).toEqual(
      [],
    );
  });

  it("finds the numeric properties of a flat object, skipping other types", () => {
    expect(fieldsIn('{"temp":21,"name":"kitchen","on":true,"last":null}')).toEqual(
      [{ path: ["temp"], label: "temp", value: 21 } satisfies NumericField],
    );
  });

  it("descends into nested objects and dots the label", () => {
    expect(fieldsIn('{"battery":{"level":88}}')).toEqual([
      { path: ["battery", "level"], label: "battery.level", value: 88 },
    ] satisfies NumericField[]);
  });

  it("descends into arrays using the index as a path step", () => {
    expect(fieldsIn('{"v":[1,2]}')).toEqual([
      { path: ["v", "0"], label: "v.0", value: 1 },
      { path: ["v", "1"], label: "v.1", value: 2 },
    ] satisfies NumericField[]);
  });

  it("preserves document order across mixed nesting", () => {
    const labels = fieldsIn('{"a":1,"b":{"c":2},"d":3}').map((f) => f.label);

    expect(labels).toEqual(["a", "b.c", "d"]);
  });

  it("keeps a dotted key addressable via its path even though the label is ambiguous", () => {
    const [field] = fieldsIn('{"a.b":1}');

    expect(field.path).toEqual(["a.b"]);
    expect(field.label).toBe("a.b");
  });

  it("stops descending past the depth cap", () => {
    // Seven levels; the cap is six.
    const deep = '{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}}';

    expect(fieldsIn(deep)).toEqual([]);
  });

  it("stops after the field cap", () => {
    const wide = JSON.stringify(
      Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i])),
    );

    expect(fieldsIn(wide)).toHaveLength(64);
  });

  it("only scans the first few entries of a long array", () => {
    const long = JSON.stringify({ v: Array.from({ length: 500 }, (_, i) => i) });

    expect(fieldsIn(long)).toHaveLength(8);
  });
});

describe("mergeNumericFields", () => {
  const field = (label: string, value: number): NumericField => ({
    path: label.split("."),
    label,
    value,
  });

  it("returns nothing for no messages", () => {
    expect(mergeNumericFields([])).toEqual([]);
  });

  it("unions fields across differently shaped payloads", () => {
    const merged = mergeNumericFields([
      [field("temp", 21), field("battery.level", 88)],
      [field("temp", 22)],
    ]);

    expect(merged.map((f) => f.label)).toEqual(["temp", "battery.level"]);
  });

  it("takes each field's value from the most recent message carrying it", () => {
    const merged = mergeNumericFields([
      [field("temp", 21), field("battery.level", 88)],
      [field("temp", 22)],
    ]);

    expect(merged).toEqual([field("temp", 22), field("battery.level", 88)]);
  });

  it("keeps fields in the order they were first seen, not most-recent order", () => {
    const merged = mergeNumericFields([
      [field("a", 1)],
      [field("b", 2)],
      [field("a", 3)],
    ]);

    expect(merged.map((f) => f.label)).toEqual(["a", "b"]);
  });

  it("keeps a field that appeared in only one message", () => {
    const merged = mergeNumericFields([
      [field("rssi", -70)],
      [field("temp", 21)],
      [field("temp", 22)],
    ]);

    expect(merged.map((f) => f.label)).toEqual(["rssi", "temp"]);
  });

  it("distinguishes a dotted key from a two-step path", () => {
    const dotted: NumericField = { path: ["a.b"], label: "a.b", value: 1 };
    const nested: NumericField = { path: ["a", "b"], label: "a.b", value: 2 };

    expect(mergeNumericFields([[dotted], [nested]])).toEqual([dotted, nested]);
  });

  it("stops collecting new fields past the cap but still refreshes known ones", () => {
    const wide = Array.from({ length: 80 }, (_, i) => field(`k${i}`, i));

    const merged = mergeNumericFields([wide, [field("k0", 999)]]);

    expect(merged).toHaveLength(64);
    expect(merged[0]).toEqual(field("k0", 999));
  });
});

describe("readNumericAt", () => {
  it("reads a nested value", () => {
    expect(readNumericAt({ battery: { level: 88 } }, ["battery", "level"])).toBe(
      88,
    );
  });

  it("reads an array element by index", () => {
    expect(readNumericAt({ v: [4, 5] }, ["v", "1"])).toBe(5);
  });

  it("reads a bare number through an empty path", () => {
    expect(readNumericAt(23.5, [])).toBe(23.5);
  });

  it("returns null when the path is absent", () => {
    expect(readNumericAt({ a: 1 }, ["b"])).toBeNull();
  });

  it("returns null when the path runs through a non-object", () => {
    expect(readNumericAt({ a: 1 }, ["a", "b"])).toBeNull();
  });

  it("returns null when the value isn't a number", () => {
    expect(readNumericAt({ a: "1" }, ["a"])).toBeNull();
    expect(readNumericAt({ a: null }, ["a"])).toBeNull();
  });
});
