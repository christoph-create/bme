import { VariableValueKind } from "../models/payload-variable.model";
import { replacePlaceholders } from "./placeholders";

/**
 * Substitutes each placeholder with a canonical stand-in for its *kind*, so a
 * payload containing variables can be checked for JSON validity.
 *
 * The trick this rests on: whether the expansion parses as JSON depends only
 * on each variable's value kind, never on the value it happens to produce.
 * `{"t":{{tempC}}}` is valid for every number `tempC` can generate and invalid
 * for none of them, so probing with a single canonical `0` settles it - no
 * need to expand for real, and no dependence on the draw.
 *
 * The probes are substituted *bare*, without adding quotes, which is what
 * makes quoting mistakes show up correctly:
 *
 *   {"id":"{{deviceId}}"}  ->  {"id":"x"}  valid, and really is
 *   {"id":{{deviceId}}}    ->  {"id":x}    invalid, and really is
 *   {"t":{{tempC}}}        ->  {"t":0}     valid, and really is
 *
 * Unknown names are left literal, exactly as the real expansion leaves them,
 * so a typo inside a JSON value position is reported as invalid JSON too.
 */
export function probeExpand(
  text: string,
  kinds: ReadonlyMap<string, VariableValueKind>,
): string {
  return replacePlaceholders(text, (name) => {
    const kind = kinds.get(name);
    if (kind === undefined) {
      return null;
    }
    return kind === "number" ? "0" : "x";
  });
}
