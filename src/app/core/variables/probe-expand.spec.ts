import { describe, expect, it } from "vitest";

import { VariableValueKind } from "../models/payload-variable.model";
import { probeExpand } from "./probe-expand";

const kinds: ReadonlyMap<string, VariableValueKind> = new Map([
  ["deviceId", "string"],
  ["tempC", "number"],
  ["seq", "number"],
]);

/** What the publish panel and the payload input actually ask: would the
 * expansion of this text be valid JSON? */
function probeParses(text: string): boolean {
  try {
    JSON.parse(probeExpand(text, kinds));
    return true;
  } catch {
    return false;
  }
}

describe("probeExpand", () => {
  it("substitutes a number probe for numeric variables", () => {
    expect(probeExpand('{"t":{{tempC}}}', kinds)).toBe('{"t":0}');
  });

  it("substitutes a bare string probe, so surrounding quotes still apply", () => {
    expect(probeExpand('{"id":"{{deviceId}}"}', kinds)).toBe('{"id":"x"}');
  });

  it("leaves unknown names literal, exactly as real expansion does", () => {
    expect(probeExpand('{"a":{{typo}}}', kinds)).toBe('{"a":{{typo}}}');
  });

  it("returns text without placeholders unchanged", () => {
    expect(probeExpand('{"state":"on"}', kinds)).toBe('{"state":"on"}');
  });
});

describe("probeExpand as a JSON validity check", () => {
  it("accepts a numeric variable in a value position", () => {
    expect(probeParses('{"t":{{tempC}}}')).toBe(true);
  });

  it("accepts a string variable inside quotes", () => {
    expect(probeParses('{"id":"{{deviceId}}"}')).toBe(true);
  });

  it("rejects a string variable used unquoted", () => {
    // The real expansion would produce {"id":dev-42}, which is also invalid -
    // so reporting it now, while it can still be fixed, is the point.
    expect(probeParses('{"id":{{deviceId}}}')).toBe(false);
  });

  it("accepts a numeric variable quoted, since that is merely a string", () => {
    expect(probeParses('{"t":"{{tempC}}"}')).toBe(true);
  });

  it("accepts a variable used as an object key", () => {
    expect(probeParses('{"{{deviceId}}":1}')).toBe(true);
  });

  it("accepts several variables in one payload", () => {
    expect(
      probeParses('{"id":"{{deviceId}}","t":{{tempC}},"n":{{seq}}}'),
    ).toBe(true);
  });

  it("rejects a typo in a value position", () => {
    expect(probeParses('{"t":{{typo}}}')).toBe(false);
  });

  it("accepts a typo inside a string, which really is harmless", () => {
    expect(probeParses('{"note":"{{typo}}"}')).toBe(true);
  });

  it("still rejects JSON that is broken for ordinary reasons", () => {
    expect(probeParses('{"t":{{tempC}},}')).toBe(false);
  });

  it("gives the same verdict regardless of what the values would be", () => {
    // The whole justification for probing instead of expanding: validity is a
    // property of the kinds, not of the draw.
    const numericProbes: ReadonlyMap<string, VariableValueKind> = new Map([
      ["n", "number"],
    ]);
    expect(probeExpand("{{n}}", numericProbes)).toBe("0");
    expect(() => JSON.parse(probeExpand('{"v":{{n}}}', numericProbes))).not.toThrow();
  });
});
