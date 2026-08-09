import { describe, expect, it } from "vitest";

import {
  findPlaceholders,
  hasPlaceholders,
  isValidVariableName,
  replacePlaceholders,
  unknownPlaceholderNames,
} from "./placeholders";

const upperCase = (name: string) => name.toUpperCase();

describe("findPlaceholders", () => {
  it("finds a placeholder and reports the span covering the braces", () => {
    expect(findPlaceholders('{"id":"{{uuid}}"}')).toEqual([
      { name: "uuid", start: 7, end: 15 },
    ]);
  });

  it("finds several placeholders in order", () => {
    expect(
      findPlaceholders("sensors/{{deviceId}}/{{seq}}").map((p) => p.name),
    ).toEqual(["deviceId", "seq"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(findPlaceholders("{{  uuid  }}")).toEqual([
      { name: "uuid", start: 0, end: 12 },
    ]);
  });

  it("accepts underscores and digits after the first character", () => {
    expect(findPlaceholders("{{_dev_id2}}").map((p) => p.name)).toEqual([
      "_dev_id2",
    ]);
  });

  it("ignores a name that starts with a digit", () => {
    expect(findPlaceholders("{{2fast}}")).toEqual([]);
  });

  it("ignores single braces and empty braces", () => {
    expect(findPlaceholders("{uuid} {{}} {{ }}")).toEqual([]);
  });

  it("ignores names containing characters that aren't identifier-shaped", () => {
    // Anything looser would start eating other templating languages'
    // syntax out of payloads that just happen to pass through bme.
    expect(findPlaceholders("{{a-b}} {{a.b}} {{a b}} {{a()}}")).toEqual([]);
  });

  it("returns nothing for text with no placeholders", () => {
    expect(findPlaceholders('{"state":"on"}')).toEqual([]);
  });
});

describe("hasPlaceholders", () => {
  it("is true only when a real placeholder is present", () => {
    expect(hasPlaceholders("{{uuid}}")).toBe(true);
    expect(hasPlaceholders("{{ not valid }}")).toBe(false);
    expect(hasPlaceholders("plain text")).toBe(false);
  });
});

describe("replacePlaceholders", () => {
  it("substitutes every placeholder", () => {
    expect(replacePlaceholders("{{a}}-{{b}}", upperCase)).toBe("A-B");
  });

  it("keeps the surrounding text exactly", () => {
    expect(replacePlaceholders('{"id":"{{uuid}}","n":1}', () => "abc")).toBe(
      '{"id":"abc","n":1}',
    );
  });

  it("returns the input unchanged when there is nothing to replace", () => {
    expect(replacePlaceholders('{"state":"on"}', upperCase)).toBe(
      '{"state":"on"}',
    );
  });

  it("leaves a placeholder literal when the resolver returns null", () => {
    // A payload may contain braces for reasons that have nothing to do with
    // bme; blanking those would corrupt a message the user meant to send.
    expect(replacePlaceholders("{{known}} {{typo}}", (name) =>
      name === "known" ? "yes" : null,
    )).toBe("yes {{typo}}");
  });

  it("substitutes an empty string when that's what the resolver returns", () => {
    expect(replacePlaceholders("a{{gone}}b", () => "")).toBe("ab");
  });

  it("does not rescan substituted text for further placeholders", () => {
    // Otherwise a fixed-text variable whose value contains braces would
    // recurse into whatever it happened to name.
    expect(replacePlaceholders("{{a}}", () => "{{a}}")).toBe("{{a}}");
  });

  it("substitutes each occurrence of a repeated name independently", () => {
    let calls = 0;
    expect(replacePlaceholders("{{n}} {{n}}", () => String(++calls))).toBe(
      "1 2",
    );
  });
});

describe("unknownPlaceholderNames", () => {
  it("reports names that aren't defined", () => {
    expect(
      unknownPlaceholderNames("{{uuid}} {{typo}}", new Set(["uuid"])),
    ).toEqual(["typo"]);
  });

  it("reports each unknown name once, in first-appearance order", () => {
    expect(
      unknownPlaceholderNames("{{b}} {{a}} {{b}}", new Set<string>()),
    ).toEqual(["b", "a"]);
  });

  it("returns nothing when every name is known", () => {
    expect(
      unknownPlaceholderNames("{{a}}{{b}}", new Set(["a", "b"])),
    ).toEqual([]);
  });
});

describe("isValidVariableName", () => {
  it("accepts identifier-shaped names", () => {
    expect(isValidVariableName("deviceId")).toBe(true);
    expect(isValidVariableName("_seq2")).toBe(true);
  });

  it("rejects anything findPlaceholders would not match", () => {
    for (const name of ["", "2fast", "a-b", "a.b", "a b", "über"]) {
      expect(isValidVariableName(name)).toBe(false);
    }
  });
});
