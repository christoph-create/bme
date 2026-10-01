import { formatPath } from "./format-path";

// Guards against a pathological payload turning into an unusable table. A
// telemetry blob with 10,000 readings is a real thing to receive, and the dock
// has to stay scrollable rather than render one row per reading.
/** Deepest path the walk descends into. Higher than `numeric-fields`' 6: a
 * diff reads a path out, it does not have to offer it in a picker. */
const MAX_DEPTH = 12;
const MAX_ROWS = 400;
/** Arrays longer than this are diffed as a single value rather than per
 * position - a hard cap rather than a heuristic, so the same two payloads
 * always diff the same way. */
const MAX_ARRAY_ELEMENTS = 64;
const MAX_VALUE_CHARS = 80;
/** Node budget for the equality check on a container leaf, so comparing two
 * over-cap arrays cannot walk an unbounded structure. */
const MAX_EQUAL_NODES = 5_000;

export type JsonDiffKind = "changed" | "added" | "removed" | "unchanged";

export type JsonType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "boolean"
  | "null";

export interface JsonDiffRow {
  readonly kind: JsonDiffKind;
  /** Property names / array indices from the payload root to the value.
   * Identity lives here, never in `label` - two different paths can render to
   * the same label (`{"a.b":1}` vs `{"a":{"b":1}}`), the same collision
   * `ValueChartsService.samePath` guards against. */
  readonly path: readonly string[];
  /** Display form of `path` - see `formatPath`. */
  readonly label: string;
  /** Rendered A-side value, or null when the path exists only on B. */
  readonly before: string | null;
  /** Rendered B-side value, or null when the path exists only on A. */
  readonly after: string | null;
  /** Set when both sides have the path but the JSON type differs (`81` ->
   * `"81"`). Worth saying out loud: a value that looks unchanged on screen
   * but changed type is the bug people come to a diff to find. */
  readonly typeChanged: boolean;
}

export interface JsonDiff {
  /** Walk order: within each container, B's keys in insertion order (so added
   * fields appear where the device put them), then A-only keys. This keeps
   * siblings together - `~ battery.level` next to `+ battery.charging` - and
   * is fully determined by the two inputs. `groupDiffRows` reorders it for
   * display. */
  readonly rows: readonly JsonDiffRow[];
  readonly changedCount: number;
  readonly addedCount: number;
  readonly removedCount: number;
  readonly unchangedCount: number;
  /** Set when a cap stopped the walk, so the view can say the list is partial
   * instead of implying the rest is equal. */
  readonly truncated: boolean;
}

interface Walk {
  readonly rows: JsonDiffRow[];
  truncated: boolean;
}

/**
 * Structural, field-by-field diff of two already-parsed JSON payloads.
 *
 * The rule that shapes everything else: **descend only when both sides are
 * containers of the same kind**, and emit exactly one row otherwise. So
 * `{a:{b:1}}` vs `{a:5}` is a single `~ a` row rather than a `- a.b` plus a
 * change at `a`, which would double-count the same difference.
 *
 * An empty object or array is treated as a leaf. Without that, `{a:{}}` vs
 * `{a:{}}` would descend into nothing and leave the path with no row at all,
 * so the unchanged count would quietly disagree with the rows.
 *
 * Key absence is not the same as a null value: `{a:null}` vs `{}` is a
 * removal. A firmware that stopped sending a field and one that sends it as
 * null are different events, and a debugging tool must not conflate them.
 */
export function diffJson(before: unknown, after: unknown): JsonDiff {
  const walk: Walk = { rows: [], truncated: false };
  walkPair(before, after, [], walk, 0);

  let changedCount = 0;
  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;
  for (const row of walk.rows) {
    if (row.kind === "changed") changedCount++;
    else if (row.kind === "added") addedCount++;
    else if (row.kind === "removed") removedCount++;
    else unchangedCount++;
  }

  return {
    rows: walk.rows,
    changedCount,
    addedCount,
    removedCount,
    unchangedCount,
    truncated: walk.truncated,
  };
}

/** Rows regrouped for display: changed, then added, then removed, each in
 * walk order, with unchanged last for the view to collapse. */
export function groupDiffRows(
  rows: readonly JsonDiffRow[],
): readonly JsonDiffRow[] {
  const order: readonly JsonDiffKind[] = [
    "changed",
    "added",
    "removed",
    "unchanged",
  ];
  return order.flatMap((kind) => rows.filter((row) => row.kind === kind));
}

/** `typeof` is not enough: it calls both `null` and `[]` an object, and those
 * are exactly the two cases a diff has to keep apart. */
export function jsonTypeOf(value: unknown): JsonType {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return type;
  }
  return "object";
}

/**
 * One value as the table shows it.
 *
 * Strings keep their quotes, so `81` and `"81"` are told apart without having
 * to read the type flag; containers are compacted and clipped.
 */
export function renderValue(value: unknown): string {
  const text = renderFull(value);
  return text.length > MAX_VALUE_CHARS
    ? `${text.slice(0, MAX_VALUE_CHARS)}…`
    : text;
}

function renderFull(value: unknown): string {
  switch (jsonTypeOf(value)) {
    case "null":
      return "null";
    case "string":
      return JSON.stringify(value);
    case "number":
    case "boolean":
      return String(value);
    default:
      // Already-parsed JSON, so this cannot throw on a cycle or a BigInt.
      return JSON.stringify(value) ?? "null";
  }
}

function walkPair(
  before: unknown,
  after: unknown,
  path: readonly string[],
  walk: Walk,
  depth: number,
): void {
  if (walk.rows.length >= MAX_ROWS) {
    walk.truncated = true;
    return;
  }

  const beforeType = jsonTypeOf(before);
  const afterType = jsonTypeOf(after);

  if (beforeType === afterType && (beforeType === "object" || beforeType === "array")) {
    const sameKind = beforeType;
    const bothEmpty = isEmptyContainer(before) && isEmptyContainer(after);
    if (!bothEmpty) {
      if (depth >= MAX_DEPTH) {
        walk.truncated = true;
        emitLeaf(before, after, path, walk);
        return;
      }
      if (sameKind === "object") {
        walkObjects(
          before as Record<string, unknown>,
          after as Record<string, unknown>,
          path,
          walk,
          depth,
        );
        return;
      }
      const a = before as unknown[];
      const b = after as unknown[];
      if (a.length > MAX_ARRAY_ELEMENTS || b.length > MAX_ARRAY_ELEMENTS) {
        walk.truncated = true;
        emitLeaf(before, after, path, walk);
        return;
      }
      walkArrays(a, b, path, walk, depth);
      return;
    }
  }

  emitLeaf(before, after, path, walk);
}

function walkObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: readonly string[],
  walk: Walk,
  depth: number,
): void {
  // B first, in its own insertion order, so an added field appears where the
  // device actually put it rather than at the end.
  for (const [key, value] of Object.entries(after)) {
    if (walk.rows.length >= MAX_ROWS) {
      walk.truncated = true;
      return;
    }
    const child = [...path, key];
    if (Object.hasOwn(before, key)) {
      walkPair(before[key], value, child, walk, depth + 1);
    } else {
      push(walk, {
        kind: "added",
        path: child,
        label: formatPath(child),
        before: null,
        after: renderValue(value),
        typeChanged: false,
      });
    }
  }

  for (const [key, value] of Object.entries(before)) {
    if (Object.hasOwn(after, key)) {
      continue;
    }
    if (walk.rows.length >= MAX_ROWS) {
      walk.truncated = true;
      return;
    }
    const child = [...path, key];
    push(walk, {
      kind: "removed",
      path: child,
      label: formatPath(child),
      before: renderValue(value),
      after: null,
      typeChanged: false,
    });
  }
}

/**
 * Arrays diff by position.
 *
 * There is deliberately no reordering detection: an element inserted at the
 * head of a 20-element array yields 20 changed rows. An LCS over elements
 * would need a stable key field that telemetry often does not have, and a
 * "most positions moved -> collapse the array" heuristic would let the same
 * two payloads diff two different ways depending on how many fields happened
 * to shift. In a debugging tool, surprise is worse than verbosity.
 *
 * A length change shows up as added/removed rows for the surplus positions.
 * There is no `length` pseudo-path, which would collide with a real `length`
 * key.
 */
function walkArrays(
  before: readonly unknown[],
  after: readonly unknown[],
  path: readonly string[],
  walk: Walk,
  depth: number,
): void {
  const longest = Math.max(before.length, after.length);
  for (let i = 0; i < longest; i++) {
    if (walk.rows.length >= MAX_ROWS) {
      walk.truncated = true;
      return;
    }
    const child = [...path, String(i)];
    const inBefore = i < before.length;
    const inAfter = i < after.length;
    if (inBefore && inAfter) {
      walkPair(before[i], after[i], child, walk, depth + 1);
    } else if (inAfter) {
      push(walk, {
        kind: "added",
        path: child,
        label: formatPath(child),
        before: null,
        after: renderValue(after[i]),
        typeChanged: false,
      });
    } else {
      push(walk, {
        kind: "removed",
        path: child,
        label: formatPath(child),
        before: renderValue(before[i]),
        after: null,
        typeChanged: false,
      });
    }
  }
}

function emitLeaf(
  before: unknown,
  after: unknown,
  path: readonly string[],
  walk: Walk,
): void {
  const equal = jsonEqual(before, after);
  push(walk, {
    kind: equal ? "unchanged" : "changed",
    path,
    label: formatPath(path),
    before: renderValue(before),
    after: renderValue(after),
    // `-0` and `0` compare equal and render identically, so they never reach
    // here as a change - there is nothing for the table to say about them.
    typeChanged: !equal && jsonTypeOf(before) !== jsonTypeOf(after),
  });
}

function push(walk: Walk, row: JsonDiffRow): void {
  walk.rows.push(row);
}

function isEmptyContainer(value: unknown): boolean {
  return Array.isArray(value)
    ? value.length === 0
    : Object.keys(value as Record<string, unknown>).length === 0;
}

/** Structural equality, independent of object key order and bounded by a node
 * budget - the container leaves this is called on can be over-cap arrays. */
function jsonEqual(a: unknown, b: unknown): boolean {
  return equalWithin(a, b, { left: MAX_EQUAL_NODES });
}

function equalWithin(
  a: unknown,
  b: unknown,
  budget: { left: number },
): boolean {
  if (budget.left-- <= 0) {
    // Out of budget: call them different rather than equal, so an unfinished
    // comparison never hides a change.
    return false;
  }
  const typeA = jsonTypeOf(a);
  if (typeA !== jsonTypeOf(b)) {
    return false;
  }
  if (typeA === "array") {
    const left = a as unknown[];
    const right = b as unknown[];
    return (
      left.length === right.length &&
      left.every((item, i) => equalWithin(item, right[i], budget))
    );
  }
  if (typeA === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (key) =>
          Object.hasOwn(right, key) &&
          equalWithin(left[key], right[key], budget),
      )
    );
  }
  return a === b;
}
