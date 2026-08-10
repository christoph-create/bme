import { decodePayload, looksBinary } from "../../format/payload-text";

// Guards against a pathological payload turning into an unusable picker: a
// telemetry array with 10,000 readings is a real thing to receive, and every
// one of its entries is technically a chartable numeric leaf.
/** Longest path, in steps, that still yields a pickable field. */
const MAX_DEPTH = 6;
const MAX_FIELDS = 64;
const MAX_ARRAY_SCAN = 8;

/** Leading number in a string, so a payload like `23.5 °C` still charts. */
const LEADING_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

export interface NumericField {
  /** Property names / array indices from the payload root to the value. */
  readonly path: readonly string[];
  /** Dotted form of `path`, or `fallbackLabel` when the path is empty. */
  readonly label: string;
  /** The value found in the scanned payload - shown next to the name so two
   * same-named fields under different parents can be told apart. */
  readonly value: number;
}

/**
 * Decodes and parses a received payload into a JS value, or `undefined` when
 * there is nothing chartable to read out of it (binary, empty, or text that
 * is neither JSON nor a number).
 *
 * A bare `23.5` is not valid JSON in every broker's output but is extremely
 * common as an MQTT payload, hence the fallback - and the unit-suffix case
 * (`23.5 °C`) is common enough to be worth the same treatment.
 */
export function parsePayload(payload: readonly number[]): unknown {
  if (payload.length === 0) {
    return undefined;
  }

  const text = decodePayload(payload);
  if (looksBinary(text)) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return parseLooseNumber(text);
  }
}

/** Every finite numeric leaf reachable in `parsed`, in document order. */
export function findNumericFields(
  parsed: unknown,
  fallbackLabel: string,
): readonly NumericField[] {
  if (typeof parsed === "number") {
    return Number.isFinite(parsed)
      ? [{ path: [], label: fallbackLabel, value: parsed }]
      : [];
  }

  const fields: NumericField[] = [];
  collect(parsed, [], fields);
  return fields;
}

/**
 * Union of the numeric fields seen across a topic's history, oldest first.
 *
 * One topic often carries more than one payload shape - a device that sends
 * a reading every second and a battery level once a minute, or a firmware
 * that added a field halfway through the session. Offering only the newest
 * message's fields hides whatever wasn't in it.
 *
 * Fields keep the order they were first seen in, but take their value from
 * the most recent message that carried them, so the picker shows a current
 * reading rather than a stale one.
 */
export function mergeNumericFields(
  perMessage: Iterable<readonly NumericField[]>,
): readonly NumericField[] {
  // Keyed on the path rather than the label, because two different paths can
  // render to the same dotted label (`{"a.b":1}` vs `{"a":{"b":1}}`).
  const merged = new Map<string, NumericField>();
  for (const fields of perMessage) {
    for (const field of fields) {
      const key = JSON.stringify(field.path);
      if (merged.size >= MAX_FIELDS && !merged.has(key)) {
        continue;
      }
      // `set` on an existing key updates the value and keeps the original
      // position, which is exactly the first-seen-order / newest-value rule.
      merged.set(key, field);
    }
  }
  return [...merged.values()];
}

/**
 * The finite number at `path`, or null when this particular payload has no
 * such value. Callers treat null as "no sample here" rather than as zero -
 * a field that comes and goes must leave a gap in the series, not a dip.
 */
export function readNumericAt(
  parsed: unknown,
  path: readonly string[],
): number | null {
  let current = parsed;
  for (const step of path) {
    if (current === null || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[step];
  }
  return typeof current === "number" && Number.isFinite(current)
    ? current
    : null;
}

function collect(
  value: unknown,
  path: readonly string[],
  fields: NumericField[],
): void {
  if (Array.isArray(value)) {
    const scanned = Math.min(value.length, MAX_ARRAY_SCAN);
    for (let i = 0; i < scanned; i++) {
      visit(value[i], [...path, String(i)], fields);
    }
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      visit(child, [...path, key], fields);
    }
  }
}

function visit(
  value: unknown,
  path: readonly string[],
  fields: NumericField[],
): void {
  if (fields.length >= MAX_FIELDS || path.length > MAX_DEPTH) {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      fields.push({ path, label: path.join("."), value });
    }
    return;
  }
  collect(value, path, fields);
}

function parseLooseNumber(text: string): number | undefined {
  const trimmed = text.trim();
  // `Number("")` is 0, so the emptiness check has to come first or a
  // whitespace-only payload charts as a real zero.
  if (trimmed.length === 0) {
    return undefined;
  }

  // Whole-string first, so notations JSON doesn't accept but JS does (`0x10`,
  // `.5`) keep their real value instead of being truncated by the regex below.
  const whole = Number(trimmed);
  if (Number.isFinite(whole)) {
    return whole;
  }

  const match = LEADING_NUMBER.exec(trimmed);
  if (match === null) {
    return undefined;
  }
  const leading = Number(match[0]);
  return Number.isFinite(leading) ? leading : undefined;
}
