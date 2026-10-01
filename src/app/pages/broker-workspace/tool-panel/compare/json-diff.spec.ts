import { describe, expect, it } from "vitest";

import {
  JsonDiffRow,
  diffJson,
  groupDiffRows,
  jsonTypeOf,
  renderValue,
} from "./json-diff";

function rowFor(
  diff: ReturnType<typeof diffJson>,
  label: string,
): JsonDiffRow | undefined {
  return diff.rows.find((row) => row.label === label);
}

describe("jsonTypeOf", () => {
  it("tells null and arrays apart from objects, which typeof does not", () => {
    expect(jsonTypeOf(null)).toBe("null");
    expect(jsonTypeOf([])).toBe("array");
    expect(jsonTypeOf({})).toBe("object");
  });

  it("names the scalar types", () => {
    expect(jsonTypeOf("a")).toBe("string");
    expect(jsonTypeOf(1)).toBe("number");
    expect(jsonTypeOf(false)).toBe("boolean");
  });
});

describe("renderValue", () => {
  it("keeps quotes on strings, so 81 and \"81\" are distinguishable", () => {
    expect(renderValue(81)).toBe("81");
    expect(renderValue("81")).toBe('"81"');
  });

  it("renders null and booleans as themselves", () => {
    expect(renderValue(null)).toBe("null");
    expect(renderValue(true)).toBe("true");
  });

  it("compacts containers", () => {
    expect(renderValue({ b: 1 })).toBe('{"b":1}');
    expect(renderValue([])).toBe("[]");
  });

  it("clips a long value", () => {
    const rendered = renderValue("x".repeat(200));
    expect(rendered.endsWith("…")).toBe(true);
    expect(rendered.length).toBeLessThan(100);
  });
});

describe("diffJson", () => {
  it("reports a changed scalar with both rendered values", () => {
    const diff = diffJson({ temp: 21.5 }, { temp: 22 });
    expect(diff.rows).toEqual([
      {
        kind: "changed",
        path: ["temp"],
        label: "temp",
        before: "21.5",
        after: "22",
        typeChanged: false,
      },
    ]);
    expect(diff.changedCount).toBe(1);
  });

  it("reports an added key with no before value", () => {
    const row = rowFor(diffJson({}, { relay: true }), "relay");
    expect(row?.kind).toBe("added");
    expect(row?.before).toBeNull();
    expect(row?.after).toBe("true");
  });

  it("reports a removed key with no after value", () => {
    const row = rowFor(diffJson({ lastError: "E07" }, {}), "lastError");
    expect(row?.kind).toBe("removed");
    expect(row?.before).toBe('"E07"');
    expect(row?.after).toBeNull();
  });

  it("keeps unchanged keys as rows so the collapsed count is honest", () => {
    const diff = diffJson({ a: 1, b: 2 }, { a: 1, b: 3 });
    expect(diff.unchangedCount).toBe(1);
    expect(rowFor(diff, "a")?.kind).toBe("unchanged");
  });

  it("counts add up to the number of rows", () => {
    const diff = diffJson({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, d: 4 });
    expect(
      diff.changedCount +
        diff.addedCount +
        diff.removedCount +
        diff.unchangedCount,
    ).toBe(diff.rows.length);
  });

  it("flags a type change, which is the bug a diff gets opened for", () => {
    const row = rowFor(diffJson({ level: 81 }, { level: "81" }), "level");
    expect(row?.kind).toBe("changed");
    expect(row?.typeChanged).toBe(true);
    expect(row?.before).toBe("81");
    expect(row?.after).toBe('"81"');
  });

  it("treats null against a number as a type change", () => {
    const row = rowFor(diffJson({ a: null }, { a: 1 }), "a");
    expect(row?.kind).toBe("changed");
    expect(row?.typeChanged).toBe(true);
  });

  it("treats a dropped null key as a removal, not as unchanged", () => {
    // A device that stopped sending a field and one that sends it as null are
    // different events.
    const diff = diffJson({ a: null }, {});
    expect(rowFor(diff, "a")?.kind).toBe("removed");
    expect(diff.unchangedCount).toBe(0);
  });

  it("emits one row for a container against a scalar, without descending", () => {
    const diff = diffJson({ a: { b: 1 } }, { a: 5 });
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0].label).toBe("a");
    expect(diff.rows[0].typeChanged).toBe(true);
  });

  it("emits one row for an object against an array", () => {
    const diff = diffJson({ a: { "0": 1 } }, { a: [1] });
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0].typeChanged).toBe(true);
  });

  it("treats an empty container as a leaf rather than descending into nothing", () => {
    const diff = diffJson({ a: {} }, { a: {} });
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0].kind).toBe("unchanged");
    expect(diff.rows[0].before).toBe("{}");
  });

  it("descends into nested objects", () => {
    const diff = diffJson(
      { battery: { level: 84, charging: false } },
      { battery: { level: 81, charging: false } },
    );
    expect(rowFor(diff, "battery.level")?.kind).toBe("changed");
    expect(rowFor(diff, "battery.charging")?.kind).toBe("unchanged");
  });

  it("puts a key added by B where B put it, then A-only keys", () => {
    const diff = diffJson({ gone: 1, kept: 2 }, { kept: 2, fresh: 3 });
    expect(diff.rows.map((row) => row.label)).toEqual(["kept", "fresh", "gone"]);
  });

  it("diffs arrays by position", () => {
    const diff = diffJson({ xs: [1, 2] }, { xs: [1, 9] });
    expect(rowFor(diff, "xs[0]")?.kind).toBe("unchanged");
    expect(rowFor(diff, "xs[1]")?.kind).toBe("changed");
  });

  it("reports a longer array as added positions", () => {
    const diff = diffJson({ xs: [1] }, { xs: [1, 2] });
    expect(rowFor(diff, "xs[1]")?.kind).toBe("added");
  });

  it("reports a shorter array as removed positions", () => {
    const diff = diffJson({ xs: [1, 2] }, { xs: [1] });
    expect(rowFor(diff, "xs[1]")?.kind).toBe("removed");
  });

  it("descends into an object inside an array", () => {
    const diff = diffJson({ xs: [{ id: 1 }] }, { xs: [{ id: 2 }] });
    expect(rowFor(diff, "xs[0].id")?.kind).toBe("changed");
  });

  it("reports a reordered array per position, by design", () => {
    // Positional diffing has no reordering detection. Asserted so nobody
    // "fixes" it into a heuristic that makes the same two payloads diff two
    // different ways.
    const diff = diffJson({ xs: [1, 2, 3] }, { xs: [3, 1, 2] });
    expect(diff.changedCount).toBe(3);
  });

  it("diffs a bare scalar payload as a single root row", () => {
    const diff = diffJson(42, 43);
    expect(diff.rows).toEqual([
      {
        kind: "changed",
        path: [],
        label: "(root)",
        before: "42",
        after: "43",
        typeChanged: false,
      },
    ]);
  });

  it("compares objects regardless of key order", () => {
    const diff = diffJson({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } });
    expect(diff.changedCount).toBe(0);
  });

  it("produces no row for -0 against 0, which render identically", () => {
    expect(diffJson({ a: -0 }, { a: 0 }).changedCount).toBe(0);
  });

  it("keeps a dotted key distinct from a nested path in the same payload", () => {
    const diff = diffJson(
      { "a.b": 1, a: { b: 1 } },
      { "a.b": 2, a: { b: 2 } },
    );
    const labels = diff.rows.map((row) => row.label);
    expect(labels).toContain('["a.b"]');
    expect(labels).toContain("a.b");
    // Two rows, not one collapsed row: the paths differ even though a naive
    // dotted label would render them the same.
    expect(diff.changedCount).toBe(2);
  });

  it("stops at the depth cap and says the list is partial", () => {
    const deep = (n: number): unknown =>
      n === 0 ? 1 : { down: deep(n - 1) };
    const diff = diffJson(deep(20), deep(20));
    expect(diff.truncated).toBe(true);
  });

  it("stops at the row cap and says the list is partial", () => {
    const wide = (value: number) =>
      Object.fromEntries(
        Array.from({ length: 600 }, (_, i) => [`k${i}`, value]),
      );
    const diff = diffJson(wide(1), wide(2));
    expect(diff.truncated).toBe(true);
    expect(diff.rows.length).toBeLessThanOrEqual(400);
  });

  it("diffs an over-cap array as one value rather than per position", () => {
    const long = (fill: number) => ({ xs: Array.from({ length: 200 }, () => fill) });
    const diff = diffJson(long(1), long(2));
    expect(diff.truncated).toBe(true);
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0].label).toBe("xs");
    expect(diff.rows[0].kind).toBe("changed");
  });

  it("calls two equal over-cap arrays unchanged", () => {
    const long = () => ({ xs: Array.from({ length: 200 }, (_, i) => i) });
    const diff = diffJson(long(), long());
    expect(diff.rows[0].kind).toBe("unchanged");
  });
});

describe("groupDiffRows", () => {
  it("emits changed, then added, then removed, then unchanged", () => {
    const diff = diffJson(
      { same: 1, moved: 2, gone: 3 },
      { same: 1, moved: 9, fresh: 4 },
    );
    expect(groupDiffRows(diff.rows).map((row) => row.kind)).toEqual([
      "changed",
      "added",
      "removed",
      "unchanged",
    ]);
  });

  it("preserves walk order inside each group", () => {
    const diff = diffJson({ a: 1, b: 1 }, { a: 2, b: 2 });
    expect(groupDiffRows(diff.rows).map((row) => row.label)).toEqual(["a", "b"]);
  });

  it("keeps every row", () => {
    const diff = diffJson({ a: 1, b: 2 }, { a: 1, c: 3 });
    expect(groupDiffRows(diff.rows)).toHaveLength(diff.rows.length);
  });
});
