/**
 * Pretty-printing a payload that contains `{{placeholders}}`.
 *
 * `JSON.parse` can't see a bare `{{count}}` as a value, so formatting used to
 * be unavailable the moment a payload used a variable - which is exactly when
 * indentation is hardest to keep by hand. The way out is to swap each
 * placeholder for a stand-in that *does* parse, format, then put the original
 * text back. Unlike `probe-expand.ts`, which answers "would this be valid?"
 * and throws the text away, this has to be reversible, so the stand-ins are
 * unique per occurrence rather than canonical per kind.
 */

import type { JsonFormatResult } from "../services/json-format.service";
import { PlaceholderRef, findPlaceholders, replacePlaceholders } from "./placeholders";

export interface PlaceholderMask {
  /** `text` with every `{{name}}` swapped for a sentinel that survives a
   * `JSON.parse`/`stringify` round trip. */
  readonly masked: string;
  /** Puts the original placeholder text back into `formatted`. `null` when a
   * sentinel didn't survive - two object keys collapsing into one is the way
   * that happens - rather than quietly returning a payload with a variable
   * missing. */
  restore(formatted: string): string | null;
}

/** A sentinel that can't collide with anything already in `text`. Testing the
 * prefix is enough, since every sentinel starts with it. */
function sentinelPrefix(text: string): string {
  let prefix = "__bme_ph_";
  while (text.includes(prefix)) {
    prefix = `_${prefix}`;
  }
  return prefix;
}

/** The trailing underscores are load-bearing: without them `…_1_` would match
 * inside `…_11_`, and restoration would corrupt the eleventh placeholder
 * onwards. */
function sentinelAt(prefix: string, index: number): string {
  return `${prefix}${index}__`;
}

/**
 * For each placeholder, whether it starts inside a JSON string literal.
 *
 * That's the one thing masking needs to know. A placeholder inside a string is
 * part of that string and gets a bare sentinel; one standing on its own is a
 * value in its own right and needs a *quoted* sentinel to parse at all. The
 * scan tracks escapes, so a `\"` inside a string doesn't look like the end of
 * it. Placeholder bodies are letters, digits, underscores and spaces only, so
 * the scan never has to skip over one.
 */
function startsInString(
  text: string,
  refs: readonly PlaceholderRef[],
): boolean[] {
  const result: boolean[] = [];
  let next = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length && next < refs.length; i++) {
    if (i === refs[next].start) {
      result.push(inString);
      next++;
    }
    const ch = text[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      // Only inside a string: JSON has no escape sequences outside one.
      escaped = inString;
    } else if (ch === '"') {
      inString = !inString;
    }
  }
  return result;
}

export function maskPlaceholders(text: string): PlaceholderMask {
  const refs = findPlaceholders(text);
  if (refs.length === 0) {
    return { masked: text, restore: (formatted) => formatted };
  }

  const prefix = sentinelPrefix(text);
  const inString = startsInString(text, refs);

  // `replacePlaceholders` visits occurrences in the same order
  // `findPlaceholders` returns them - same regex, same scan - so this counter
  // indexes `inString` correctly. The name is deliberately ignored: an unknown
  // variable masks and restores like any other, which is what keeps it
  // verbatim in the output.
  let i = 0;
  const masked = replacePlaceholders(text, () => {
    const sentinel = sentinelAt(prefix, i);
    return inString[i++] ? sentinel : `"${sentinel}"`;
  });

  return {
    masked,
    restore(formatted: string): string | null {
      let result = formatted;
      for (let index = 0; index < refs.length; index++) {
        const sentinel = sentinelAt(prefix, index);
        // Bare occurrences reclaim the quotes that masking added; in-string
        // ones leave the quotes they were already inside alone.
        const needle = inString[index] ? sentinel : `"${sentinel}"`;
        const at = result.indexOf(needle);
        if (at === -1 || result.indexOf(needle, at + needle.length) !== -1) {
          return null;
        }
        // The original spelling, not a rebuilt `{{name}}`, so `{{ uuid }}`
        // keeps its spaces. Restoration is indexed by occurrence rather than
        // matched by text because it has to be: a document that is just
        // `{{n}}` and one that is just `"{{n}}"` mask to identical text, and
        // only `inString` tells them apart.
        result =
          result.slice(0, at) +
          text.slice(refs[index].start, refs[index].end) +
          result.slice(at + needle.length);
      }
      return result;
    },
  };
}

/**
 * Pretty-prints `text` without losing its `{{placeholders}}`.
 *
 * `formatJson` is passed in rather than imported so this module stays free of
 * the Angular service, the same way `replacePlaceholders` takes its resolver.
 */
export function formatPreservingPlaceholders(
  text: string,
  formatJson: (text: string) => JsonFormatResult,
): JsonFormatResult {
  const mask = maskPlaceholders(text);
  const result = formatJson(mask.masked);

  if (!result.ok) {
    // With the placeholders masked out, a parse failure means they sit
    // somewhere a stand-in can't go - spliced into a number, say, as in
    // `{"a": 1{{n}}}` - rather than that the payload is malformed. Worth
    // separate wording, because the caller may be reporting that same payload
    // as perfectly valid: it expands to valid JSON, it just can't be masked.
    return mask.masked === text
      ? result
      : {
          ok: false,
          error: "Formatting can't preserve this payload's variables",
        };
  }

  const restored = mask.restore(result.value);
  return restored === null
    ? { ok: false, error: "Formatting would drop part of this payload" }
    : { ok: true, value: restored };
}
