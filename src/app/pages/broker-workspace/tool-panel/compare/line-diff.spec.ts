import { describe, expect, it } from "vitest";

import {
  LineDiffRow,
  buildHunks,
  diffLines,
  visibleLine,
} from "./line-diff";

function allRows(diff: ReturnType<typeof diffLines>): readonly LineDiffRow[] {
  return diff.hunks.flatMap((hunk) => hunk.rows);
}

function kinds(diff: ReturnType<typeof diffLines>): string[] {
  return allRows(diff).map((row) => row.kind);
}

describe("diffLines", () => {
  it("finds nothing to show in identical input", () => {
    const diff = diffLines("a\nb\nc", "a\nb\nc");
    expect(diff.hunks).toEqual([]);
    expect(diff.addedCount).toBe(0);
    expect(diff.removedCount).toBe(0);
    expect(diff.tooLarge).toBe(false);
  });

  it("shows a changed line as a removal followed by an addition", () => {
    const diff = diffLines("a\nb\nc", "a\nB\nc");
    expect(kinds(diff)).toEqual(["context", "removed", "added", "context"]);
    expect(diff.addedCount).toBe(1);
    expect(diff.removedCount).toBe(1);
  });

  it("shows a pure insertion", () => {
    const diff = diffLines("a\nc", "a\nb\nc");
    expect(kinds(diff)).toEqual(["context", "added", "context"]);
    expect(diff.removedCount).toBe(0);
  });

  it("shows a pure deletion", () => {
    const diff = diffLines("a\nb\nc", "a\nc");
    expect(kinds(diff)).toEqual(["context", "removed", "context"]);
    expect(diff.addedCount).toBe(0);
  });

  it("handles a change on the very first line", () => {
    const diff = diffLines("a\nb", "A\nb");
    expect(kinds(diff)).toEqual(["removed", "added", "context"]);
  });

  it("handles a change on the very last line", () => {
    const diff = diffLines("a\nb", "a\nB");
    expect(kinds(diff)).toEqual(["context", "removed", "added"]);
  });

  it("numbers context lines on both sides and changed lines on one", () => {
    const rows = allRows(diffLines("a\nb\nc", "a\nB\nc"));
    expect(rows[0]).toMatchObject({ beforeLine: 1, afterLine: 1 });
    expect(rows[1]).toMatchObject({ beforeLine: 2, afterLine: null });
    expect(rows[2]).toMatchObject({ beforeLine: null, afterLine: 2 });
    expect(rows[3]).toMatchObject({ beforeLine: 3, afterLine: 3 });
  });

  it("splits far-apart changes into separate hunks", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 2", "LINE 2").replace("line 25", "LINE 25");
    expect(diffLines(before, after).hunks).toHaveLength(2);
  });

  it("merges changes close enough that the gap is noise", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "LINE 10").replace("line 12", "LINE 12");
    expect(diffLines(before, after).hunks).toHaveLength(1);
  });

  it("keeps three lines of context either side by default", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 15", "LINE 15");
    const rows = allRows(diffLines(before, after));
    expect(rows.filter((row) => row.kind === "context")).toHaveLength(6);
  });

  it("honours a custom context width", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 15", "LINE 15");
    const rows = allRows(diffLines(before, after, { context: 1 }));
    expect(rows.filter((row) => row.kind === "context")).toHaveLength(2);
  });

  it("shows a trailing newline as an added empty line, as diff(1) does", () => {
    const diff = diffLines("a", "a\n");
    expect(kinds(diff)).toEqual(["context", "added"]);
    expect(allRows(diff).at(-1)?.text).toBe("");
  });

  it("reports a CRLF ending as a change rather than normalising it away", () => {
    // Someone may be hunting exactly this, so it must not be equalised.
    const diff = diffLines("a\r\nb", "a\nb");
    expect(diff.removedCount).toBe(1);
    expect(diff.addedCount).toBe(1);
  });

  it("refuses a payload past the character cap without a partial diff", () => {
    const huge = "x".repeat(70_000);
    const diff = diffLines(huge, `${huge}y`);
    expect(diff.tooLarge).toBe(true);
    expect(diff.hunks).toEqual([]);
  });

  it("refuses a payload past the line cap", () => {
    const before = Array.from({ length: 700 }, (_, i) => `a${i}`).join("\n");
    const after = Array.from({ length: 700 }, (_, i) => `b${i}`).join("\n");
    const diff = diffLines(before, after);
    expect(diff.tooLarge).toBe(true);
    expect(diff.hunks).toEqual([]);
  });

  it("diffs two 600-line payloads that differ throughout", () => {
    const before = Array.from({ length: 600 }, (_, i) => `a${i}`).join("\n");
    const after = Array.from({ length: 600 }, (_, i) => `b${i}`).join("\n");
    const diff = diffLines(before, after);
    expect(diff.tooLarge).toBe(false);
    expect(diff.addedCount).toBe(600);
    expect(diff.removedCount).toBe(600);
  });

  it("stays cheap when two long payloads share a prefix and suffix", () => {
    const head = Array.from({ length: 2_000 }, (_, i) => `h${i}`).join("\n");
    const diff = diffLines(`${head}\nmid`, `${head}\nMID`);
    expect(diff.tooLarge).toBe(false);
    expect(diff.addedCount).toBe(1);
  });
});

describe("buildHunks", () => {
  function row(
    kind: LineDiffRow["kind"],
    text: string,
    n: number,
  ): LineDiffRow {
    return {
      kind,
      beforeLine: kind === "added" ? null : n,
      afterLine: kind === "removed" ? null : n,
      text,
    };
  }

  it("returns no hunks when nothing changed", () => {
    expect(buildHunks([row("context", "a", 1)], 3)).toEqual([]);
  });

  it("writes a header naming both sides' ranges", () => {
    const rows = [row("context", "a", 1), row("removed", "b", 2), row("added", "B", 2)];
    expect(buildHunks(rows, 3)[0].header).toBe("@@ -1,2 +1,2 @@");
  });

  it("writes a zero range for a side that contributes nothing", () => {
    expect(buildHunks([row("added", "a", 1)], 3)[0].header).toBe("@@ -0,0 +1,1 @@");
  });

  it("does not run context past the ends of the row list", () => {
    const rows = [row("removed", "a", 1), row("added", "A", 1)];
    expect(buildHunks(rows, 3)[0].rows).toHaveLength(2);
  });
});

describe("visibleLine", () => {
  it("makes a stray carriage return legible", () => {
    expect(visibleLine("a\r")).toBe("a␍");
  });

  it("leaves an ordinary line alone", () => {
    expect(visibleLine("a")).toBe("a");
  });
});
