import { describe, expect, it } from "vitest";

import { JsonFormatService } from "../services/json-format.service";
import {
  formatPreservingPlaceholders,
  maskPlaceholders,
} from "./mask-placeholders";

const format = (text: string) => new JsonFormatService().format(text);

/** Mask, pretty-print, put the placeholders back - the whole round trip, which
 * is the only thing callers care about. */
function roundTrip(text: string): string | null {
  const mask = maskPlaceholders(text);
  const formatted = format(mask.masked);
  return formatted.ok ? mask.restore(formatted.value) : null;
}

describe("maskPlaceholders", () => {
  it("leaves text without placeholders completely alone", () => {
    const mask = maskPlaceholders('{"a":1}');

    expect(mask.masked).toBe('{"a":1}');
    expect(mask.restore('{\n  "a": 1\n}')).toBe('{\n  "a": 1\n}');
  });

  it("quotes the sentinel for a placeholder standing on its own, so it parses", () => {
    const mask = maskPlaceholders('{"t":{{tempC}}}');

    expect(mask.masked).toBe('{"t":"__bme_ph_0__"}');
    expect(JSON.parse(mask.masked)).toEqual({ t: "__bme_ph_0__" });
  });

  it("leaves a placeholder inside a string bare, inside the quotes it had", () => {
    const mask = maskPlaceholders('{"id":"dev-{{deviceId}}"}');

    expect(mask.masked).toBe('{"id":"dev-__bme_ph_0__"}');
  });

  it("round-trips a bare placeholder, reclaiming the quotes masking added", () => {
    expect(roundTrip('{"t":{{tempC}}}')).toBe('{\n  "t": {{tempC}}\n}');
  });

  it("round-trips a placeholder inside a string value", () => {
    expect(roundTrip('{"id":"{{deviceId}}"}')).toBe('{\n  "id": "{{deviceId}}"\n}');
  });

  it("round-trips a placeholder used as an object key", () => {
    expect(roundTrip('{"{{k}}":1}')).toBe('{\n  "{{k}}": 1\n}');
  });

  it("round-trips a placeholder as an array element", () => {
    expect(roundTrip("[{{n}}, 1]")).toBe("[\n  {{n}},\n  1\n]");
  });

  it("removes the quotes it added even for a bare placeholder in key position", () => {
    // Not something the Format button offers - the payload is invalid either
    // way - but masking must still not smuggle quotes into the output.
    expect(roundTrip("{ {{k}}: 1 }")).toBe("{\n  {{k}}: 1\n}");
  });

  it("keeps adjacent placeholders inside one string distinct", () => {
    const mask = maskPlaceholders('{"a":"{{x}}{{y}}"}');

    expect(mask.masked).toBe('{"a":"__bme_ph_0____bme_ph_1__"}');
    expect(roundTrip('{"a":"{{x}}{{y}}"}')).toBe('{\n  "a": "{{x}}{{y}}"\n}');
  });

  it("tells a bare whole-document placeholder from a quoted one", () => {
    // Both mask to exactly the same text. Only the recorded bare/in-string
    // position of each occurrence distinguishes them, which is why restoration
    // is indexed by occurrence and never matched by text.
    expect(maskPlaceholders("{{n}}").masked).toBe('"__bme_ph_0__"');
    expect(maskPlaceholders('"{{n}}"').masked).toBe('"__bme_ph_0__"');

    expect(roundTrip("{{n}}")).toBe("{{n}}");
    expect(roundTrip('"{{n}}"')).toBe('"{{n}}"');
  });

  it("is not fooled by an escaped quote inside a string", () => {
    // The \" must not read as the end of the string, or the placeholder after
    // it would be classified as bare and pick up quotes it never had.
    const mask = maskPlaceholders('{"a":"x\\"y {{p}}"}');

    expect(mask.masked).toBe('{"a":"x\\"y __bme_ph_0__"}');
    expect(roundTrip('{"a":"x\\"y {{p}}"}')).toBe('{\n  "a": "x\\"y {{p}}"\n}');
  });

  it("steps the sentinel out of the way of text that already contains one", () => {
    const mask = maskPlaceholders('{"a":"__bme_ph_0__","b":{{n}}}');

    expect(mask.masked).toBe('{"a":"__bme_ph_0__","b":"___bme_ph_0__"}');
    expect(roundTrip('{"a":"__bme_ph_0__","b":{{n}}}')).toBe(
      '{\n  "a": "__bme_ph_0__",\n  "b": {{n}}\n}',
    );
  });

  it("restores the original spelling, spaces and all", () => {
    expect(roundTrip('{"a":"{{ uuid }}"}')).toBe('{\n  "a": "{{ uuid }}"\n}');
  });

  it("treats an unknown variable name like any other placeholder", () => {
    expect(roundTrip('{"a":"{{nosuchthing}}"}')).toBe(
      '{\n  "a": "{{nosuchthing}}"\n}',
    );
  });

  it("keeps two-digit sentinels from matching inside one another", () => {
    // Sentinel 1 is `__bme_ph_1__`; without the trailing underscores it would
    // also match inside `__bme_ph_11__`, corrupting the twelfth placeholder.
    const text = `{"a":"${"{{n}}".repeat(12)}"}`;

    expect(roundTrip(text)).toBe(`{\n  "a": "${"{{n}}".repeat(12)}"\n}`);
  });

  it("returns null when a sentinel didn't survive the round trip", () => {
    const mask = maskPlaceholders('{"t":{{tempC}}}');

    expect(mask.restore('{\n  "t": 1\n}')).toBeNull();
  });
});

describe("formatPreservingPlaceholders", () => {
  it("formats the payload from the bug report, keeping every variable", () => {
    const result = formatPreservingPlaceholders(
      '{\n  "data1": {{counter}},\n"data2": {{counter}},\n"data3": {{counter}}\n}',
      format,
    );

    expect(result).toEqual({
      ok: true,
      value: [
        "{",
        '  "data1": {{counter}},',
        '  "data2": {{counter}},',
        '  "data3": {{counter}}',
        "}",
      ].join("\n"),
    });
  });

  it("reports plain invalid JSON in the usual words", () => {
    expect(formatPreservingPlaceholders("not json", format)).toEqual({
      ok: false,
      error: "Payload isn't valid JSON",
    });
  });

  it("declines a placeholder spliced into a number", () => {
    // `{"a": 1{{n}}}` expands to valid JSON, so the caller may well be calling
    // it valid - but there is no way to mask `1{{n}}` into something that
    // parses, so formatting has to say no rather than silently do nothing.
    for (const text of ['{"a": 1{{n}}}', '{"a": {{n}}.5}', '{"a": -{{n}}}']) {
      expect(formatPreservingPlaceholders(text, format)).toEqual({
        ok: false,
        error: "Formatting can't preserve this payload's variables",
      });
    }
  });

  it("declines rather than let a duplicate key swallow a variable", () => {
    // JSON.parse keeps the last of two identical keys, so formatting this
    // would drop `{{x}}` from the payload entirely.
    expect(formatPreservingPlaceholders('{"a": {{x}}, "a": 1}', format)).toEqual(
      { ok: false, error: "Formatting would drop part of this payload" },
    );
  });

  it("still formats ordinary placeholder-free JSON", () => {
    expect(formatPreservingPlaceholders('{"a":1}', format)).toEqual({
      ok: true,
      value: '{\n  "a": 1\n}',
    });
  });
});
